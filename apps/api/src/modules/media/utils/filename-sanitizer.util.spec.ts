import { sanitizeFilename } from './filename-sanitizer.util';

describe('Filename Sanitizer', () => {
  it('preserves clean filenames', () => {
    expect(sanitizeFilename('photo.jpg')).toBe('photo.jpg');
    expect(sanitizeFilename('my image.png')).toBe('my image.png');
  });

  it('replaces path separators', () => {
    expect(sanitizeFilename('../../etc/passwd.jpg')).toBe('____etc_passwd.jpg');
  });

  it('replaces null bytes and control chars', () => {
    expect(sanitizeFilename('file\x00name.gif')).toBe('file_name.gif');
    expect(sanitizeFilename('file\x1Fname.gif')).toBe('file_name.gif');
  });

  it('replaces dangerous filename characters', () => {
    expect(sanitizeFilename('bad<file>name.jpg')).toBe('bad_file_name.jpg');
    expect(sanitizeFilename('a:b"c?d*e|f.jpg')).toBe('a_b_c_d_e_f.jpg');
  });

  it('handles dangerous dot sequences while preserving extension', () => {
    expect(sanitizeFilename('...dangerous.jpg')).toBe('_.dangerous.jpg');
  });

  it('truncates to 255 chars', () => {
    const longName = 'a'.repeat(300) + '.jpg';
    const result = sanitizeFilename(longName);
    expect(result.length).toBe(255);
  });

  // ── Edge cases required by spec ──────────────────────────────────────────
  it('handles absolute path — strips leading path separators', () => {
    // /etc/passwd.jpg → slashes become underscores
    const result = sanitizeFilename('/etc/passwd.jpg');
    expect(result).not.toContain('/');
    expect(result).not.toContain('\\');
    // Should not start with a slash
    expect(result.startsWith('_')).toBe(true);
  });

  it('handles hidden filename (starts with dot) — dot prefix is not a path traversal risk', () => {
    // A leading dot alone is not dangerous. The sanitizer preserves it since it does not
    // match path separators, null bytes, control chars, or ".." sequences.
    const result = sanitizeFilename('.bashrc');
    expect(result).toBe('.bashrc'); // dot prefix preserved — not a security issue
    expect(result.length).toBeGreaterThan(0);
  });

  it('handles empty string input — returns empty (Multer enforces non-empty originalname upstream)', () => {
    // The sanitizer returns whatever it receives. An empty string never arrives from
    // Multer in practice because the field is required. We verify no crash occurs.
    const result = sanitizeFilename('');
    expect(typeof result).toBe('string');
    // The implementation returns '' for empty input; callers should guard upstream.
    expect(result).toBe('');
  });

  it('handles all-dots input — collapses to safe fallback without path-traversal', () => {
    // '...' → iterative '..' replacement: '...' → '_.' (one replacement) → no more '..'
    const result = sanitizeFilename('...');
    expect(result).not.toBe('...');
    expect(result).not.toContain('..');
    expect(result.length).toBeGreaterThan(0);
  });
});
