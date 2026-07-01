CREATE TABLE "attachment" (
	"id" text PRIMARY KEY NOT NULL,
	"filename" text NOT NULL,
	"mime" text NOT NULL,
	"size" integer NOT NULL,
	"storage_key" text NOT NULL,
	"uploaded_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
-- GIN index on cells.value for reverse link queries (ADR-0005).
CREATE INDEX IF NOT EXISTS "cell_value_gin" ON "cell" USING GIN ("value");
