import { fetchPublicCategories } from '../../../lib/public-categories';
import { PublicNotFound } from '../../../components/public/PublicNotFound';

export default async function ArticleNotFound() {
  const categories = await fetchPublicCategories();

  return (
    <PublicNotFound
      categories={categories}
      eyebrow="404 · Article"
      title="This story was not found"
      description="The article may have been unpublished, renamed or moved. Browse the latest news or search the newsroom."
    />
  );
}
