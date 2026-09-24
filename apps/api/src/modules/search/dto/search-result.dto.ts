export class SearchResultDto {
  id!: string;
  slug!: string;
  title!: string;
  excerpt!: string | null;
  publishedAt!: string;
  publishedRevisionCreatedAt!: string;
  hasCoverImage!: boolean;
  coverWidth!: number | null;
  coverHeight!: number | null;
  coverMimeType!: string | null;
  headline!: string | null;
  rank!: number;
  category!: {
    id: string;
    name: string;
    slug: string;
  } | null;
  author!: {
    displayName: string;
    bio: string | null;
    avatarUrl: string | null;
  };
  tags!: string[];
}
