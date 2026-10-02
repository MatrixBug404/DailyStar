import 'reflect-metadata';
import { validate } from 'class-validator';
import { ArticleListQueryDto, ArticleStatus } from './article-list-query.dto';
import { plainToInstance } from 'class-transformer';

describe('ArticleListQueryDto', () => {
  it('should pass with valid defaults', async () => {
    const dto = plainToInstance(ArticleListQueryDto, {});
    const errors = await validate(dto);
    expect(errors.length).toBe(0);
    expect(dto.page).toBe(1);
    expect(dto.limit).toBe(20);
    expect(dto.sortBy).toBe('updatedAt');
    expect(dto.order).toBe('desc');
  });

  it('should transform and validate valid comma-separated status', async () => {
    const dto = plainToInstance(ArticleListQueryDto, { status: 'DRAFT,PUBLISHED' });
    const errors = await validate(dto);
    expect(errors.length).toBe(0);
    expect(dto.status).toEqual([ArticleStatus.DRAFT, ArticleStatus.PUBLISHED]);
  });

  it('should fail on invalid status enum', async () => {
    const dto = plainToInstance(ArticleListQueryDto, { status: 'DRAFT,INVALID_STATUS' });
    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0].property).toBe('status');
  });

  it('should fail on negative page', async () => {
    const dto = plainToInstance(ArticleListQueryDto, { page: -1 });
    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0].property).toBe('page');
  });

  it('should fail on page 0', async () => {
    const dto = plainToInstance(ArticleListQueryDto, { page: 0 });
    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0].property).toBe('page');
  });

  it('should fail on limit > 100', async () => {
    const dto = plainToInstance(ArticleListQueryDto, { limit: 101 });
    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0].property).toBe('limit');
  });

  it('should fail on limit < 1', async () => {
    const dto = plainToInstance(ArticleListQueryDto, { limit: 0 });
    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0].property).toBe('limit');
  });

  it('should validate string arrays for status', async () => {
    const dto = plainToInstance(ArticleListQueryDto, { status: ['PUBLISHED', 'ARCHIVED'] });
    const errors = await validate(dto);
    expect(errors.length).toBe(0);
    expect(dto.status).toEqual([ArticleStatus.PUBLISHED, ArticleStatus.ARCHIVED]);
  });
});
