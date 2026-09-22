import { UploadMediaResponseDto } from './upload-media-response.dto';

export class ListMediaResponseDto {
  data!: UploadMediaResponseDto[];
  total!: number;
  page!: number;
  limit!: number;
}
