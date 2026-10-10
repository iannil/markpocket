CREATE TABLE "form_publication" (
	"id" uuid PRIMARY KEY NOT NULL,
	"view_id" text NOT NULL,
	"token_hash" text NOT NULL,
	"prefix" text NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "form_submission" (
	"id" uuid PRIMARY KEY NOT NULL,
	"publication_id" uuid NOT NULL,
	"request_id" uuid NOT NULL,
	"record_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "form_publication" ADD CONSTRAINT "form_publication_view_id_view_id_fk" FOREIGN KEY ("view_id") REFERENCES "public"."view"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "form_submission" ADD CONSTRAINT "form_submission_publication_id_form_publication_id_fk" FOREIGN KEY ("publication_id") REFERENCES "public"."form_publication"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "form_submission" ADD CONSTRAINT "form_submission_record_id_record_id_fk" FOREIGN KEY ("record_id") REFERENCES "public"."record"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "form_publication_token_hash_uq" ON "form_publication" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "form_publication_view_id_idx" ON "form_publication" USING btree ("view_id");--> statement-breakpoint
CREATE UNIQUE INDEX "form_submission_publication_request_uq" ON "form_submission" USING btree ("publication_id","request_id");--> statement-breakpoint
CREATE INDEX "form_submission_record_id_idx" ON "form_submission" USING btree ("record_id");--> statement-breakpoint
CREATE INDEX "form_submission_created_at_idx" ON "form_submission" USING btree ("created_at");