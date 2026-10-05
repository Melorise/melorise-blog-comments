import { DEFAULT_LIMITS, object, fail, integer, assertArticleId, assertCommentId, utcDate, localeValue, limitsValue, bodyValue, bool, idList, authorValue, compareNodes, articleValue, assertCommentIdentity, textValue } from './shared.mjs';

export function validateSettings(value = {}) {
  object(value, 'settings', ['schema_version', 'articlePolicy', 'limits', 'locale', 'site', 'notifications'], []);
  if (Object.hasOwn(value, 'schema_version') && value.schema_version !== 1) fail('UNSUPPORTED_VERSION', 'Unsupported settings version');
  const policy = Object.hasOwn(value, 'articlePolicy') ? value.articlePolicy : {};
  object(policy, 'articlePolicy', ['mode', 'disabledIds'], []);
  const mode = Object.hasOwn(policy, 'mode') ? policy.mode : 'open';
  if (!['open', 'allowlist'].includes(mode)) fail('INVALID_FIELD', 'articlePolicy.mode must be open or allowlist');
  const site = siteSettings(value.site);
  const notifications = notificationSettings(value.notifications);
  if (notifications.enabled) {
    if (!site.url) fail('INVALID_FIELD', '启用邮件通知后需要填写 site.url。');
    if (!notifications.from) fail('INVALID_FIELD', '启用邮件通知后需要填写 notifications.from。');
  }
  return {
    site, notifications,
    schema_version: 1,
    articlePolicy: { mode, disabledIds: idList(Object.hasOwn(policy, 'disabledIds') ? policy.disabledIds : [], 'articlePolicy.disabledIds') },
    limits: limitsValue(Object.hasOwn(value, 'limits') ? value.limits : DEFAULT_LIMITS),
    locale: localeValue(Object.hasOwn(value, 'locale') ? value.locale : 'zh-CN')
  };
}
function parent(value) { return value === null ? null : assertCommentId(value); }
export function validateCommentRecord(value) {
  object(value, 'record', ['id', 'blog_id', 'reply_to', 'author', 'created_at', 'body_markdown', 'article'],
    ['id', 'blog_id', 'reply_to', 'author', 'created_at', 'body_markdown']);
  const record = { id: assertCommentId(value.id), blog_id: assertArticleId(value.blog_id),
    reply_to: parent(value.reply_to), author: authorValue(value.author), created_at: utcDate(value.created_at, 'created_at'),
    body_markdown: bodyValue(value.body_markdown) };
  assertCommentIdentity(record.id, record.blog_id);
  if (value.article !== undefined) record.article = articleValue(value.article);
  if (record.reply_to === record.id) fail('CYCLE', 'A comment may not reply to itself');
  return record;
}
export function validateArticleIndex(value) {
  object(value, 'index', ['blog_id', 'total_count', 'root_count', 'comments_enabled', 'comments']);
  if (!Array.isArray(value.comments)) fail('INVALID_FIELD', 'index.comments must be an array');
  const blog_id = assertArticleId(value.blog_id);
  const ids = new Set();
  const references = new Set();
  let count = 0;
  const comments = [];
  const tasks = [{ input: value.comments, output: comments, parentId: null, depth: 0 }];
  while (tasks.length) {
    const { input, output, parentId, depth } = tasks.pop();
    if (input.length && depth > DEFAULT_LIMITS.maxReplyDepth) fail('MAX_REPLY_DEPTH', 'Index exceeds the maximum reply depth');
    let previous = null;
    for (const node of input) {
      object(node, 'comment node', ['id', 'reply_to', 'author', 'created_at', 'body_markdown', 'children']);
      if (references.has(node)) fail('CYCLE', 'Index contains shared or cyclic tree nodes');
      references.add(node);
      const id = assertCommentId(node.id);
      if (ids.has(id)) fail('DUPLICATE_ID', 'Index contains duplicate comment IDs');
      ids.add(id);
      if (parent(node.reply_to) !== parentId) fail('INVALID_PARENT', 'Index reply_to does not match the tree parent');
      const created_at = utcDate(node.created_at, 'created_at');
      assertCommentIdentity(id, blog_id);
      if (!Array.isArray(node.children)) fail('INVALID_FIELD', 'children must be an array');
      const checked = { id, reply_to: parentId, author: authorValue(node.author), created_at, body_markdown: bodyValue(node.body_markdown), children: [] };
      if (previous && compareNodes(previous, checked) > 0) fail('INVALID_ORDER', 'Index siblings must be ordered by created_at and ID');
      previous = checked;
      output.push(checked);
      count++;
      tasks.push({ input: node.children, output: checked.children, parentId: id, depth: depth + 1 });
    }
  }
  if (integer(value.total_count, 'total_count') !== count || integer(value.root_count, 'root_count') !== comments.length) fail('INVALID_COUNT', 'Index counts do not match the tree');
  return { blog_id, total_count: count, root_count: comments.length,
    comments_enabled: bool(value.comments_enabled, 'comments_enabled'), comments };
}

function siteSettings(value = {}) {
  object(value, 'site', ['url', 'name'], []);
  let url = '';
  if (value.url !== undefined && value.url !== '') {
    textValue(value.url, 'site.url');
    let parsed;
    try { parsed = new URL(value.url); } catch { fail('INVALID_FIELD', 'site.url 必须是完整的 HTTP(S) 网站地址。'); }
    if (!['https:', 'http:'].includes(parsed.protocol) || parsed.username || parsed.password || parsed.search || parsed.hash) fail('INVALID_FIELD', 'site.url 必须是无账号、查询参数和锚点的 HTTP(S) 网站地址。');
    url = parsed.href.replace(/\/$/, '');
  }
  return { url, name: value.name === undefined || value.name === '' ? '' : textValue(value.name, 'site.name', 128).trim() };
}
function notificationSettings(value = {}) {
  object(value, 'notifications', ['enabled', 'from', 'notifyOwner', 'notifyReplies'], []);
  const from = value.from === undefined || value.from === '' ? '' : textValue(value.from, 'notifications.from', 320).trim();
  if (from && !/^(?:[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+|[^<>]+ <[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+>)$/.test(from)) fail('INVALID_FIELD', 'notifications.from 必须是发件邮箱或 名称 <邮箱>。');
  return {
    enabled: value.enabled === undefined ? false : bool(value.enabled, 'notifications.enabled'),
    from,
    notifyOwner: value.notifyOwner === undefined ? true : bool(value.notifyOwner, 'notifications.notifyOwner'),
    notifyReplies: value.notifyReplies === undefined ? true : bool(value.notifyReplies, 'notifications.notifyReplies'),
  };
}
