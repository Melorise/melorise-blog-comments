import type { GitHubClient } from './github.js';
import type { Candidate } from './runtime.js';
import type { NotificationResult } from './notify-comment.js';
export declare function findCommentPullRequest(client: GitHubClient, number: number): Promise<any | null>;
export declare function runIntake(options: { client: GitHubClient; event: any; eventName: string; mainCommit?: string; env?: Record<string, string | undefined>; fetchImpl?: typeof fetch }): Promise<{ status: 'ignored' | 'pending' | 'approved' | 'rejected'; candidate?: Candidate; pr?: any; notification?: NotificationResult }>;
export declare function createCommentId(articleId: string, issueNumber: number): string;
