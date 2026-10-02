export enum ArticleStatus {
  DRAFT = 'DRAFT',
  SUBMITTED_FOR_REVIEW = 'SUBMITTED_FOR_REVIEW',
  UNDER_REVIEW = 'UNDER_REVIEW',
  APPROVED = 'APPROVED',
  SCHEDULED = 'SCHEDULED',
  PUBLISHED = 'PUBLISHED',
  ARCHIVED = 'ARCHIVED',
  FAILED_TO_PUBLISH = 'FAILED_TO_PUBLISH',
}

export interface SafeUser {
  id: string;
  email: string;
  displayName: string | null;
  isActive?: boolean;
  tokenVersion?: number;
  createdAt?: string | Date;
  updatedAt?: string | Date;
  roles?: string[];
  permissions?: string[];
}

export interface ArticleRevisionSummary {
  id: string;
  revisionNumber: number;
  createdAt: string | Date;
  authorId: string;
  title?: string;
  excerpt?: string | null;
}

export interface ArticleRevision {
  id: string;
  articleId: string;
  authorId: string;
  revisionNumber: number;
  title: string;
  body: string;
  excerpt: string | null;
  createdAt: string | Date;
}

export interface ArticleSummary {
  id: string;
  slug: string;
  status: ArticleStatus;
  primaryAuthorId: string;
  categoryId: string | null;
  currentRevisionId: string | null;
  currentPublishedRevisionId: string | null;
  approvedRevisionId: string | null;
  reviewerId: string | null;
  publishedAt: string | Date | null;
  scheduledFor: string | Date | null;
  version: number;
  createdAt: string | Date;
  updatedAt: string | Date;
  deletedAt?: string | Date | null;
  createdBy: string;
  updatedBy: string | null;
  coverMediaId?: string | null;
  currentRevision?: ArticleRevision | ArticleRevisionSummary | null;
}

export interface Article {
  id: string;
  slug: string;
  status: ArticleStatus;
  primaryAuthorId: string;
  categoryId: string | null;
  currentRevisionId: string | null;
  currentPublishedRevisionId: string | null;
  approvedRevisionId: string | null;
  reviewerId: string | null;
  publishedAt: string | Date | null;
  scheduledFor: string | Date | null;
  version: number;
  createdAt: string | Date;
  updatedAt: string | Date;
  deletedAt?: string | Date | null;
  createdBy: string;
  updatedBy: string | null;
  coverMediaId: string | null;
  currentRevision?: ArticleRevision | null;
  tags?: Array<{
    articleId: string;
    tagId: string;
    tag?: {
      id: string;
      name: string;
      slug: string;
    };
  }>;
}

export interface WorkflowTransitionBody {
  expectedVersion?: number;
  comment?: string;
  scheduledFor?: string;
}

export interface MediaSummary {
  id: string;
  originalFilename: string;
  mimeType: string;
  mediaType: string;
  fileSizeBytes: string;
  width: number | null;
  height: number | null;
  status: string;
  uploadedById: string;
  createdAt: string | Date;
}

export interface CategorySummary {
  id: string;
  name: string;
  slug: string;
  parentId: string | null;
  createdAt?: string | Date;
  updatedAt?: string | Date;
  children?: CategorySummary[];
}
