CREATE TABLE "base_invite" (
	"id" text PRIMARY KEY NOT NULL,
	"base_id" text NOT NULL,
	"email" text NOT NULL,
	"role" text DEFAULT 'editor' NOT NULL,
	"token" text NOT NULL,
	"invited_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"accepted_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "base_invite" ADD CONSTRAINT "base_invite_base_id_base_id_fk" FOREIGN KEY ("base_id") REFERENCES "public"."base"("id") ON DELETE cascade ON UPDATE no action;