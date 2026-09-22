import { randomUUID } from 'crypto';

/**
 * Generates a randomized, collision-resistant, server-controlled object key.
 * Format: media/{uploadedById}/{uuid}{extension}
 * No user input enters the key.
 */
export function generateObjectKey(uploadedById: string, extension: string): string {
  return `media/${uploadedById}/${randomUUID()}${extension}`;
}
