-- Phase 5: Full-Text Search — Weighted Generated tsvector Column + GIN Index
--
-- Raw SQL is required here because:
--   1. PostgreSQL GENERATED ALWAYS AS ... STORED DDL cannot be expressed
--      in Prisma's schema language for a tsvector expression.
--   2. Prisma 6.x supports GIN indexes generally (via @@index type: Gin),
--      but cannot create a GIN index over an Unsupported generated column.
-- These are the authoritative DDL statements for Phase 5 FTS.
-- The searchVector field is declared as Unsupported("tsvector")? in
-- schema.prisma. Prisma never reads or writes it; all FTS queries
-- use parameterized $queryRaw.

ALTER TABLE article_revisions
  ADD COLUMN "searchVector" tsvector GENERATED ALWAYS AS (
      setweight(to_tsvector('english', coalesce(title,   '')), 'A')
   || setweight(to_tsvector('english', coalesce(excerpt, '')), 'B')
   || setweight(to_tsvector('english', coalesce(body,    '')), 'C')
  ) STORED;

CREATE INDEX "article_revisions_searchVector_idx"
  ON article_revisions
  USING GIN ("searchVector");
