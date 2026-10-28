import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { NotificationListQueryDto } from './notification-list-query.dto';

describe('NotificationListQueryDto', () => {
  it('applies the documented defaults', async () => {
    const dto = plainToInstance(NotificationListQueryDto, {});
    const errors = await validate(dto);

    expect(errors.length).toBe(0);
    expect(dto.page).toBe(1);
    expect(dto.limit).toBe(20);
    expect(dto.unreadOnly).toBeUndefined();
  });

  it('transforms numeric query strings', async () => {
    const dto = plainToInstance(NotificationListQueryDto, { page: '3', limit: '50' });
    const errors = await validate(dto);

    expect(errors.length).toBe(0);
    expect(dto.page).toBe(3);
    expect(dto.limit).toBe(50);
  });

  it('rejects page 0 and negative pages', async () => {
    for (const page of [0, -1, '-5']) {
      const dto = plainToInstance(NotificationListQueryDto, { page });
      const errors = await validate(dto);
      expect(errors.some((error) => error.property === 'page')).toBe(true);
    }
  });

  it('rejects non-numeric and fractional pages', async () => {
    for (const page of ['abc', '1.5', '']) {
      const dto = plainToInstance(NotificationListQueryDto, { page });
      const errors = await validate(dto);
      expect(errors.some((error) => error.property === 'page')).toBe(true);
    }
  });

  it('accepts the limit boundaries 1 and 100', async () => {
    for (const limit of [1, 100, '1', '100']) {
      const dto = plainToInstance(NotificationListQueryDto, { limit });
      const errors = await validate(dto);
      expect(errors.length).toBe(0);
    }
  });

  it('rejects limit 0, negative limits and limit above 100', async () => {
    for (const limit of [0, -10, 101, '101']) {
      const dto = plainToInstance(NotificationListQueryDto, { limit });
      const errors = await validate(dto);
      expect(errors.some((error) => error.property === 'limit')).toBe(true);
    }
  });

  it('rejects a non-numeric limit', async () => {
    const dto = plainToInstance(NotificationListQueryDto, { limit: 'twenty' });
    const errors = await validate(dto);

    expect(errors.some((error) => error.property === 'limit')).toBe(true);
  });

  it('transforms unreadOnly "true" / "false" strings into booleans', async () => {
    const enabled = plainToInstance(NotificationListQueryDto, { unreadOnly: 'true' });
    expect((await validate(enabled)).length).toBe(0);
    expect(enabled.unreadOnly).toBe(true);

    const disabled = plainToInstance(NotificationListQueryDto, { unreadOnly: 'false' });
    expect((await validate(disabled)).length).toBe(0);
    expect(disabled.unreadOnly).toBe(false);
  });

  it('rejects non-boolean unreadOnly values', async () => {
    for (const unreadOnly of ['yes', '1', '0', 'TRUE']) {
      const dto = plainToInstance(NotificationListQueryDto, { unreadOnly });
      const errors = await validate(dto);
      expect(errors.some((error) => error.property === 'unreadOnly')).toBe(true);
    }
  });
});
