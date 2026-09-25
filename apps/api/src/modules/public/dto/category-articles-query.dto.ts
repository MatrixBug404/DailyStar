import { Type } from 'class-transformer';
import { IsInt, Min, Max, IsOptional, IsString, IsIn } from 'class-validator';

export class CategoryArticlesQueryDto {
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
