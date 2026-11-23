import { fetchPublicCategories } from '../../../lib/public-categories';
import { PublicNotFound } from '../../../components/public/PublicNotFound';

export default async function CategoryNotFound() {
  const categories = await fetchPublicCategories();

  return (
    <PublicNotFound
      categories={categories}
      eyebrow="404 · Section"
      title="This section was not found"
      description="The section may not exist, or it may have no published stories yet. Browse the latest news or search the newsroom."
    />
  );
}
