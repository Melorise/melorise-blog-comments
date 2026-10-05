import type { CommentRecord, ArticleIndex, Settings } from '../core/index.js';
export interface ArticleConfiguration { enabled: boolean; title?: string; url?: string }
export declare function validateArticles(articles?: Record<string, ArticleConfiguration>): Record<string, ArticleConfiguration>;
export declare function commentsEnabled(id: string, settings: Settings, articles?: Record<string, ArticleConfiguration>): boolean;
export declare function buildIndexes(options: {
  records: CommentRecord[];
  settings: unknown;
  articles?: Record<string, ArticleConfiguration>;
}): { indexes: Record<string, ArticleIndex> };
