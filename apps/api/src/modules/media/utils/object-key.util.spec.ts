import { generateObjectKey } from './object-key.util';

describe('generateObjectKey', () => {
  const userId = 'user-abc-123';

  it('produces key in format media/{uploadedById}/{uuid}{extension}', () => {
    const key = generateObjectKey(userId, '.jpg');
    // Must start with the user prefix segment
    expect(key).toMatch(/^media\/user-abc-123\/[0-9a-f-]{36}\.jpg$/);
  });

  it('includes the correct extension', () => {
    expect(generateObjectKey(userId, '.png')).toMatch(/\.png$/);
    expect(generateObjectKey(userId, '.webp')).toMatch(/\.webp$/);
    expect(generateObjectKey(userId, '.gif')).toMatch(/\.gif$/);
  });

  it('produces unique keys on each call', () => {
    const key1 = generateObjectKey(userId, '.jpg');
    const key2 = generateObjectKey(userId, '.jpg');
    expect(key1).not.toBe(key2);
  });

  it('embeds the uploadedById exactly (no user-controlled path traversal)', () => {
    // The user ID comes from the JWT sub — it should appear verbatim in the key.
    // We verify the key only contains the expected segments and no ../ sequences.
    const key = generateObjectKey(userId, '.jpg');
    expect(key).not.toContain('..');
    expect(key.split('/')[1]).toBe(userId);
  });

  it('has three forward-slash-separated segments: media / userId / uuidExt', () => {
    const key = generateObjectKey(userId, '.jpg');
    const parts = key.split('/');
    expect(parts).toHaveLength(3);
    expect(parts[0]).toBe('media');
    expect(parts[1]).toBe(userId);
    expect(parts[2]).toMatch(/^[0-9a-f-]{36}\.jpg$/);
  });
});
