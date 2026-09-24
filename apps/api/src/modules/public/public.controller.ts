import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { PublicService } from './public.service';
import { PublicFeedQueryDto } from './dto/public-feed-query.dto';
import { CategoryArticlesQueryDto } from './dto/category-articles-query.dto';
import { SearchQueryDto } from '../search/dto/search-query.dto';
import { CoverRateLimitGuard } from './guards/cover-rate-limit.guard';

@Controller('v1/public')
export class PublicController {
  constructor(private readonly publicService: PublicService) {}

  @Get('articles')
  getArticles(@Query() query: PublicFeedQueryDto) {
    return this.publicService.getArticles(query);
  }

  @Get('articles/:slug')
  getArticle(@Param('slug') slug: string) {
    return this.publicService.getArticle(slug);
  }

  @Get('articles/:slug/cover')
  @UseGuards(CoverRateLimitGuard)
  getArticleCover(@Param('slug') slug: string) {
    return this.publicService.getArticleCover(slug);
  }

  @Get('categories')
  getCategories() {
    return this.publicService.getCategories();
  }

  @Get('categories/:slug/articles')
  getCategoryArticles(@Param('slug') slug: string, @Query() query: CategoryArticlesQueryDto) {
    return this.publicService.getCategoryArticles(slug, query);
  }

  @Get('search')
  search(@Query() query: SearchQueryDto) {
    return this.publicService.search(query);
  }
}
