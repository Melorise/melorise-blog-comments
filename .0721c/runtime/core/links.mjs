import { assertCommentId } from './shared.mjs';

export function buildCommentPermalink(articleUrl, commentId) {
  assertCommentId(commentId);
  const url = new URL(articleUrl);
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) throw new TypeError('Comment links require a credential-free HTTP(S) URL');
  url.hash = '';
  url.searchParams.set('comment', commentId);
  return url.href;
}
