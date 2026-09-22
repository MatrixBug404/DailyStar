// Dynamic import of file-type ESM is done in detectMimeType

export const ALLOWED_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'] as const;
export type AllowedMimeType = (typeof ALLOWED_MIME_TYPES)[number];

export const MIME_TO_EXTENSION: Record<AllowedMimeType, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/gif': '.gif',
};

export interface MagicByteResult {
  mimeType: AllowedMimeType;
  ext: string;
}

export async function detectMimeType(buffer: Buffer): Promise<MagicByteResult> {
  // Load file-type module using require for compatibility with Jest and CommonJS
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const fileTypeModule = require('file-type');
  const { fileTypeFromBuffer } = fileTypeModule.default ?? fileTypeModule;
  const result = await fileTypeFromBuffer(buffer);
  if (!result) throw new Error('INVALID_FILE_SIGNATURE');
  const mimeType = result.mime;
  if (!ALLOWED_MIME_TYPES.includes(mimeType as AllowedMimeType)) {
    throw new Error('UNSUPPORTED_MEDIA_TYPE');
  }
  return {
    mimeType: mimeType as AllowedMimeType,
    ext: MIME_TO_EXTENSION[mimeType as AllowedMimeType],
  };
}
