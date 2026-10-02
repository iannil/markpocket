DROP INDEX "cell_record_id_idx";--> statement-breakpoint
DROP INDEX "record_table_id_idx";--> statement-breakpoint
CREATE INDEX "attachment_base_id_idx" ON "attachment" USING btree ("base_id");--> statement-breakpoint
CREATE INDEX "base_invite_base_id_idx" ON "base_invite" USING btree ("base_id");--> statement-breakpoint
CREATE INDEX "base_share_base_id_idx" ON "base_share" USING btree ("base_id");