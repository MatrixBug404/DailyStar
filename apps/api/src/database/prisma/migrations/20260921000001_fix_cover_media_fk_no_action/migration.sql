-- Fix Article.coverMedia FK referential action: SET NULL ? NO ACTION
-- Per Phase 4 spec: media rows are only soft-deleted (DELETED status + deletedAt).
-- NoAction raises a FK violation if a hard-delete of a referenced media row is ever attempted,
-- preventing silent data corruption. This replaces the previous Prisma-default SET NULL.

ALTER TABLE "articles" DROP CONSTRAINT "articles_coverMediaId_fkey";

ALTER TABLE "articles"
  ADD CONSTRAINT "articles_coverMediaId_fkey"
  FOREIGN KEY ("coverMediaId")
  REFERENCES "media"("id")
  ON DELETE NO ACTION
  ON UPDATE CASCADE;
