export declare const API_VERSION: '2026-03-10';
export declare class GitHubAPIError extends Error {
  status: number;
  method: string;
  path: string;
  constructor(status: number, method: string, path: string);
}
export interface GitHubClientOptions {
  repository: string;
  token: string;
  fetchImpl?: typeof globalThis.fetch;
}
export declare class GitHubClient {
  readonly owner: string;
  readonly repo: string;
  readonly basePath: string;
  constructor(options: GitHubClientOptions);
  request<T = any>(method: string, path: string, body?: unknown): Promise<T | null>;
  readFile(path: string, ref: string): Promise<string>;
}
