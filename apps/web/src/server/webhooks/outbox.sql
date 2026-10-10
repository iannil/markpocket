-- Appended verbatim to the generated delivery-table migration.
CREATE FUNCTION markpocket_record_outbox() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  rid text;
  tid text;
  bid text;
  kind text;
  sub record;
  queued bigint;
BEGIN
  IF TG_TABLE_NAME = 'record' THEN
    IF TG_OP = 'DELETE' THEN
      rid := OLD.id; tid := OLD.table_id; kind := 'record.deleted';
    ELSE
      rid := NEW.id; tid := NEW.table_id; kind := 'record.changed';
    END IF;
  ELSE
    IF TG_OP = 'DELETE' THEN rid := OLD.record_id; ELSE rid := NEW.record_id; END IF;
    -- A record cascade has already removed its parent: do not emit changed.
    SELECT table_id INTO tid FROM record WHERE id = rid;
    kind := 'record.changed';
  END IF;
  SELECT base_id INTO bid FROM "table" WHERE id = tid;
  -- Table/Base cascades remove subscriptions and their deliveries via FKs.
  IF bid IS NOT NULL THEN
    FOR sub IN
      SELECT * FROM webhook_subscription s
      WHERE s.table_id = tid AND (
        s.state = 'active' OR (
          kind = 'record.deleted' AND EXISTS (
            SELECT 1 FROM webhook_delivery d
            WHERE d.subscription_id = s.id AND d.transaction_id = txid_current() AND d.record_id = rid
          )
        )
      )
      ORDER BY s.id FOR UPDATE
    LOOP
      -- Even after this transaction overflows, normalize its already queued
      -- events: a changed-only receiver must never get a just-deleted record.
      IF kind = 'record.deleted' AND NOT sub.events @> jsonb_build_array(kind) THEN
        DELETE FROM webhook_delivery
        WHERE subscription_id = sub.id AND transaction_id = txid_current()
          AND record_id = rid AND event_type = 'record.changed';
      ELSIF sub.events @> jsonb_build_array(kind) THEN
        IF EXISTS (
          SELECT 1 FROM webhook_delivery
          WHERE subscription_id = sub.id AND transaction_id = txid_current() AND record_id = rid
        ) THEN
          -- Coalescing consumes no capacity; deletion always wins.
          IF kind = 'record.deleted' THEN
            UPDATE webhook_delivery SET event_type = 'record.deleted'
            WHERE subscription_id = sub.id AND transaction_id = txid_current() AND record_id = rid;
          END IF;
        ELSIF sub.state = 'active' THEN
          SELECT count(*) INTO queued FROM webhook_delivery
          WHERE subscription_id = sub.id AND state IN ('pending', 'leased');
          IF queued >= 10000 THEN
            UPDATE webhook_subscription SET state = 'overflow', overflow_at = now(), updated_at = now()
            WHERE id = sub.id;
          ELSE
            INSERT INTO webhook_delivery(id, subscription_id, transaction_id, base_id, table_id, record_id, event_type, occurred_at)
            VALUES (gen_random_uuid(), sub.id, txid_current(), bid, tid, rid, kind, now());
          END IF;
        END IF;
      END IF;
    END LOOP;
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END $$;
--> statement-breakpoint
CREATE TRIGGER record_outbox AFTER INSERT OR UPDATE OR DELETE ON record
FOR EACH ROW EXECUTE FUNCTION markpocket_record_outbox();
--> statement-breakpoint
CREATE TRIGGER cell_outbox AFTER INSERT OR UPDATE OR DELETE ON cell
FOR EACH ROW EXECUTE FUNCTION markpocket_record_outbox();
