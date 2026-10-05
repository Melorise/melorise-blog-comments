import type { CommentRecord } from '../core/index.js';
import type { ArticleConfiguration } from './build-index.js';
export declare function buildReviewPullRequest(record: CommentRecord, options?: { articles?: Record<string, ArticleConfiguration>; parent?: CommentRecord }): { title: string; body: string };
