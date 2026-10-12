CREATE TYPE "public"."space_sort" AS ENUM('alpha', 'manual');--> statement-breakpoint
ALTER TABLE "spaces" ADD COLUMN "sort_mode" "space_sort" DEFAULT 'alpha' NOT NULL;