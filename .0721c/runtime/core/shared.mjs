export const DEFAULT_LIMITS = Object.freeze({ bodyCodepoints: 8000, bodyBytes: 32768, maxReplyDepth: 64 });

export class ProtocolError extends Error {
  constructor(code, message, options) {
    super(message, options);
    this.name = 'ProtocolError';
    this.code = code;
  }
}

export function fail(code, message) { throw new ProtocolError(code, message); }
export function object(value, label, keys, required = keys) {
  if (value === null || typeof value !== 'object' || Array.isArray(value) ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(value))) fail('INVALID_FIELD', `${label} must be a plain object`);
  for (const key of Object.keys(value)) if (!keys.includes(key)) fail('INVALID_FIELD', `${label}.${key} is not supported`);
  for (const key of required) if (!Object.hasOwn(value, key)) fail('INVALID_FIELD', `${label}.${key} is required`);
  return value;
}
export function integer(value, label, minimum = 0) {
  if (!Number.isSafeInteger(value) || value < minimum) fail('INVALID_FIELD', `${label} must be a safe integer >= ${minimum}`);
  return value;
}
export function textValue(value, label, maxLength = 1024) {
  if (typeof value !== 'string' || !value.trim() || value.length > maxLength || /[\u0000-\u001f\u007f]/.test(value)) fail('INVALID_FIELD', `${label} must be a nonempty string`);
  return value;
}
export function assertArticleId(value) {
  if (typeof value !== 'string' || Array.from(value).length > 512 || !value ||
      value.split('/').some(segment => !/^[\p{L}\p{N}_-][\p{L}\p{N}._-]*$/u.test(segment))) {
    fail('INVALID_ARTICLE_ID', 'Article ID must be a safe, readable relative URL path');
  }
  return value;
}
function validCalendar(year, month, day, hour, minute, second) {
  if (month < 1 || month > 12 || day < 1 || hour > 23 || minute > 59 || second > 59) return false;
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  return day <= [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
}
export function assertCommentId(value) {
  const slash = typeof value === 'string' ? value.lastIndexOf('/') : -1;
  const match = slash > 0 && /^comments-([1-9][0-9]{0,15})$/.exec(value.slice(slash + 1));
  if (!match || !Number.isSafeInteger(Number(match[1]))) {
    fail('INVALID_COMMENT_ID', 'Comment ID must contain the article path and a positive GitHub Issue number');
  }
  assertArticleId(value.slice(0, slash));
  return value;
}
export function assertCommentIdentity(id, articleId) {
  assertCommentId(id);
  if (id.slice(0, id.lastIndexOf('/')) !== articleId) {
    fail('INVALID_COMMENT_ID', 'Comment ID does not match its article');
  }
}
export function utcDate(value, label) {
  const match = typeof value === 'string' && /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,3})?Z$/.exec(value);
  if (!match || !validCalendar(...match.slice(1, 7).map(Number)) || !Number.isFinite(Date.parse(value))) fail('INVALID_DATE', `${label} must be a valid UTC ISO timestamp`);
  return value;
}
export function localeValue(value) {
  if (!['zh-CN', 'en'].includes(value)) fail('INVALID_LOCALE', 'locale must be zh-CN or en');
  return value;
}
export function limitsValue(value = DEFAULT_LIMITS) {
  object(value, 'limits', Object.keys(DEFAULT_LIMITS), []);
  const result = { ...DEFAULT_LIMITS, ...value };
  for (const key of Object.keys(result)) {
    integer(result[key], `limits.${key}`, key === 'maxReplyDepth' ? 0 : 1);
    if (result[key] > DEFAULT_LIMITS[key]) fail('INVALID_LIMITS', `limits.${key} exceeds the protocol maximum`);
  }
  return result;
}
export function bodyValue(value, limits = DEFAULT_LIMITS) {
  if (typeof value !== 'string' || !value.trim()) fail('EMPTY_BODY', 'Comment body is empty after stripping the template');
  let count = 0;
  for (const character of value) {
    const point = character.codePointAt(0);
    if (point >= 0xd800 && point <= 0xdfff) fail('INVALID_BODY', 'Comment body contains an unpaired surrogate');
    if (++count > limits.bodyCodepoints) fail('BODY_TOO_LARGE', 'Comment body exceeds the Unicode codepoint limit');
  }
  if (new TextEncoder().encode(value).byteLength > limits.bodyBytes) fail('BODY_TOO_LARGE', 'Comment body exceeds the UTF-8 byte limit');
  if (/<!--\s*0721c-(?:meta|instructions)(?=[:\s])/i.test(value)) fail('INVALID_TEMPLATE', 'Reserved template markers may not appear in the comment body');
  return value;
}
export function articleValue(value) {
  if (value === undefined) return undefined;
  object(value, 'article', ['title', 'url'], ['title']);
  const article = { title: textValue(value.title, 'article.title', 512).trim() };
  if (value.url !== undefined) article.url = httpUrl(value.url, 'article.url').href;
  return article;
}
export function bool(value, label) {
  if (typeof value !== 'boolean') fail('INVALID_FIELD', `${label} must be a boolean`);
  return value;
}
export function idList(value, label) {
  if (!Array.isArray(value)) fail('INVALID_FIELD', `${label} must be an array`);
  const seen = new Set();
  return Array.from(value, id => {
    assertArticleId(id);
    if (seen.has(id)) fail('DUPLICATE_ID', `${label} contains a duplicate ID`);
    seen.add(id);
    return id;
  });
}
export function httpUrl(value, label, { github = false } = {}) {
  textValue(value, label, 4096);
  let url;
  try { url = new URL(value); } catch { fail('INVALID_URL', `${label} is not a URL`); }
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || (github && (url.origin !== 'https://github.com' || url.search || url.hash))) fail('INVALID_URL', `${label} has an unsafe origin or credentials`);
  return url;
}
export function normalizeRepository(input) {
  if (typeof input !== 'string' || !input || input !== input.trim() || /[\\\s%]/.test(input)) fail('INVALID_REPOSITORY', 'Expected owner/repo or a GitHub HTTPS repository URL');
  let path = input;
  if (input.includes('://')) {
    let url;
    try { url = new URL(input); } catch { fail('INVALID_REPOSITORY', 'Invalid repository URL'); }
    if (url.origin !== 'https://github.com' || url.username || url.password || url.search || url.hash || /[?#]/.test(input)) fail('INVALID_REPOSITORY', 'Repository must use GitHub HTTPS without credentials, query or fragment');
    // Inspect the original path too: URL parsing must not normalize traversal into a valid repository.
    path = input.replace(/^https:\/\/github\.com(?::443)?\//i, '');
    if (path === input) fail('INVALID_REPOSITORY', 'Invalid GitHub repository URL');
  }
  path = path.replace(/\/$/, '').replace(/\.git$/, '');
  const parts = path.split('/');
  if (parts.length !== 2) fail('INVALID_REPOSITORY', 'Repository must contain exactly owner/repo');
  const [owner, repo] = parts;
  if (!/^[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,37}[a-zA-Z0-9])?$/.test(owner) || !/^[a-zA-Z0-9_.-]{1,100}$/.test(repo) || ['.', '..'].includes(repo)) fail('INVALID_REPOSITORY', 'Invalid GitHub owner or repository name');
  return { owner, repo, url: `https://github.com/${owner}/${repo}`, rawBaseUrl: `https://raw.githubusercontent.com/${owner}/${repo}/index` };
}
export function authorValue(value) {
  object(value, 'author', ['login', 'avatar_url'], ['login']);
  const result = { login: textValue(value.login, 'author.login', 100) };
  if (!/^[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,98}[a-zA-Z0-9])?(?:\[bot\])?$/.test(result.login)) fail('INVALID_FIELD', 'author.login is invalid');
  if (Object.hasOwn(value, 'avatar_url')) {
    httpUrl(value.avatar_url, 'author.avatar_url');
    result.avatar_url = value.avatar_url;
  }
  return result;
}
export function compareNodes(a, b) {
  const difference = Date.parse(a.created_at) - Date.parse(b.created_at);
  return difference || Number(a.id.slice(a.id.lastIndexOf('-') + 1)) - Number(b.id.slice(b.id.lastIndexOf('-') + 1));
}
export function deepFreeze(value) {
  const pending = [value];
  while (pending.length) {
    const item = pending.pop();
    if (!item || typeof item !== 'object' || Object.isFrozen(item)) continue;
    pending.push(...Object.values(item));
    Object.freeze(item);
  }
  return value;
}
