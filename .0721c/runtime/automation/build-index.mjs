import { validateSettings, validateCommentRecord, validateArticleIndex, buildCommentTree, assertArticleId } from '../core/index.mjs';

export function validateArticles(articles = {}) {
  if (!articles || typeof articles !== 'object' || Array.isArray(articles) ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(articles))) throw new Error('Invalid articles map');
  for (const [id, entry] of Object.entries(articles)) {
    assertArticleId(id);
    if (!entry || typeof entry !== 'object' || Array.isArray(entry) || typeof entry.enabled !== 'boolean' ||
        Object.keys(entry).some(key => !['enabled', 'title', 'url'].includes(key)) ||
        (entry.title !== undefined && typeof entry.title !== 'string') ||
        (entry.url !== undefined && typeof entry.url !== 'string')) throw new Error(`Invalid article configuration: ${id}`);
    if (entry.url !== undefined) {
      const url = new URL(entry.url);
      if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) throw new Error(`Invalid article URL: ${id}`);
    }
  }
  return articles;
}

export function commentsEnabled(id, settings, articles = {}) {
  return !settings.articlePolicy.disabledIds.includes(id) &&
    (!Object.hasOwn(articles, id) || articles[id].enabled) &&
    (settings.articlePolicy.mode === 'open' || Object.hasOwn(articles, id));
}

/** Validate the entire approved snapshot before returning any publishable data. */
export function buildIndexes({ records, settings, articles = {} }) {
  settings = validateSettings(settings);
  validateArticles(articles);
  if (!Array.isArray(records)) throw new TypeError('records must be an array');
  const ids = new Set();
  const groups = new Map([...Object.keys(articles), ...settings.articlePolicy.disabledIds].map(id => [id, []]));
  for (const value of records) {
    let record;
    try {
      record = validateCommentRecord(value);
      if (Array.from(record.body_markdown).length > settings.limits.bodyCodepoints ||
          new TextEncoder().encode(record.body_markdown).length > settings.limits.bodyBytes) throw new Error('Comment body exceeds configured limits');
      if (ids.has(record.id)) throw new Error(`Duplicate comment ID: ${record.id}`);
    } catch (error) {
      if (typeof value?.blog_id === 'string' && typeof value?.id === 'string') error.file = `${value.id}.json`;
      throw error;
    }
    ids.add(record.id);
    if (!groups.has(record.blog_id)) groups.set(record.blog_id, []);
    groups.get(record.blog_id).push(record);
  }
  const indexes = Object.create(null);
  for (const id of [...groups.keys()].sort()) {
    try {
      const tree = buildCommentTree(groups.get(id), { maxReplyDepth: settings.limits.maxReplyDepth });
      indexes[id] = validateArticleIndex({ blog_id: id, ...tree, comments_enabled: commentsEnabled(id, settings, articles) });
    } catch (error) {
      error.files = groups.get(id).map(record => `${record.id}.json`);
      throw error;
    }
  }
  return { indexes };
}
