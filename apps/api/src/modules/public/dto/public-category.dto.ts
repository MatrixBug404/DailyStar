export class PublicCategoryDto {
  id!: string;
  name!: string;
  slug!: string;
  parentId!: string | null;
  publishedArticleCount!: number;
  children!: PublicCategoryDto[];
}
