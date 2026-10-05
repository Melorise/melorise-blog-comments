import { ProtocolError, normalizeRepository, localeValue, assertArticleId, integer, fail, httpUrl, deepFreeze } from './shared.mjs';
import { validateArticleIndex } from './validation.mjs';
import { buildCommentIssueUrl } from './protocol.mjs';

const ARTICLE_BYTES = 8 * 1024 * 1024;
function abortReason(signal) { return signal?.reason ?? new DOMException('The operation was aborted', 'AbortError'); }
function abortCheck(signal) { if (signal?.aborted) throw abortReason(signal); }
function validateSignal(signal) {
  if (signal !== undefined && (!signal || typeof signal.aborted !== 'boolean' || typeof signal.addEventListener !== 'function' || typeof signal.removeEventListener !== 'function')) fail('INVALID_FIELD', 'signal must be an AbortSignal');
}
// Each caller owns its cancellation. Cancel a shared request only after its last reader leaves.
function subscribe(entry, signal) {
  abortCheck(signal);
  return new Promise((resolve, reject) => {
    const user = {};
    entry.users.add(user);
    let done = false;
    const finish = (callback, value) => {
      if (done) return;
      done = true;
      signal?.removeEventListener('abort', onAbort);
      entry.users.delete(user);
      callback(value);
    };
    const onAbort = () => {
      finish(reject, abortReason(signal));
      if (!entry.settled && !entry.users.size) entry.controller.abort(abortReason(signal));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
    entry.promise.then(value => finish(resolve, value), error => finish(reject, error));
    if (signal?.aborted) onAbort();
  });
}
function pendingRequest(work) {
  const entry = { controller: new AbortController(), users: new Set(), settled: false, promise: null };
  entry.promise = Promise.resolve().then(() => work(entry.controller.signal)).finally(() => { entry.settled = true; });
  return entry;
}
function decodeUtf8(decoder, bytes, options) {
  try { return decoder.decode(bytes, options); }
  catch (error) { throw new ProtocolError('INVALID_JSON', 'Index response is not valid UTF-8', { cause: error }); }
}
function indexBase(value, repository) {
  if (value === undefined) return repository.rawBaseUrl + '/';
  const url = httpUrl(value, 'indexBaseUrl');
  if (url.search || url.hash || /[?#\\]/.test(value)) fail('INVALID_URL', 'indexBaseUrl must not contain a query, fragment or backslash');
  if (!url.pathname.endsWith('/')) url.pathname += '/';
  return url.href;
}
async function readJson(fetchImpl, url, maxBytes, signal, force = false) {
  abortCheck(signal);
  const response = await fetchImpl(url, { signal, credentials: 'omit', cache: force ? 'no-store' : 'default', headers: { Accept: 'application/json' } });
  abortCheck(signal);
  if (response?.status === 404) return null;
  if (!response || !response.ok) throw new ProtocolError('HTTP_ERROR', `Index request failed with HTTP ${response?.status ?? 'unknown'}`);
  const length = response.headers?.get?.('content-length');
  if (length !== null && length !== undefined && /^\d+$/.test(length) && Number(length) > maxBytes) {
    try { await response.body?.cancel?.(); } catch { /* Cancellation is best effort. */ }
    fail('RESPONSE_TOO_LARGE', 'Index response exceeds its byte limit');
  }
  let content;
  if (response.body?.getReader) {
    const reader = response.body.getReader();
    const decoder = new TextDecoder('utf-8', { fatal: true });
    const pieces = [];
    let total = 0;
    const onAbort = () => { void reader.cancel().catch(() => {}); };
    signal?.addEventListener('abort', onAbort, { once: true });
    try {
      while (true) {
        abortCheck(signal);
        const chunk = await reader.read();
        abortCheck(signal);
        if (chunk.done) break;
        if (!(chunk.value instanceof Uint8Array)) fail('INVALID_RESPONSE', 'Index response contains non-byte stream data');
        total += chunk.value.byteLength;
        if (total > maxBytes) fail('RESPONSE_TOO_LARGE', 'Index response exceeds its byte limit');
        pieces.push(decodeUtf8(decoder, chunk.value, { stream: true }));
      }
      pieces.push(decodeUtf8(decoder));
      content = pieces.join('');
    } catch (error) {
      try { await reader.cancel(); } catch { /* Preserve the original error. */ }
      abortCheck(signal);
      if (error instanceof ProtocolError) throw error;
      throw error;
    } finally {
      signal?.removeEventListener('abort', onAbort);
      reader.releaseLock();
    }
  } else {
    if (typeof response.text !== 'function') fail('INVALID_RESPONSE', 'fetchImpl must return a text or streaming Response');
    content = await response.text();
    abortCheck(signal);
    if (new TextEncoder().encode(content).byteLength > maxBytes) fail('RESPONSE_TOO_LARGE', 'Index response exceeds its byte limit');
  }
  try { return JSON.parse(content); }
  catch (error) { throw new ProtocolError('INVALID_JSON', 'Index response is not valid JSON', { cause: error }); }
}
export function createClient({ repository, locale = 'zh-CN', indexBaseUrl, cacheTtlMs = 60000, fetchImpl = globalThis.fetch }) {
  const normalized = normalizeRepository(repository);
  localeValue(locale);
  integer(cacheTtlMs, 'cacheTtlMs');
  if (typeof fetchImpl !== 'function') fail('INVALID_FIELD', 'fetchImpl must be a function');
  const base = indexBase(indexBaseUrl, normalized);
  const cache = new Map();
  const pending = new Map();
  const latest = new Map();
  let epoch = 0;
  function clearCache() { epoch++; cache.clear(); pending.clear(); latest.clear(); }
  async function getComments(articleId, { force = false, signal } = {}) {
    assertArticleId(articleId);
    if (typeof force !== 'boolean') fail('INVALID_FIELD', 'force must be a boolean');
    validateSignal(signal);
    abortCheck(signal);
    const cached = cache.get(articleId);
    if (!force && cached && Date.now() - cached.at < cacheTtlMs) return cached.value;
    let request = pending.get(articleId);
    if (force || !request || request.controller.signal.aborted) {
      const generation = epoch;
      const sequence = (latest.get(articleId) ?? 0) + 1;
      latest.set(articleId, sequence);
      request = pendingRequest(async requestSignal => {
        const path = articleId.split('/').map(encodeURIComponent).join('/') + '.json';
        let url = new URL(path, base);
        if (force) {
          const nonce = `${Date.now()}-${sequence}`;
          if (base === normalized.rawBaseUrl + '/') {
            const referenceUrl = new URL(`https://api.github.com/repos/${encodeURIComponent(normalized.owner)}/${encodeURIComponent(normalized.repo)}/git/ref/heads/index`);
            referenceUrl.searchParams.set('refresh', nonce);
            const reference = await readJson(fetchImpl, referenceUrl.href, 64 * 1024, requestSignal, true);
            if (reference === null) fail('HTTP_ERROR', 'Index branch request failed with HTTP 404');
            if (reference.ref !== 'refs/heads/index' || reference.object?.type !== 'commit' || typeof reference.object.sha !== 'string' || !/^[0-9a-f]{40}$/.test(reference.object.sha)) fail('INVALID_RESPONSE', 'Index branch did not return a valid commit reference');
            url = new URL(path, `https://raw.githubusercontent.com/${normalized.owner}/${normalized.repo}/${reference.object.sha}/`);
          } else {
            url.searchParams.set('refresh', nonce);
          }
        }
        const json = await readJson(fetchImpl, url.href, ARTICLE_BYTES, requestSignal, force);
        const index = json === null ? null : validateArticleIndex(json);
        if (index && index.blog_id !== articleId) fail('INDEX_MISMATCH', 'Article index belongs to a different URL path');
        const enabled = index?.comments_enabled ?? true;
        const result = deepFreeze({ status: enabled ? (index?.total_count ? 'ready' : 'empty') : 'disabled',
          articleId, totalCount: index?.total_count ?? 0, rootCount: index?.root_count ?? 0,
          comments: index?.comments ?? [], commentsEnabled: enabled, index });
        abortCheck(requestSignal);
        if (generation === epoch && latest.get(articleId) === sequence) cache.set(articleId, { value: result, at: Date.now() });
        return result;
      });
      pending.set(articleId, request);
      const created = request;
      request.promise = request.promise.finally(() => { if (pending.get(articleId) === created) pending.delete(articleId); });
    }
    return subscribe(request, signal);
  }
  function getNewIssueUrl({ articleId, replyTo = null, article }) {
    return buildCommentIssueUrl({ repository: normalized.url, articleId, replyTo, article, locale });
  }
  return Object.freeze({ getComments, getNewIssueUrl, clearCache });
}
