-- Dedupe (base_id, user_id) before adding the composite PK: keep the most
-- privileged role per pair (owner > editor > viewer), then the earliest row.
DELETE FROM "base_member" bm
USING "base_member" bm2
WHERE bm.base_id = bm2.base_id
  AND bm.user_id = bm2.user_id
  AND (
    CASE bm.role WHEN 'owner' THEN 2 WHEN 'editor' THEN 1 ELSE 0 END
    < CASE bm2.role WHEN 'owner' THEN 2 WHEN 'editor' THEN 1 ELSE 0 END
    OR (
      CASE bm.role WHEN 'owner' THEN 2 WHEN 'editor' THEN 1 ELSE 0 END
      = CASE bm2.role WHEN 'owner' THEN 2 WHEN 'editor' THEN 1 ELSE 0 END
      AND bm.created_at > bm2.created_at
    )
    OR (
      CASE bm.role WHEN 'owner' THEN 2 WHEN 'editor' THEN 1 ELSE 0 END
      = CASE bm2.role WHEN 'owner' THEN 2 WHEN 'editor' THEN 1 ELSE 0 END
      AND bm.created_at = bm2.created_at
      AND bm.ctid > bm2.ctid
    )
  );--> statement-breakpoint
ALTER TABLE "base_member" ADD CONSTRAINT "base_member_base_id_user_id_pk" PRIMARY KEY("base_id","user_id");--> statement-breakpoint
ALTER TABLE "attachment" ADD COLUMN "base_id" text;--> statement-breakpoint
ALTER TABLE "attachment" ADD CONSTRAINT "attachment_base_id_base_id_fk" FOREIGN KEY ("base_id") REFERENCES "public"."base"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "base_invite_token_uq" ON "base_invite" USING btree ("token");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "base_member_user_id_idx" ON "base_member" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "base_share_token_uq" ON "base_share" USING btree ("token");--> statement-breakpoint
-- 0005 created this index by hand; IF NOT EXISTS keeps the migration replayable
-- on databases that already have it.
CREATE INDEX IF NOT EXISTS "cell_value_gin" ON "cell" USING gin ("value");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "cell_history_cell_id_idx" ON "cell_history" USING btree ("cell_id","changed_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "field_table_id_idx" ON "field" USING btree ("table_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "record_table_id_idx" ON "record" USING btree ("table_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "table_base_id_idx" ON "table" USING btree ("base_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "view_table_id_idx" ON "view" USING btree ("table_id");
