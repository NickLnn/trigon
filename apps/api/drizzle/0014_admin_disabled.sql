ALTER TABLE "users" ADD COLUMN "disabled_by_admin" boolean DEFAULT false NOT NULL;--> statement-breakpoint
-- Accounts that are off today stay off until an admin turns them back on (sync and sign-in can no longer re-enable them).
UPDATE "users" SET "disabled_by_admin" = true WHERE "active" = false;
