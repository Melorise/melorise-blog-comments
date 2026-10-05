import { validateCommentRecord, buildCommentPermalink } from '../core/index.mjs';
import { list, json, recordPath, positiveInteger, readBlob } from './runtime.mjs';

const emailAddress = value => typeof value === 'string' && value.length <= 254 && /^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/.test(value) ? value : null;
const escape = value => String(value).replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
const failure = code => Object.assign(new Error(code), { code });

function findNode(index, id) {
  const pending = [...(index?.comments ?? [])];
  while (pending.length) {
    const node = pending.pop();
    if (node.id === id) return node;
    pending.push(...node.children);
  }
  return null;
}

function articleContext(record, context) {
  const base = new URL(context.settings.site.url + '/');
  const configured = context.articles[record.blog_id];
  const candidate = configured?.url || record.article?.url;
  const url = new URL(record.blog_id, base);
  if (candidate) {
    const articleUrl = new URL(candidate);
    url.pathname = articleUrl.pathname;
    url.search = articleUrl.search;
  }
  return { title: configured?.title || record.article?.title || record.blog_id, url: url.href };
}

export function buildNotificationEmail({ record, parent, article, site, locale, from, to }) {
  const english = locale === 'en';
  const heading = parent ? (english ? 'New reply to your comment' : '你的评论有了新回复') : (english ? 'New comment on your article' : '文章有了新评论');
  const subject = `${heading} · ${article.title}`.replace(/[\r\n]/g, ' ').slice(0, 240);
  const url = buildCommentPermalink(article.url, record.id);
  const author = `@${record.author.login}`;
  const label = english ? 'View comment' : '查看评论';
  const text = [site.name, heading, article.title, author, parent ? `> ${parent.body_markdown.replace(/\n/g, '\n> ')}` : '', record.body_markdown, `${label}: ${url}`].filter(Boolean).join('\n\n');
  const html = `<div style="font-family:system-ui,sans-serif;max-width:640px;margin:auto;line-height:1.7;color:#333"><h2>${escape(heading)}</h2><p>${escape(article.title)}</p><p>${escape(author)}</p>${parent ? `<blockquote style="white-space:pre-wrap;border-left:3px solid #ddd;padding-left:16px;color:#666">${escape(parent.body_markdown)}</blockquote>` : ''}<div style="white-space:pre-wrap">${escape(record.body_markdown)}</div><p><a href="${escape(url)}">${escape(label)}</a></p>${site.name ? `<p>${escape(site.name)}</p>` : ''}</div>`;
  return { from, to: [to], subject, text, html };
}

export async function notifyComment({ client, event, context, indexes, env = process.env, fetchImpl = globalThis.fetch }) {
  const settings = context.settings.notifications;
  if (!settings.enabled) return { status: 'disabled' };
  const prNumber = positiveInteger(event.pull_request?.number, 'PR number');
  const pr = await client.request('GET', `${client.basePath}/pulls/${prNumber}`);
  if (!pr.merged || pr.state !== 'closed' || pr.base?.ref !== 'comments' || pr.base?.repo?.id !== context.repository.id || pr.head?.repo?.id !== context.repository.id || !/^comment-[1-9][0-9]*$/.test(pr.head?.ref)) throw failure('NOT_A_COMMENT_PR');
  const files = await list(client, `${client.basePath}/pulls/${prNumber}/files`);
  if (pr.changed_files !== 1 || files.length !== 1 || files[0].status !== 'added') throw failure('NOT_A_COMMENT_PR');
  const file = files[0];
  // PR file listings contain the reviewed blob SHA, even when merge_commit_sha is omitted.
  const record = validateCommentRecord(json(await readBlob(client, {
    path: file.filename, sha: file.sha, type: 'blob', mode: '100644',
  }), 'approved comment'));
  if (recordPath(record) !== file.filename || record.id !== `${record.blog_id}/comments-${pr.head.ref.slice('comment-'.length)}`) throw failure('COMMENT_PATH_MISMATCH');
  const index = indexes[record.blog_id];
  const published = findNode(index, record.id);
  if (!published || published.body_markdown !== record.body_markdown || published.author.login !== record.author.login || published.reply_to !== record.reply_to || published.created_at !== record.created_at) throw failure('COMMENT_NOT_PUBLISHED');
  const kind = record.reply_to === null ? 'owner' : 'reply';
  const skip = reason => ({ status: 'skipped', reason });
  if ((kind === 'owner' && !settings.notifyOwner) || (kind === 'reply' && !settings.notifyReplies)) return skip('recipient-disabled');
  const parent = record.reply_to === null ? null : findNode(index, record.reply_to);
  if (record.reply_to !== null && !parent) throw failure('PARENT_NOT_PUBLISHED');
  if (parent?.author.login.toLowerCase() === record.author.login.toLowerCase()) return skip('self-reply');
  if (typeof env.RESEND_API_KEY !== 'string' || !env.RESEND_API_KEY.trim()) throw failure('RESEND_API_KEY_MISSING');
  let to;
  if (kind === 'owner') {
    to = emailAddress(env.COMMENTS_OWNER_EMAIL);
    if (!to) throw failure('COMMENTS_OWNER_EMAIL_MISSING');
  } else {
    const user = await client.request('GET', `/users/${encodeURIComponent(parent.author.login)}`);
    if (user.login?.toLowerCase() !== parent.author.login.toLowerCase()) throw failure('RECIPIENT_MISMATCH');
    to = emailAddress(user.email);
    if (!to) return skip('no-public-email');
  }
  const article = articleContext(record, context);
  const payload = buildNotificationEmail({ record, parent, article, site: context.settings.site, locale: context.settings.locale, from: settings.from, to });
  const serialized = JSON.stringify(payload);
  const key = `0721c/${context.repository.id}/pr-${prNumber}/${kind}`;
  let response;
  try {
    response = await fetchImpl('https://api.resend.com/emails', {
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(20000),
      headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json', 'Idempotency-Key': key },
      body: serialized,
    });
  } catch { throw failure('RESEND_RESULT_UNKNOWN'); }
  if (!response.ok) throw failure(`RESEND_HTTP_${response.status}`);
  return { status: 'sent' };
}
