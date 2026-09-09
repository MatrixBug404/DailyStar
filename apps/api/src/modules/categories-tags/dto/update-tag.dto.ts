import { IsNotEmpty, IsString, MaxLength, MinLength } from 'class-validator';

export class UpdateTagDto {
  @IsString()
  @IsNotEmpty()
  @MinLength(2)
  @MaxLength(40)
  name!: string;
}
