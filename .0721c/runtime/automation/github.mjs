import { normalizeRepository } from '../core/index.mjs';

export const API_VERSION = '2026-03-10';

export class GitHubAPIError extends Error {
  constructor(status, method, path) {
    super(`GitHub API ${method} ${path.split('?')[0]} failed (${status})`);
    this.name = 'GitHubAPIError';
    this.status = status;
    this.method = method;
    this.path = path.split('?')[0];
  }
}

/** Node-only REST client. Never follows redirects or accepts an alternate origin. */
export class GitHubClient {
  constructor({ repository, token, fetchImpl = globalThis.fetch }) {
    const { owner, repo } = normalizeRepository(repository);
    if (typeof token !== 'string' || !token.trim()) throw new Error('GitHub token is required');
    if (typeof fetchImpl !== 'function') throw new TypeError('fetchImpl must be a function');
    this.owner = owner;
    this.repo = repo;
    this.basePath = `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;
    Object.defineProperties(this, {
      token: { value: token },
      fetchImpl: { value: fetchImpl },
    });
  }

  async request(method, path, body) {
    if (!['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD'].includes(method)) {
      throw new TypeError('Unsupported GitHub request method');
    }
    if (typeof path !== 'string' || !/^\/(?!\/)/.test(path) || /[\\#\s]/.test(path)) {
      throw new TypeError('GitHub API path must be API-root relative');
    }
    const decoded = decodeURIComponent(path.split('?')[0]);
    if (decoded.split('/').some(part => part === '..' || part === '.') || /[\\\x00-\x20]/.test(decoded)) {
      throw new TypeError('Invalid GitHub API path');
    }
    const url = new URL(path, 'https://api.github.com');
    if (url.origin !== 'https://api.github.com') throw new TypeError('Invalid GitHub API origin');
    let response;
    try {
      response = await this.fetchImpl(url.href, {
        method,
        redirect: 'error',
        headers: {
          Accept: 'application/vnd.github+json',
          Authorization: `Bearer ${this.token}`,
          'X-GitHub-Api-Version': API_VERSION,
          'User-Agent': '0721c-runtime/0.3.1',
          ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    } catch {
      // Injected transports and remote responses can contain credentials: never echo them.
      throw new GitHubAPIError(0, method, path);
    }
    if (!response.ok) throw new GitHubAPIError(response.status, method, path);
    if (response.status === 204 || method === 'HEAD') return null;
    const text = await response.text();
    if (!text.trim()) return null;
    try { return JSON.parse(text); }
    catch { throw new GitHubAPIError(response.status, method, path); }
  }

  async readFile(path, ref) {
    if (typeof path !== 'string' || !path || path.startsWith('/') || path.split('/').some(p => !p || p === '.' || p === '..')) {
      throw new TypeError('Invalid repository file path');
    }
    if (typeof ref !== 'string' || !ref) throw new TypeError('File ref is required');
    const file = await this.request('GET', `${this.basePath}/contents/${path.split('/').map(encodeURIComponent).join('/')}?ref=${encodeURIComponent(ref)}`);
    if (!file || file.type !== 'file' || file.encoding !== 'base64' || typeof file.content !== 'string') {
      throw new Error(`Expected a UTF-8 file: ${path}`);
    }
    return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(Buffer.from(file.content, 'base64'));
  }
}
