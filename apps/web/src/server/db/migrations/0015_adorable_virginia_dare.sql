CREATE TABLE "write_receipt" (
	"actor_key" text NOT NULL,
	"request_id" uuid NOT NULL,
	"body_hash" text NOT NULL,
	"result" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "write_receipt_actor_key_request_id_pk" PRIMARY KEY("actor_key","request_id")
);
--> statement-breakpoint
CREATE INDEX "write_receipt_created_at_idx" ON "write_receipt" USING btree ("created_at");