import { Test, TestingModule } from '@nestjs/testing';
import { ArticlesService } from './articles.service';
import { RevisionsService } from './revisions.service';
import { AuthorProfilesService } from './author-profiles.service';
import { TagsService } from '../categories-tags/tags.service';
import { WorkflowService } from '../workflow/workflow.service';
import { MediaService } from '../media/media.service';

describe('ArticlesService', () => {
  let service: ArticlesService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ArticlesService,
        { provide: RevisionsService, useValue: {} },
        { provide: AuthorProfilesService, useValue: {} },
        { provide: TagsService, useValue: {} },
        { provide: WorkflowService, useValue: {} },
        { provide: MediaService, useValue: {} },
      ],
    }).compile();

    service = module.get<ArticlesService>(ArticlesService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
