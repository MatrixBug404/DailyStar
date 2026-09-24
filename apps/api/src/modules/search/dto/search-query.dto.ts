import { Transform, Type } from 'class-transformer';
import { IsString, IsNotEmpty, MaxLength, IsInt, Min, Max, IsOptional } from 'class-validator';

export class SearchQueryDto {
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  q!: string;

  @IsInt()
  @Min(1)
  @Type(() => Number)
  @IsOptional()
  page: number = 1;

  @IsInt()
  @Min(1)
  @Max(20)
  @Type(() => Number)
  @IsOptional()
  limit: number = 10;

  @IsString()
  @IsOptional()
  categorySlug?: string;

  @IsString()
  @IsOptional()
  tag?: string;
}
