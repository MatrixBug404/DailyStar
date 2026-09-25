import { Type } from 'class-transformer';
import { IsInt, Min, Max, IsOptional, IsString, IsUUID, IsIn } from 'class-validator';

export class PublicFeedQueryDto {
  @IsInt()
  @Min(1)
  @Type(() => Number)
  @IsOptional()
  page: number = 1;

  @IsInt()
  @Min(1)
  @Max(50)
  @Type(() => Number)
  @IsOptional()
  limit: number = 20;

  @IsUUID()
  @IsOptional()
  categoryId?: string;

  @IsString()
  @IsOptional()
  categorySlug?: string;

  @IsString()
  @IsOptional()
  tag?: string;

  @IsIn(['publishedAt'])
  @IsOptional()
  orderBy = 'publishedAt' as const;

  @IsIn(['asc', 'desc'])
  @IsOptional()
  order: 'asc' | 'desc' = 'desc';
}
