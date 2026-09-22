import { Module } from '@nestjs/common';
import { ArticlesController } from './articles.controller';
import { ArticlesService } from './articles.service';
import { RevisionsService } from './revisions.service';
import { AuthorProfilesService } from './author-profiles.service';
import { CategoriesTagsModule } from '../categories-tags/categories-tags.module';
import { WorkflowModule } from '../workflow/workflow.module';
import { MediaModule } from '../media/media.module';

@Module({
  imports: [CategoriesTagsModule, WorkflowModule, MediaModule],
  controllers: [ArticlesController],
  providers: [ArticlesService, RevisionsService, AuthorProfilesService],
})
export class ArticlesModule {}
