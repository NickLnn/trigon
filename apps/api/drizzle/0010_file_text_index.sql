-- Search folding used by the search indexes and queries (kept identical to fold() in
-- src/search/fold.ts): lower-case, strip combining accents (U+0300-U+036F), final sigma (chr 962) as
-- sigma (chr 963), so a Greek word with or without accents, in capitals or not, folds the same way.
-- Lower-casing uses PostgreSQL 17's built-in pg_c_utf8 collation, so it covers all of Unicode whatever
-- the database locale (a "C" locale database only lower-cases ASCII); older versions use the locale.
-- normalize() and those chr() values only work in UTF8 databases (the Docker image's default); in any
-- other encoding it just lower-cases, so creating and editing pages keeps working there. PL/pgSQL
-- (not SQL) so statements for other setups are never even planned. Replacing this function means
-- rebuilding documents_search_idx and attachments_search_idx. ASCII-only, for databases in any encoding.
CREATE OR REPLACE FUNCTION trigon_fold(t text) RETURNS text
  LANGUAGE plpgsql IMMUTABLE STRICT PARALLEL SAFE
  AS $$
BEGIN
  IF current_setting('server_encoding') <> 'UTF8' THEN
    RETURN lower(t);
  END IF;
  IF current_setting('server_version_num')::int >= 170000 THEN
    t := lower(t COLLATE pg_c_utf8);
  ELSE
    t := lower(t);
  END IF;
  RETURN translate(regexp_replace(normalize(t, NFD), '[\u0300-\u036f]', '', 'g'), chr(962), chr(963));
END $$;--> statement-breakpoint
-- Typo-tolerant title matching (word_similarity). Also created by docker/postgres/init.sql on new installs.
CREATE EXTENSION IF NOT EXISTS pg_trgm;--> statement-breakpoint
DROP INDEX "documents_search_idx";--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "text_indexed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "text_source" text;--> statement-breakpoint
CREATE INDEX "documents_text_pending_idx" ON "documents" USING btree ("created_at") WHERE "documents"."kind" = 'file' and "documents"."text_indexed_at" is null;--> statement-breakpoint
CREATE INDEX "documents_search_idx" ON "documents" USING gin (to_tsvector('simple', trigon_fold(coalesce("title", '') || ' ' || coalesce("text_content", ''))));