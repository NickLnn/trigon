CREATE TYPE "public"."review_status" AS ENUM('pending', 'approved', 'changes_requested', 'cancelled');--> statement-breakpoint
CREATE TABLE "review_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"document_id" uuid NOT NULL,
	"requested_by_id" uuid,
	"reviewer_id" uuid NOT NULL,
	"status" "review_status" DEFAULT 'pending' NOT NULL,
	"message" text,
	"response" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"responded_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "review_requests" ADD CONSTRAINT "review_requests_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_requests" ADD CONSTRAINT "review_requests_requested_by_id_users_id_fk" FOREIGN KEY ("requested_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_requests" ADD CONSTRAINT "review_requests_reviewer_id_users_id_fk" FOREIGN KEY ("reviewer_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "review_requests_reviewer_idx" ON "review_requests" USING btree ("reviewer_id","status");--> statement-breakpoint
CREATE INDEX "review_requests_document_idx" ON "review_requests" USING btree ("document_id","status");