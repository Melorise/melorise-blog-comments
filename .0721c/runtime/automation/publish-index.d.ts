import type { NotificationResult } from './notify-comment.js';
import type { GitHubClient } from './github.js';
import type { RuntimeContext } from './runtime.js';
import type { ArticleIndex } from '../core/index.js';
export declare function publishIndex(options: { client: GitHubClient; mainCommit?: string; context?: RuntimeContext }): Promise<{ status: 'published'; commit: string; indexes: Record<string, ArticleIndex> }>;
export declare function runPublication(options: { client: GitHubClient; event: any; eventName: string; mainCommit?: string; env?: Record<string, string | undefined>; fetchImpl?: typeof fetch }): Promise<{ status: 'published'; commit: string; indexes: Record<string, ArticleIndex>; notification?: NotificationResult } | { status: 'ignored' }>;
