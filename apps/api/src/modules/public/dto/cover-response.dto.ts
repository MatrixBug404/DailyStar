export class CoverResponseDto {
  signedUrl!: string;
  expiresAt!: string;
  mimeType!: string;
  width!: number | null;
  height!: number | null;
}
