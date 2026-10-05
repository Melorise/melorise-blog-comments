import { validateCommentRecord } from '../core/index.mjs';
import { buildIndexes, commentsEnabled } from './build-index.mjs';
import { actionContext, loadDeployment, readTree, readRecords, readBlob, requiredRef, list, json, recordPath, addedRecordEntry, setStatus, positiveInteger, inputNumber, isDirectEntry, reportFailure } from './runtime.mjs';

export async function validatePullRequest({ client, prNumber, mainCommit, context }) {
  context ??= await loadDeployment(client, mainCommit);
  positiveInteger(prNumber, 'PR number');
  const pr = await client.request('GET', `${client.basePath}/pulls/${prNumber}`);
  if (pr.state !== 'open' || pr.base?.ref !== 'comments' || pr.base?.repo?.id !== context.repository.id || pr.head?.repo?.id !== context.repository.id) throw new Error('Open comment PR must belong to this repository and target comments');
  const headSha = pr.head.sha;
  const branch = pr.head.ref;
  if (!/^comment-[1-9][0-9]*$/.test(branch)) throw new Error('Invalid Issue review branch');
  const issueNumber = inputNumber(branch.slice('comment-'.length), 'Issue number');
  await setStatus(client, headSha, 'pending', 'Validating comment data');
  try {
    const files = await list(client, `${client.basePath}/pulls/${prNumber}/files`);
    if (pr.changed_files !== 1 || files.length !== 1 || files[0].status !== 'added') throw new Error('PR must add exactly one JSON record');
    const compare = await client.request('GET', `${client.basePath}/compare/${pr.base.sha}...${headSha}`);
    const [base, head] = await Promise.all([readTree(client, compare.merge_base_commit.sha), readTree(client, headSha)]);
    const entry = addedRecordEntry(base.entries, head.entries);
    if (files[0].filename !== entry.path || files[0].sha !== entry.sha) throw new Error('PR file listing does not match its actual head');
    const record = validateCommentRecord(json(await readBlob(client, entry), entry.path));
    if (recordPath(record) !== entry.path) throw new Error('PR path does not match comment ID');
    if (record.id !== `${record.blog_id}/comments-${issueNumber}`) throw new Error('Comment ID does not match the Issue review branch');
    if (!commentsEnabled(record.blog_id, context.settings, context.articles)) throw new Error('New comments are disabled for this article');
    const commentsSha = await requiredRef(client, 'heads/comments');
    const approved = await readRecords(client, commentsSha);
    buildIndexes({ records: [...approved.records, record], settings: context.settings, articles: context.articles });
    const current = await client.request('GET', `${client.basePath}/pulls/${prNumber}`);
    const [currentMain, currentComments] = await Promise.all([requiredRef(client, 'heads/main'), requiredRef(client, 'heads/comments')]);
    if (current.state !== 'open' || current.head.sha !== headSha || current.head.ref !== branch ||
        current.base?.ref !== 'comments' || current.base?.repo?.id !== context.repository.id || current.head?.repo?.id !== context.repository.id) throw new Error('PR head, base or state changed during validation');
    if (currentMain !== context.mainCommit || currentComments !== commentsSha) throw new Error('Main or comments changed during validation');
    await setStatus(client, headSha, 'success', 'Single comment record and reply tree valid');
    return { valid: true, headSha, pr: current, record };
  } catch (error) {
    await setStatus(client, headSha, 'failure', 'Comment data failed validation');
    throw error;
  }
}
export async function runValidation({ client, event, eventName, mainCommit }) {
  if (eventName !== 'workflow_dispatch' && (eventName !== 'pull_request_target' || !['opened', 'synchronize', 'reopened'].includes(event.action))) throw new Error('Unsupported validation event');
  const prNumber = eventName === 'workflow_dispatch' ? inputNumber(event.inputs?.pr_number, 'PR number') : positiveInteger(event.pull_request?.number, 'PR number');
  return validatePullRequest({ client, prNumber, mainCommit });
}
if (isDirectEntry(import.meta.url)) {
  actionContext().then(runValidation).then(() => process.stdout.write('0721c comment data validated.\n')).catch(reportFailure);
}
