import { Transform, Type } from 'class-transformer';
import { IsBoolean, IsInt, IsOptional, Max, Min } from 'class-validator';

/**
 * Normalizes `unreadOnly` from the query string to a strict boolean.
 *
 * Only literal `true` (or boolean true) enables the filter; `false` / omitted
 * is "no filter". Any other value (e.g. `"yes"`, `"1"`) passes through
 * unchanged so `@IsBoolean()` rejects it with a 400 instead of coercing it.
 */
const unreadOnlyTransform = ({ value }: { value: unknown }): unknown => {
  if (value === undefined || value === null || value === '') return undefined;
  if (value === 'true' || value === true) return true;
  if (value === 'false' || value === false) return false;
  return value;
};

/**
 * Query parameters for `GET v1/notifications`.
 *
 * Phase 8 spec §10.2:
 * - `page`   — integer >= 1, default 1.
 * - `limit`  — integer 1–100, default 20; out-of-range or non-numeric values
 *              are rejected with HTTP 400, never clamped.
 * - `unreadOnly` — only the literal `true` filters to unread notifications.
 */
export class NotificationListQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit: number = 20;

  @Transform(unreadOnlyTransform)
  @IsBoolean()
  @IsOptional()
  unreadOnly?: boolean;
}
