CREATE TYPE "public"."doc_status" AS ENUM('none', 'draft', 'verified');--> statement-breakpoint
CREATE TYPE "public"."page_type" AS ENUM('page', 'runbook', 'kb');--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "role" SET DATA TYPE text;--> statement-breakpoint
-- Map the old role names onto the new ones before the enum is recreated.
UPDATE "users" SET "role" = CASE "role" WHEN 'member' THEN 'editor' WHEN 'guest' THEN 'viewer' ELSE "role" END;--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "role" SET DEFAULT 'editor'::text;--> statement-breakpoint
DROP TYPE "public"."system_role";--> statement-breakpoint
CREATE TYPE "public"."system_role" AS ENUM('admin', 'editor', 'viewer');--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "role" SET DEFAULT 'editor'::"public"."system_role";--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "role" SET DATA TYPE "public"."system_role" USING "role"::"public"."system_role";--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "page_type" "page_type" DEFAULT 'page' NOT NULL;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "status" "doc_status" DEFAULT 'none' NOT NULL;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "verified_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "verified_by_id" uuid;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "review_interval_days" integer;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "owner_id" uuid;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "tags" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_verified_by_id_users_id_fk" FOREIGN KEY ("verified_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;