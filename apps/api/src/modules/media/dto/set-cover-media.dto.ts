import { IsOptional, IsUUID, IsNotEmpty, IsInt, Min } from 'class-validator';
import { Type } from 'class-transformer';

export class SetCoverMediaDto {
  @IsOptional()
  @IsUUID('4')
  mediaId?: string | null;

  @IsNotEmpty()
  @IsInt()
  @Min(1)
  @Type(() => Number)
  expectedVersion!: number;
}
