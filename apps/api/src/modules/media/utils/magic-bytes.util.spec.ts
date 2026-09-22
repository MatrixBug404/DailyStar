import { detectMimeType } from './magic-bytes.util';

jest.mock('file-type', () => ({
  fileTypeFromBuffer: jest.fn(),
}));
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { fileTypeFromBuffer } = require('file-type');

describe('Magic Bytes Util', () => {
  beforeEach(() => jest.clearAllMocks());

  // ── Valid types (must be accepted) ────────────────────────────────────────
  it('identifies valid JPEG', async () => {
    (fileTypeFromBuffer as jest.Mock).mockResolvedValue({ mime: 'image/jpeg', ext: 'jpg' });
    const result = await detectMimeType(Buffer.from('test'));
    expect(result).toEqual({ mimeType: 'image/jpeg', ext: '.jpg' });
  });

  it('identifies valid PNG', async () => {
    (fileTypeFromBuffer as jest.Mock).mockResolvedValue({ mime: 'image/png', ext: 'png' });
    const result = await detectMimeType(Buffer.from('test'));
    expect(result).toEqual({ mimeType: 'image/png', ext: '.png' });
  });

  it('identifies valid WebP', async () => {
    (fileTypeFromBuffer as jest.Mock).mockResolvedValue({ mime: 'image/webp', ext: 'webp' });
    const result = await detectMimeType(Buffer.from('test'));
    expect(result).toEqual({ mimeType: 'image/webp', ext: '.webp' });
  });

  it('identifies valid GIF', async () => {
    (fileTypeFromBuffer as jest.Mock).mockResolvedValue({ mime: 'image/gif', ext: 'gif' });
    const result = await detectMimeType(Buffer.from('test'));
    expect(result).toEqual({ mimeType: 'image/gif', ext: '.gif' });
  });

  // ── Unsupported types (must be rejected with UNSUPPORTED_MEDIA_TYPE) ──────
  it('throws UNSUPPORTED_MEDIA_TYPE for PDF content', async () => {
    (fileTypeFromBuffer as jest.Mock).mockResolvedValue({ mime: 'application/pdf', ext: 'pdf' });
    await expect(detectMimeType(Buffer.from('test'))).rejects.toThrow('UNSUPPORTED_MEDIA_TYPE');
  });

  it('throws UNSUPPORTED_MEDIA_TYPE for SVG content', async () => {
    (fileTypeFromBuffer as jest.Mock).mockResolvedValue({ mime: 'image/svg+xml', ext: 'svg' });
    await expect(detectMimeType(Buffer.from('test'))).rejects.toThrow('UNSUPPORTED_MEDIA_TYPE');
  });

  it('throws UNSUPPORTED_MEDIA_TYPE for PHP/script content', async () => {
    (fileTypeFromBuffer as jest.Mock).mockResolvedValue({ mime: 'application/x-php', ext: 'php' });
    await expect(detectMimeType(Buffer.from('<?php echo "hack"; ?>'))).rejects.toThrow(
      'UNSUPPORTED_MEDIA_TYPE',
    );
  });

  // ── Undetectable content (must be rejected with INVALID_FILE_SIGNATURE) ──
  it('throws INVALID_FILE_SIGNATURE for unknown binary content', async () => {
    (fileTypeFromBuffer as jest.Mock).mockResolvedValue(undefined);
    await expect(detectMimeType(Buffer.from('not-an-image'))).rejects.toThrow(
      'INVALID_FILE_SIGNATURE',
    );
  });

  it('throws INVALID_FILE_SIGNATURE for empty buffer', async () => {
    (fileTypeFromBuffer as jest.Mock).mockResolvedValue(undefined);
    await expect(detectMimeType(Buffer.alloc(0))).rejects.toThrow('INVALID_FILE_SIGNATURE');
  });

  it('throws INVALID_FILE_SIGNATURE for malformed/truncated content', async () => {
    (fileTypeFromBuffer as jest.Mock).mockResolvedValue(undefined);
    // Partial JPEG header — file-type cannot identify it
    await expect(detectMimeType(Buffer.from([0xff, 0xd8]))).rejects.toThrow(
      'INVALID_FILE_SIGNATURE',
    );
  });

  it('rejects spoofed Content-Type: magic bytes trump declared type (SVG bytes, but fileTypeFromBuffer returns svg+xml)', async () => {
    // Simulates: client sends file with Content-Type: image/jpeg but actual content is SVG
    (fileTypeFromBuffer as jest.Mock).mockResolvedValue({ mime: 'image/svg+xml', ext: 'svg' });
    // Despite the "JPEG" filename, the detected type is SVG → rejected
    await expect(detectMimeType(Buffer.from('<svg>'))).rejects.toThrow('UNSUPPORTED_MEDIA_TYPE');
  });
});
