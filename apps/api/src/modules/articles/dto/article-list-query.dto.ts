import { Type, Transform } from 'class-transformer';
import { IsInt, Min, Max, IsOptional, IsUUID, IsIn, IsEnum } from 'class-validator';

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

export class ArticleListQueryDto {
  @IsInt()
  @Min(1)
  @Type(() => Number)
  @IsOptional()
  page: number = 1;

  @IsInt()
  @Min(1)
  @Max(100)
  @Type(() => Number)
  @IsOptional()
  limit: number = 20;

  @Transform(({ value }) => {
    if (typeof value === 'string') {
      return value.split(',').map((s) => s.trim()).filter(Boolean);
    }
    return value;
  })
  @IsEnum(ArticleStatus, { each: true })
  @IsOptional()
  status?: ArticleStatus[];

  @IsUUID()
  @IsOptional()
  categoryId?: string;

  @IsIn(['updatedAt', 'createdAt', 'title'])
  @IsOptional()
  sortBy: 'updatedAt' | 'createdAt' | 'title' = 'updatedAt';

  @IsIn(['asc', 'desc'])
  @IsOptional()
  order: 'asc' | 'desc' = 'desc';
}
