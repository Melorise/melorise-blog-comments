import { DEFAULT_LIMITS, assertArticleId, assertCommentId, normalizeRepository, localeValue, limitsValue, bodyValue, object, fail, articleValue } from './shared.mjs';

// Duplicate routing keys fail closed, including escaped JSON property names.
function metadataJson(source) {
  let value;
  try { value = JSON.parse(source); } catch { fail('INVALID_METADATA', 'Metadata must contain valid JSON'); }
  object(value, 'metadata', ['blog_id', 'reply_to', 'article'], ['blog_id']);
  const names = new Set();
  let depth = 0;
  for (let i = 0; i < source.length; i++) {
    if (source[i] === '{' || source[i] === '[') depth++;
    else if (source[i] === '}' || source[i] === ']') depth--;
    else if (source[i] === '"') {
      const start = i++;
      for (; i < source.length; i++) {
        if (source[i] === '\\') i++;
        else if (source[i] === '"') break;
      }
      let after = i + 1;
      while (/\s/.test(source[after] ?? '') && after < source.length) after++;
      if (depth === 1 && source[after] === ':') {
        const name = JSON.parse(source.slice(start, i + 1));
        if (names.has(name)) fail('INVALID_METADATA', 'Duplicate metadata key');
        names.add(name);
      }
    }
  }
  const blog_id = assertArticleId(value.blog_id);
  let reply_to = Object.hasOwn(value, 'reply_to') ? value.reply_to : null;
  if (typeof reply_to === 'string' && !reply_to.trim()) reply_to = null;
  if (reply_to !== null) assertCommentId(reply_to);
  return { metadata: { blog_id, reply_to }, ...(value.article !== undefined ? { article: articleValue(value.article) } : {}) };
}

export function parseIssueBody(body, limits = DEFAULT_LIMITS) {
  if (typeof body !== 'string') fail('INVALID_BODY', 'Issue body must be a string');
  const allowed = limitsValue(limits);
  const normalized = body.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  const newline = normalized.indexOf('\n');
  const first = newline === -1 ? normalized : normalized.slice(0, newline);
  const match = /^<!--\s*0721c-meta:\s*(\{.*\})\s*-->\s*$/.exec(first);
  if (!match) fail('INVALID_METADATA', 'The first line must be a complete 0721c metadata comment');
  const parsed = metadataJson(match[1]);
  let content = (newline === -1 ? '' : normalized.slice(newline + 1)).trim();
  if (/^<!--\s*0721c-instructions(?=\s|-->)/.test(content)) {
    const end = content.indexOf('-->');
    if (end < 0) fail('INVALID_TEMPLATE', 'Unclosed instructions comment');
    const instructions = content.slice(0, end + 3);
    if ((instructions.match(/0721c-(?:meta|instructions)/gi) ?? []).length !== 1 || instructions.slice(4).includes('<!--')) {
      fail('INVALID_TEMPLATE', 'Duplicate or nested template instructions');
    }
    content = content.slice(end + 3).trim();
  }
  return { ...parsed, body_markdown: bodyValue(content, allowed) };
}

const instructions = {
  'zh-CN': '请勿修改或删除上面的文章标识和本模板。\n请在下方填写评论正文。\n评论会在审核通过后显示在文章下方。',
  en: 'Do not change or remove the article metadata or this template.\nWrite your comment below.\nYour comment will be displayed under the article after approval.'
};
export function buildCommentIssueUrl({ repository, articleId, replyTo = null, article, locale = 'zh-CN' }) {
  const normalized = normalizeRepository(repository);
  assertArticleId(articleId);
  if (replyTo !== null) assertCommentId(replyTo);
  localeValue(locale);
  const context = articleValue(article);
  const metadata = JSON.stringify({ blog_id: articleId, reply_to: replyTo, ...(context ? { article: context } : {}) })
    .replace(/[<>&]/g, c => ({ '<': '\\u003c', '>': '\\u003e', '&': '\\u0026' }[c]));
  const url = new URL(`${normalized.url}/issues/new`);
  const label = context?.title ?? articleId;
  url.searchParams.set('title', `${locale === 'en' ? 'Comment' : '评论'}：${Array.from(label).slice(0, 240).join('')}`);
  url.searchParams.set('body', `<!-- 0721c-meta:${metadata} -->\n<!-- 0721c-instructions\n${instructions[locale]}\n-->\n\n`);
  return url.href;
}
