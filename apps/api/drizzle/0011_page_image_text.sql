ALTER TABLE "attachments" ADD COLUMN "text_content" text;--> statement-breakpoint
ALTER TABLE "attachments" ADD COLUMN "text_indexed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "attachments" ADD COLUMN "text_source" text;--> statement-breakpoint
CREATE INDEX "attachments_search_idx" ON "attachments" USING gin (to_tsvector('simple', trigon_fold(coalesce("text_content", ''))));--> statement-breakpoint
CREATE INDEX "attachments_text_pending_idx" ON "attachments" USING btree ("created_at") WHERE "attachments"."text_indexed_at" is null;--> statement-breakpoint
-- PDFs now keep a form feed between pages (search shows the page of a match): read them once more.
UPDATE "documents" SET "text_indexed_at" = NULL
  WHERE "kind" = 'file' AND ("mime_type" = 'application/pdf' OR lower("title") LIKE '%.pdf');
