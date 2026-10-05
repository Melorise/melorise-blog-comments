import { GitHubAPIError } from './github.mjs';
import { notifyComment } from './notify-comment.mjs';
import { buildIndexes } from './build-index.mjs';
import { actionContext, loadDeployment, requiredRef, readRecords, serialize, createCommit, positiveInteger, isDirectEntry, reportFailure } from './runtime.mjs';

export async function publishIndex({ client, mainCommit, context }) {
  context ??= await loadDeployment(client, mainCommit);
  const commentsCommit = await requiredRef(client, 'heads/comments');
  const approved = await readRecords(client, commentsCommit);
  const { indexes } = buildIndexes({ records: approved.records, settings: context.settings, articles: context.articles });
  // A README also keeps the empty snapshot representable as a Git tree.
  const files = { 'README.md': '# Comment indexes\n\nGenerated from approved comments.\n' };
  for (const [id, index] of Object.entries(indexes)) files[`${id}.json`] = serialize(index);
  const commit = await createCommit(client, { message: 'Update comment indexes', files });
  const [currentMain, currentComments] = await Promise.all([requiredRef(client, 'heads/main'), requiredRef(client, 'heads/comments')]);
  if (currentMain !== context.mainCommit || currentComments !== commentsCommit) {
    throw Object.assign(new Error('Main or comments changed; refusing a stale index build'), { code: 'STALE_INDEX_SNAPSHOT' });
  }
  // This is the ONLY forced ref update. Main/comments and review branches are never forced.
  try {
    await client.request('PATCH', `${client.basePath}/git/refs/heads/index`, { sha: commit, force: true });
  } catch (error) {
    if (await requiredRef(client, 'heads/index') !== commit) throw error; // Recover a lost successful response.
  }
  return { status: 'published', commit, indexes };
}
export async function runPublication({ client, event, eventName, mainCommit, env = process.env, fetchImpl = globalThis.fetch }) {
  if (!['pull_request_target', 'schedule', 'workflow_dispatch', 'push'].includes(eventName)) throw new Error('Unsupported publication event');
  if (eventName === 'pull_request_target') {
    if (event.action !== 'closed' || event.pull_request?.base?.ref !== 'comments') throw new Error('Unsupported publication PR event');
    positiveInteger(event.pull_request.number, 'PR number');
    if (!event.pull_request.merged) return { status: 'ignored' };
  }
  if (eventName === 'push' && !['refs/heads/main', 'refs/heads/comments'].includes(event.ref)) throw new Error('Unsupported publication branch');
  const context = await loadDeployment(client, mainCommit);
  const result = await publishIndex({ client, mainCommit, context });
  if (eventName === 'pull_request_target' && context.settings.notifications.enabled) {
    try {
      result.notification = await notifyComment({ client, event, context, indexes: result.indexes, env, fetchImpl });
    } catch (error) {
      const code = typeof error.code === 'string' && /^[A-Z0-9_]{1,64}$/.test(error.code) ? error.code : 'MAIL_OPERATION_FAILED';
      result.notification = error instanceof GitHubAPIError
        ? { status: 'failed', code: error.status ? `GITHUB_HTTP_${error.status}` : 'GITHUB_NETWORK_ERROR', operation: `${error.method} ${error.path}` }
        : { status: 'failed', code };
    }
  }
  return result;
}
if (isDirectEntry(import.meta.url)) {
  actionContext().then(runPublication).then(result => {
    process.stdout.write(`0721c publication: ${result.status}.\n`);
    if (result.notification) {
      const { status, code, reason, operation } = result.notification;
      const names = { disabled: '未启用', sent: '已提交发送', skipped: '已跳过', failed: '未完成' };
      process.stdout.write(`0721c 邮件通知：${names[status] ?? status}${code ? ` (${code})` : reason ? ` (${reason})` : ''}${operation ? `：${operation}` : ''}。\n`);
    }
  }).catch(reportFailure);
}
