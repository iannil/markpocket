ALTER TABLE "api_token" ADD COLUMN "access" text DEFAULT 'write' NOT NULL;--> statement-breakpoint
ALTER TABLE "api_token" ADD COLUMN "base_id" text;--> statement-breakpoint
ALTER TABLE "api_token" ADD CONSTRAINT "api_token_base_id_base_id_fk" FOREIGN KEY ("base_id") REFERENCES "public"."base"("id") ON DELETE cascade ON UPDATE no action;