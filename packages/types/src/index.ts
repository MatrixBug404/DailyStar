/**
 * @dailystar/types
 *
 * Shared TypeScript types, interfaces, and enums for the DailyStar platform.
 * This package defines the API contract between the frontend (apps/web) and
 * the backend (apps/api), ensuring type safety across the monorepo.
 *
 * Types will be added phase by phase:
 *   - Phase 1: User, Role, Permission, AuthToken types
 *   - Phase 2: Article, ArticleRevision, Category, Tag types
 *   - Phase 3: WorkflowTransition, AuditLog types
 *   - Phase 4: Media types
 *   - Phase 9: Source, NewsItem, AIAnalysis types
 *
 * Guideline: only plain TypeScript types/interfaces/enums — no runtime logic,
 * no framework imports, no database ORM references.
 */

// ─── Health / API base types ──────────────────────────────────────────────────

/** Standard API health check response shape */
export interface HealthResponse {
  status: 'ok' | 'error';
  timestamp: string;
  version?: string;
}

/** Standard paginated API response envelope */
export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
}

/** Standard API error response shape */
export interface ApiErrorResponse {
  statusCode: number;
  message: string | string[];
  error?: string;
  timestamp: string;
  path: string;
}
