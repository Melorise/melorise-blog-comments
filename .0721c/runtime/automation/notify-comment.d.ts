import type { GitHubClient } from './github.js';
import type { RuntimeContext } from './runtime.js';
import type { CommentRecord, TreeNode, SiteSettings, ArticleIndex } from '../core/index.js';
export interface NotificationResult { status: 'disabled' | 'sent' | 'skipped' | 'failed'; reason?: string; code?: string; operation?: string }
export declare function buildNotificationEmail(options: { record: CommentRecord; parent?: TreeNode | null; article: { title: string; url: string }; site: SiteSettings; locale: string; from: string; to: string; reviewUrl?: string }): { from: string; to: string[]; subject: string; text: string; html: string };
export declare function notifyComment(options: { client: GitHubClient; event: any; context: RuntimeContext; indexes: Record<string, ArticleIndex>; env?: Record<string, string | undefined>; fetchImpl?: typeof fetch }): Promise<NotificationResult>;

export declare function notifyOwner(options: { record: CommentRecord; issueNumber: number; prNumber: number; context: RuntimeContext; env?: Record<string, string | undefined>; fetchImpl?: typeof fetch }): Promise<NotificationResult>;
