/**
 * Sanitizes an uploader-supplied filename for safe storage.
 * Does NOT use the sanitized name for object key generation.
 * The object key is always a server-generated UUID path.
 */
export function sanitizeFilename(raw: string): string {
  // 1. Truncate to max 255 chars before any replacement
  let name = raw.slice(0, 255);

  // 2. Replace path separators (/ and \) individually
  name = name.replace(/[/\\]/g, '_');

  // 3. Replace ".." sequences iteratively (path traversal prevention)
  //    Loop handles edge cases like "..." → one pass gives "_." → second pass leaves "."
  while (name.includes('..')) {
    name = name.replace(/\.\./g, '_');
  }

  // 4. Replace null bytes, ASCII control chars (0x00–0x1F), and dangerous
  //    filename characters: < > : " ? * |
  name = name.replace(/[\x00-\x1F<>:"?*|]/g, '_');

  return name;
}
