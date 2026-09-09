import { Test, TestingModule } from '@nestjs/testing';
import { AuthorProfilesService } from './author-profiles.service';

describe('AuthorProfilesService', () => {
  let service: AuthorProfilesService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [AuthorProfilesService],
    }).compile();

    service = module.get<AuthorProfilesService>(AuthorProfilesService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
