import type { GitHubClient } from './github.js';
import type { CommentRecord, Settings } from '../core/index.js';
import type { ArticleConfiguration } from './build-index.js';
export declare const STATUS_CONTEXT: '0721c/comment-data';
export declare function serialize(value: unknown): string;
export declare function assertSha(value: string): string;
export declare function positiveInteger(value: number, label?: string): number;
export declare function inputNumber(value: string, label: string): number;
export declare function recordPath(record: CommentRecord): string;
export declare function parseRecordPath(path: string): { blog_id: string; id: string };
export declare function json(text: string, path: string): any;
export declare function optional<T>(operation: () => Promise<T>): Promise<T | null>;
export declare function list(client: GitHubClient, path: string): Promise<any[]>;
export declare function ref(client: GitHubClient, name: string): Promise<any | null>;
export declare function requiredRef(client: GitHubClient, name: string): Promise<string>;
export interface RuntimeContext { client: GitHubClient; repository: any; mainCommit: string; settings: Settings; articles: Record<string, ArticleConfiguration> }
export declare function loadDeployment(client: GitHubClient, mainCommit?: string): Promise<RuntimeContext>;
export interface TreeEntry { path: string; mode: string; type: string; sha: string }
export interface Candidate { sha: string; record: CommentRecord; path: string }
export declare function readTree(client: GitHubClient, commit: string): Promise<{ commit: any; entries: TreeEntry[] }>;
export declare function readBlob(client: GitHubClient, entry: TreeEntry): Promise<string>;
export declare function readRecords(client: GitHubClient, commit: string): Promise<{ commit: any; entries: TreeEntry[]; records: CommentRecord[] }>;
export declare function addedRecordEntry(base: TreeEntry[], head: TreeEntry[]): TreeEntry;
export declare function candidateFromCommit(client: GitHubClient, commit: string): Promise<Candidate>;
export declare function createCommit(client: GitHubClient, options: { parent?: string; message: string; files: Record<string, string> }): Promise<string>;
export declare function setStatus(client: GitHubClient, sha: string, state: string, description: string): Promise<any>;
export declare function actionContext(env?: Record<string, string | undefined>): Promise<{ client: GitHubClient; event: any; eventName: string; mainCommit?: string }>;
export declare function isDirectEntry(url: string): boolean;
export declare function reportFailure(error: unknown): void;
