-- Installs that already ran 0010 get the trigon_fold below: encoding-safe, and lower-casing that does
-- not depend on the database locale (same results on the Docker image's UTF8 / en_US database). The
-- search indexes were built with the previous, inlined definition; rebuild them so queries keep
-- matching them (otherwise search falls back to scanning every document).
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
END $$;
--> statement-breakpoint
REINDEX INDEX "documents_search_idx";--> statement-breakpoint
REINDEX INDEX "attachments_search_idx";
