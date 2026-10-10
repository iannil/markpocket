CREATE TABLE "webhook_subscription" (
	"id" uuid PRIMARY KEY NOT NULL,
	"table_id" text NOT NULL,
	"created_by" text NOT NULL,
	"url" text NOT NULL,
	"events" jsonb NOT NULL,
	"secret_ciphertext" text NOT NULL,
	"state" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"overflow_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "webhook_subscription" ADD CONSTRAINT "webhook_subscription_table_id_table_id_fk" FOREIGN KEY ("table_id") REFERENCES "public"."table"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "webhook_subscription_table_id_idx" ON "webhook_subscription" USING btree ("table_id");