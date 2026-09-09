export function generateSlug(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD') // Decompose combined graphemes into the combination of simple ones
    .replace(/[\u0300-\u036f]/g, '') // Remove diacritics
    .replace(/[^a-z0-9]+/g, '-') // Replace non-alphanumeric with hyphen
    .replace(/^-+|-+$/g, '') // Remove leading/trailing hyphens
    .substring(0, 150); // Cap length
}
