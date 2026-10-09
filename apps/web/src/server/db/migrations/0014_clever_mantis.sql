CREATE TABLE "airtable_import_receipt" (
	"request_id" uuid PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"source_base_id" text NOT NULL,
	"base_id" text NOT NULL,
	"report" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "airtable_import_receipt" ADD CONSTRAINT "airtable_import_receipt_base_id_base_id_fk" FOREIGN KEY ("base_id") REFERENCES "public"."base"("id") ON DELETE cascade ON UPDATE no action;