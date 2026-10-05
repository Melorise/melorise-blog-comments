import { DEFAULT_LIMITS, fail, integer, compareNodes } from './shared.mjs';
import { validateCommentRecord } from './validation.mjs';

export function buildCommentTree(records, { maxReplyDepth = DEFAULT_LIMITS.maxReplyDepth } = {}) {
  if (!Array.isArray(records)) fail('INVALID_FIELD', 'records must be an array');
  integer(maxReplyDepth, 'maxReplyDepth');
  if (maxReplyDepth > DEFAULT_LIMITS.maxReplyDepth) fail('INVALID_LIMITS', 'maxReplyDepth exceeds the protocol maximum');
  const checked = Array.from(records, validateCommentRecord);
  const byId = new Map();
  let article;
  for (const record of checked) {
    article ??= record.blog_id;
    if (record.blog_id !== article) fail('CROSS_ARTICLE', 'A comment tree must contain exactly one article group');
    if (byId.has(record.id)) fail('DUPLICATE_ID', 'Duplicate comment ID');
    byId.set(record.id, record);
  }
  const depths = new Map();
  for (const record of checked) {
    const chain = [];
    const visiting = new Set();
    let current = record;
    let depth = -1;
    while (current) {
      if (depths.has(current.id)) { depth = depths.get(current.id); break; }
      if (visiting.has(current.id)) fail('CYCLE', 'Comment parent chain contains a cycle');
      visiting.add(current.id);
      chain.push(current);
      if (current.reply_to === null) break;
      const parent = byId.get(current.reply_to);
      if (!parent) fail('MISSING_PARENT', 'Reply parent is missing from this article');
      current = parent;
    }
    for (let i = chain.length - 1; i >= 0; i--) {
      depth++;
      if (depth > maxReplyDepth) fail('MAX_REPLY_DEPTH', 'Comment parent chain exceeds maxReplyDepth');
      depths.set(chain[i].id, depth);
    }
  }
  const nodes = new Map(checked.map(record => [record.id, {
    id: record.id, reply_to: record.reply_to, author: record.author, created_at: record.created_at,
    body_markdown: record.body_markdown, children: []
  }]));
  const comments = [];
  for (const record of checked) {
    const node = nodes.get(record.id);
    if (record.reply_to === null) comments.push(node);
    else nodes.get(record.reply_to).children.push(node);
  }
  comments.sort(compareNodes);
  for (const node of nodes.values()) node.children.sort(compareNodes);
  return { comments, total_count: checked.length, root_count: comments.length };
}
