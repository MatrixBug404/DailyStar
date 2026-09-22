import { IsOptional, IsString, IsUUID, MaxLength, MinLength, IsNumber, Min } from 'class-validator';

export class UpdateArticleDto {
  @IsString()
  @IsOptional()
  @MinLength(3)
  @MaxLength(150)
  title?: string;

  @IsString()
  @IsOptional()
  body?: string;

  @IsString()
  @IsOptional()
  @MaxLength(500)
  excerpt?: string;

  @IsUUID()
  @IsOptional()
  categoryId?: string;

  @IsString({ each: true })
  @IsOptional()
  tags?: string[];

  @IsNumber()
  @IsOptional()
  @Min(1)
  expectedVersion?: number;
}
