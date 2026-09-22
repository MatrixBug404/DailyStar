export class UploadMediaResponseDto {
  id!: string;
  originalFilename!: string;
  mimeType!: string;
  mediaType!: string;
  fileSizeBytes!: string;
  width!: number | null;
  height!: number | null;
  status!: string;
  uploadedById!: string;
  createdAt!: Date;
}
