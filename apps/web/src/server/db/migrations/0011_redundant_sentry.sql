DROP INDEX "cell_history_changed_at_idx";--> statement-breakpoint
CREATE INDEX "cell_history_changed_at_id_idx" ON "cell_history" USING btree ("changed_at" DESC NULLS LAST,"id" DESC NULLS LAST);