import { fetchPublicApi } from './api';
import type { PublicCategory } from './public-content';

/**
 * Optional public section navigation.
 *
 * Article, category and search content must still render when the categories
 * endpoint is unavailable, so navigation failure degrades to an empty shell
 * rather than turning an otherwise valid page into a 500.
 */
export async function fetchPublicCategories(): Promise<PublicCategory[]> {
  try {
    const categories = await fetchPublicApi<PublicCategory[]>('/public/categories');
    return Array.isArray(categories) ? categories : [];
  } catch (error) {
    console.warn('[public] section navigation unavailable; rendering without it.', error);
    return [];
  }
}
