CREATE TABLE "activity" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"actor_id" uuid,
	"actor_name" text,
	"actor_email" text,
	"action" text NOT NULL,
	"category" text NOT NULL,
	"space_id" uuid,
	"space_name" text,
	"target_type" text,
	"target_id" uuid,
	"target_name" text,
	"details" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"ip" text,
	"user_agent" text
);
--> statement-breakpoint
ALTER TABLE "activity" ADD CONSTRAINT "activity_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "activity_at_idx" ON "activity" USING btree ("at");--> statement-breakpoint
CREATE INDEX "activity_actor_idx" ON "activity" USING btree ("actor_id","at");--> statement-breakpoint
CREATE INDEX "activity_space_idx" ON "activity" USING btree ("space_id","at");--> statement-breakpoint
CREATE INDEX "activity_target_idx" ON "activity" USING btree ("target_id","at");--> statement-breakpoint
CREATE INDEX "activity_category_idx" ON "activity" USING btree ("category","at");