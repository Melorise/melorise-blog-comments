import type { GitHubClient } from './github.js';
import type { CommentRecord } from '../core/index.js';
import type { RuntimeContext } from './runtime.js';
export declare function validatePullRequest(options: { client: GitHubClient; prNumber: number; mainCommit?: string; context?: RuntimeContext }): Promise<{ valid: true; headSha: string; pr: any; record: CommentRecord }>;
export declare function runValidation(options: { client: GitHubClient; event: any; eventName: string; mainCommit?: string }): Promise<{ valid: true; headSha: string; pr: any; record: CommentRecord }>;
