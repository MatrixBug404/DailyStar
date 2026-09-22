import { Module } from '@nestjs/common';
import { CategoriesController } from './categories.controller';
import { CategoriesService } from './categories.service';
import { TagsController } from './tags.controller';
import { TagsService } from './tags.service';

@Module({
  controllers: [CategoriesController, TagsController],
  providers: [CategoriesService, TagsService],
  exports: [TagsService],
})
export class CategoriesTagsModule {}
