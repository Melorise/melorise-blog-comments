/** Browser-safe comments protocol and direct per-article index client. */
export interface Limits { bodyCodepoints: number; bodyBytes: number; maxReplyDepth: number }
export const DEFAULT_LIMITS: Readonly<Limits>;
export class ProtocolError extends Error {
  readonly code: string;
  constructor(code: string, message: string, options?: ErrorOptions);
}
export type Locale = 'zh-CN' | 'en';
export type ArticlePolicy = 'open' | 'allowlist';
export interface Repository { owner: string; repo: string; url: string; rawBaseUrl: string }
export interface SiteSettings { url: string; name: string }
export interface NotificationSettings { enabled: boolean; from: string; notifyOwner: boolean; notifyReplies: boolean }
export interface Settings {
  schema_version: 1;
  articlePolicy: { mode: ArticlePolicy; disabledIds: string[] };
  limits: Limits;
  locale: Locale;
  site: SiteSettings;
  notifications: NotificationSettings;
}
export interface SettingsInput {
  schema_version?: 1;
  articlePolicy?: { mode?: ArticlePolicy; disabledIds?: string[] };
  limits?: Partial<Limits>;
  locale?: Locale;
  site?: Partial<SiteSettings>;
  notifications?: Partial<NotificationSettings>;
}
export interface IssueMetadata { blog_id: string; reply_to: string | null }
export interface ArticleContext { title: string; url?: string }
export interface ParsedIssueBody { metadata: IssueMetadata; body_markdown: string; article?: ArticleContext }
export interface CommentAuthor { login: string; avatar_url?: string }
export interface CommentRecord {
  id: string;
  blog_id: string;
  reply_to: string | null;
  author: CommentAuthor;
  created_at: string;
  body_markdown: string;
  article?: ArticleContext;
}
export interface TreeNode {
  id: string;
  reply_to: string | null;
  author: CommentAuthor;
  created_at: string;
  body_markdown: string;
  children: TreeNode[];
}
export type CommentNode = TreeNode;
export interface CommentTree { comments: TreeNode[]; total_count: number; root_count: number }
export interface ArticleIndex extends CommentTree { blog_id: string; comments_enabled: boolean }
export interface ArticlesConfig { schema_version: 1; articles: Record<string, { title?: string; url?: string; enabled: boolean }> }
export interface IssueUrlOptions { repository: string; articleId: string; replyTo?: string | null; article?: ArticleContext; locale?: Locale }
export interface RequestOptions { force?: boolean; signal?: AbortSignal }
export interface ClientOptions {
  repository: string;
  locale?: Locale;
  indexBaseUrl?: string;
  cacheTtlMs?: number;
  /** Standard Fetch signature; requests omit credentials. */
  fetchImpl?: typeof globalThis.fetch;
}
export interface CommentsResult {
  status: 'ready' | 'empty' | 'disabled';
  articleId: string;
  totalCount: number;
  rootCount: number;
  comments: TreeNode[];
  commentsEnabled: boolean;
  index: ArticleIndex | null;
}
export interface Client {
  getComments(articleId: string, options?: RequestOptions): Promise<CommentsResult>;
  getNewIssueUrl(options: { articleId: string; replyTo?: string | null; article?: ArticleContext }): string;
  clearCache(): void;
}
export type CommentsClient = Client;
export type CommentResult = CommentsResult;
export function normalizeRepository(input: unknown): Repository;
/** A safe relative URL path, e.g. article/essay/2026-09-28-hello. */
export function assertArticleId(value: unknown): string;
/** <articlePath>/comments-<GitHub Issue number>, e.g. article/hello/comments-37. */
export function assertCommentId(value: unknown): string;
export function validateSettings(value?: unknown): Settings;
export function parseIssueBody(body: unknown, limits?: Partial<Limits>): ParsedIssueBody;
export function buildCommentIssueUrl(options: IssueUrlOptions): string;
export function validateCommentRecord(value: unknown): CommentRecord;
export function validateArticleIndex(value: unknown): ArticleIndex;
export function buildCommentTree(records: readonly CommentRecord[], options?: { maxReplyDepth?: number }): CommentTree;
export function createClient(options: ClientOptions): Client;
export function buildCommentPermalink(articleUrl: string, commentId: string): string;
