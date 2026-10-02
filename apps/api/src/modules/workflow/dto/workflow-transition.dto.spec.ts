import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { RequestChangesDto } from './request-changes.dto';
import { RejectDto } from './reject.dto';

describe('Workflow Transition DTOs', () => {
  describe('RequestChangesDto', () => {
    it('should validate a valid dto', async () => {
      const dto = plainToInstance(RequestChangesDto, { comment: 'Valid comment', expectedVersion: 1 });
      const errors = await validate(dto);
      expect(errors.length).toBe(0);
    });

    it('should require a comment', async () => {
      const dto = plainToInstance(RequestChangesDto, { expectedVersion: 1 });
      const errors = await validate(dto);
      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0].property).toBe('comment');
    });

    it('should trim whitespace from comment and fail if empty', async () => {
      const dto = plainToInstance(RequestChangesDto, { comment: '   ', expectedVersion: 1 });
      const errors = await validate(dto);
      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0].property).toBe('comment');
      expect(dto.comment).toBe('');
    });

    it('should fail if comment is more than 1000 characters', async () => {
      const dto = plainToInstance(RequestChangesDto, { comment: 'a'.repeat(1001), expectedVersion: 1 });
      const errors = await validate(dto);
      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0].property).toBe('comment');
    });

    it('should allow optional expectedVersion', async () => {
      const dto = plainToInstance(RequestChangesDto, { comment: 'Valid comment' });
      const errors = await validate(dto);
      expect(errors.length).toBe(0);
    });

    it('should enforce expectedVersion is an integer if provided', async () => {
      const dto = plainToInstance(RequestChangesDto, { comment: 'Valid comment', expectedVersion: '1' });
      const errors = await validate(dto);
      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0].property).toBe('expectedVersion');
    });
  });

  describe('RejectDto', () => {
    it('should validate a valid dto', async () => {
      const dto = plainToInstance(RejectDto, { comment: 'Valid comment', expectedVersion: 1 });
      const errors = await validate(dto);
      expect(errors.length).toBe(0);
    });

    it('should require a comment', async () => {
      const dto = plainToInstance(RejectDto, { expectedVersion: 1 });
      const errors = await validate(dto);
      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0].property).toBe('comment');
    });

    it('should trim whitespace from comment and fail if empty', async () => {
      const dto = plainToInstance(RejectDto, { comment: '   ', expectedVersion: 1 });
      const errors = await validate(dto);
      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0].property).toBe('comment');
      expect(dto.comment).toBe('');
    });

    it('should fail if comment is more than 1000 characters', async () => {
      const dto = plainToInstance(RejectDto, { comment: 'a'.repeat(1001), expectedVersion: 1 });
      const errors = await validate(dto);
      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0].property).toBe('comment');
    });

    it('should allow optional expectedVersion', async () => {
      const dto = plainToInstance(RejectDto, { comment: 'Valid comment' });
      const errors = await validate(dto);
      expect(errors.length).toBe(0);
    });

    it('should enforce expectedVersion is an integer if provided', async () => {
      const dto = plainToInstance(RejectDto, { comment: 'Valid comment', expectedVersion: '1' });
      const errors = await validate(dto);
      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0].property).toBe('expectedVersion');
    });
  });
});
