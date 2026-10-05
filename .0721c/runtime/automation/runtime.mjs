import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { GitHubClient } from './github.mjs';
import { validateSettings, validateCommentRecord, assertArticleId, assertCommentId } from '../core/index.mjs';
import { validateArticles } from './build-index.mjs';

export const STATUS_CONTEXT = '0721c/comment-data';
export function serialize(value) { return `${JSON.stringify(value, null, 2)}\n`; }
export function assertSha(sha) {
  if (typeof sha !== 'string' || !/^[0-9a-f]{40}$/.test(sha)) throw new Error('Invalid Git commit SHA');
  return sha;
}
export function positiveInteger(value, label = 'identifier') {
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`Invalid ${label}`);
  return value;
}
export function inputNumber(value, label) {
  if (typeof value !== 'string' || !/^[1-9][0-9]*$/.test(value)) throw new Error(`Invalid ${label}`);
  return positiveInteger(Number(value), label);
}
export function recordPath(record) {
  const id = assertCommentId(record.id);
  if (id.slice(0, id.lastIndexOf('/')) !== assertArticleId(record.blog_id)) throw new Error('Comment ID does not match article path');
  return `${id}.json`;
}
export function parseRecordPath(path) {
  const slash = typeof path === 'string' ? path.lastIndexOf('/') : -1;
  if (slash < 1 || !path.endsWith('.json')) throw new Error(`Invalid comment path: ${path}`);
  return { blog_id: assertArticleId(path.slice(0, slash)), id: assertCommentId(path.slice(0, -5)) };
}
export function json(text, path) {
  try { return JSON.parse(text); } catch { throw new Error(`Invalid JSON: ${path}`); }
}
export async function optional(operation) {
  try { return await operation(); } catch (error) { if (error.status === 404) return null; throw error; }
}
export async function list(client, path) {
  const items = [];
  for (let page = 1; page <= 1000; page++) {
    const batch = await client.request('GET', `${path}${path.includes('?') ? '&' : '?'}per_page=100&page=${page}`);
    if (!Array.isArray(batch)) throw new Error('Expected a paginated GitHub array');
    items.push(...batch);
    if (batch.length < 100) return items;
  }
  throw new Error('GitHub pagination limit exceeded');
}
export async function ref(client, name) {
  const value = await optional(() => client.request('GET', `${client.basePath}/git/ref/${name}`));
  if (!value) return null;
  if (value.object?.type !== 'commit') throw new Error(`Expected a commit ref: ${name}`);
  assertSha(value.object.sha);
  return value;
}
export async function requiredRef(client, name) {
  const value = await ref(client, name);
  if (!value) throw new Error(`Missing ref: ${name}`);
  return value.object.sha;
}
export async function loadDeployment(client, mainCommit) {
  const repository = await client.request('GET', client.basePath);
  if (repository.default_branch !== 'main' || repository.full_name?.toLowerCase() !== `${client.owner}/${client.repo}`.toLowerCase()) throw new Error('Runtime requires this repository with default branch main');
  positiveInteger(repository.id, 'repository ID');
  mainCommit = mainCommit ? assertSha(mainCommit) : await requiredRef(client, 'heads/main');
  const settings = validateSettings(json(await client.readFile('config/settings.json', mainCommit), 'config/settings.json'));
  const text = await optional(() => client.readFile('config/articles.json', mainCommit));
  let articles = {};
  if (text !== null) {
    const file = json(text, 'config/articles.json');
    if (!file || file.schema_version !== 1 || !Object.hasOwn(file, 'articles') || Object.keys(file).some(key => !['schema_version', 'articles'].includes(key))) throw new Error('Invalid articles configuration');
    articles = validateArticles(file.articles);
  }
  return { client, repository, mainCommit, settings, articles };
}
export async function readTree(client, commit) {
  const data = await client.request('GET', `${client.basePath}/git/commits/${assertSha(commit)}`);
  const tree = await client.request('GET', `${client.basePath}/git/trees/${assertSha(data.tree.sha)}?recursive=1`);
  if (tree.truncated || !Array.isArray(tree.tree)) throw new Error('Incomplete Git tree; refusing a partial snapshot');
  const paths = new Set();
  for (const entry of tree.tree) {
    if (typeof entry.path !== 'string' || paths.has(entry.path)) throw new Error('Invalid or duplicate tree path');
    paths.add(entry.path);
  }
  return { commit: data, entries: tree.tree };
}
export async function readBlob(client, entry) {
  if (entry.type !== 'blob' || entry.mode !== '100644') throw new Error(`Expected a non-executable JSON blob: ${entry.path}`);
  const blob = await client.request('GET', `${client.basePath}/git/blobs/${assertSha(entry.sha)}`);
  if (blob.encoding !== 'base64' || typeof blob.content !== 'string') throw new Error(`Invalid Git blob: ${entry.path}`);
  return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(Buffer.from(blob.content, 'base64'));
}
export async function readRecords(client, commit) {
  const tree = await readTree(client, commit);
  const records = [];
  for (const entry of tree.entries) {
    if (entry.type === 'tree' && entry.mode === '040000') continue;
    if (entry.path === 'README.md' && entry.type === 'blob' && entry.mode === '100644') continue;
    const path = parseRecordPath(entry.path);
    try {
      const record = validateCommentRecord(json(await readBlob(client, entry), entry.path));
      if (record.id !== path.id || record.blog_id !== path.blog_id) throw new Error(`Record/path mismatch: ${entry.path}`);
      records.push(record);
    } catch (error) { error.file = entry.path; throw error; }
  }
  return { ...tree, records };
}
/** Recursive trees include directory SHAs, which change when a nested record is added. */
export function addedRecordEntry(base, head) {
  const files = entries => new Map(entries.filter(entry => !(entry.type === 'tree' && entry.mode === '040000')).map(entry => [entry.path, entry]));
  const previous = files(base), current = files(head);
  for (const [path, entry] of previous) {
    const next = current.get(path);
    if (!next || entry.sha !== next.sha || entry.mode !== next.mode || entry.type !== next.type) throw new Error('PR may not modify or remove approved files');
  }
  const added = [...current.values()].filter(entry => !previous.has(entry.path));
  if (added.length !== 1 || added[0].type !== 'blob' || added[0].mode !== '100644') throw new Error('PR must add exactly one non-executable JSON record');
  parseRecordPath(added[0].path);
  return added[0];
}
export async function candidateFromCommit(client, sha) {
  const head = await readTree(client, sha);
  if (head.commit.parents?.length !== 1) throw new Error('Saved candidate must have one comments parent');
  const base = await readTree(client, head.commit.parents[0].sha);
  const entry = addedRecordEntry(base.entries, head.entries);
  const text = await readBlob(client, entry);
  const record = validateCommentRecord(json(text, entry.path));
  if (recordPath(record) !== entry.path) throw new Error('Saved candidate record/path mismatch');
  return { sha, record, path: entry.path };
}
/** Omit parent to create a complete tree and a root commit, never inheriting old files. */
export async function createCommit(client, { parent, message, files }) {
  const previous = parent ? await client.request('GET', `${client.basePath}/git/commits/${assertSha(parent)}`) : null;
  const tree = [];
  for (const [path, text] of Object.entries(files)) {
    const blob = await client.request('POST', `${client.basePath}/git/blobs`, { content: text, encoding: 'utf-8' });
    tree.push({ path, mode: '100644', type: 'blob', sha: assertSha(blob.sha) });
  }
  const result = await client.request('POST', `${client.basePath}/git/trees`, {
    ...(previous ? { base_tree: assertSha(previous.tree.sha) } : {}), tree,
  });
  const commit = await client.request('POST', `${client.basePath}/git/commits`, { message, tree: assertSha(result.sha), parents: parent ? [parent] : [] });
  return assertSha(commit.sha);
}
export async function setStatus(client, sha, state, description) {
  return client.request('POST', `${client.basePath}/statuses/${assertSha(sha)}`, { state, context: STATUS_CONTEXT, description: description.slice(0, 140) });
}
export async function actionContext(env = process.env) {
  if (!env.GITHUB_EVENT_PATH || !env.GITHUB_EVENT_NAME) throw new Error('GitHub event context is required');
  const event = json(await readFile(env.GITHUB_EVENT_PATH, 'utf8'), 'GitHub event');
  const client = new GitHubClient({ repository: env.GITHUB_REPOSITORY, token: env.GITHUB_TOKEN });
  if (event.repository?.full_name?.toLowerCase() !== `${client.owner}/${client.repo}`.toLowerCase()) throw new Error('Event repository mismatch');
  if (env.GITHUB_EVENT_NAME === 'workflow_dispatch' && env.GITHUB_REF !== 'refs/heads/main') throw new Error('Dispatch must run from main');
  return { client, event, eventName: env.GITHUB_EVENT_NAME, mainCommit: env.RUNTIME_MAIN_SHA };
}
export function isDirectEntry(metaUrl) { return Boolean(process.argv[1]) && pathToFileURL(resolve(process.argv[1])).href === metaUrl; }
export function reportFailure(error) {
  const status = Number.isInteger(error?.status) ? ` (HTTP ${error.status})` : '';
  const code = typeof error?.code === 'string' && /^[A-Z_]{1,64}$/.test(error.code) ? ` [${error.code}]` : '';
  const files = [];
  for (const path of [...(error?.file ? [error.file] : []), ...(Array.isArray(error?.files) ? error.files.slice(0, 8) : [])]) {
    try { parseRecordPath(path); if (!files.includes(path)) files.push(path); } catch { /* Do not echo unvalidated input. */ }
  }
  process.stderr.write(`0721c automation failed${status}${code}${files.length ? ` in ${files.join(', ')}` : ''}; inspect configuration and comment data.\n`);
  process.exitCode = 1;
}
