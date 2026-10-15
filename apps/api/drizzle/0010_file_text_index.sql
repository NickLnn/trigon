-- Search folding used by documents_search_idx and the search query (kept identical to fold() in src/search/fold.ts):
-- lower-case, strip combining accents, final sigma as sigma. "ΑΘΉΝΑΣ" and "αθηνας" both become "αθηνασ".
CREATE OR REPLACE FUNCTION trigon_fold(t text) RETURNS text
  LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE
  AS $$ SELECT translate(regexp_replace(normalize(lower(t), NFD), '[\u0300-\u036f]', '', 'g'), 'ς', 'σ') $$;--> statement-breakpoint
-- Typo-tolerant title matching (word_similarity). Also created by docker/postgres/init.sql on new installs.
CREATE EXTENSION IF NOT EXISTS pg_trgm;--> statement-breakpoint
DROP INDEX "documents_search_idx";--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "text_indexed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "text_source" text;--> statement-breakpoint
CREATE INDEX "documents_text_pending_idx" ON "documents" USING btree ("created_at") WHERE "documents"."kind" = 'file' and "documents"."text_indexed_at" is null;--> statement-breakpoint
CREATE INDEX "documents_search_idx" ON "documents" USING gin (to_tsvector('simple', trigon_fold(coalesce("title", '') || ' ' || coalesce("text_content", ''))));