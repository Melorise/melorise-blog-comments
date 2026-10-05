import type { GitHubClient } from './github.js';
import type { Candidate } from './runtime.js';
export declare function findCommentPullRequest(client: GitHubClient, number: number): Promise<any | null>;
export declare function runIntake(options: { client: GitHubClient; event: any; eventName: string; mainCommit?: string }): Promise<{ status: 'ignored' | 'pending' | 'approved' | 'rejected'; candidate?: Candidate; pr?: any }>;
export declare function createCommentId(articleId: string, issueNumber: number): string;
