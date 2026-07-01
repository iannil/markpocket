CREATE TABLE "view" (
	"id" text PRIMARY KEY NOT NULL,
	"table_id" text NOT NULL,
	"type" text NOT NULL,
	"name" text NOT NULL,
	"options" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"order_index" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "view" ADD CONSTRAINT "view_table_id_table_id_fk" FOREIGN KEY ("table_id") REFERENCES "public"."table"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
-- Backfill: every existing table gets one default Grid view.
INSERT INTO "view" ("id", "table_id", "type", "name", "options", "order_index", "created_at")
SELECT gen_random_uuid(), "id", 'grid', 'Grid', '{}'::jsonb, 0, now() FROM "table";