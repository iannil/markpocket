-- Hand-written (no local DB for drizzle-kit generate): two covering indexes.
-- record (table_id, created_at DESC) backs listRecordsPivoted's default sort;
-- cell_history (changed_at DESC) backs history.listByBase's global timeline.
CREATE INDEX IF NOT EXISTS "record_table_created_at_idx" ON "record" USING btree ("table_id","created_at" DESC);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "cell_history_changed_at_idx" ON "cell_history" USING btree ("changed_at" DESC);
