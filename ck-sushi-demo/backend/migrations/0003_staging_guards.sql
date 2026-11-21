-- 0003 Security and reliability hardening for CK Sushi staging.
-- Staging has no owner authorization, PSP credentials or customer-data approval.
-- These database triggers defend against accidental commerce activation.
PRAGMA foreign_keys=ON;
ALTER TABLE commerce_orders ADD COLUMN request_fingerprint TEXT NOT NULL DEFAULT '';
ALTER TABLE delivery_outbox ADD COLUMN lease_token TEXT;
ALTER TABLE delivery_outbox ADD COLUMN lease_expires_at TEXT;
ALTER TABLE delivery_outbox ADD COLUMN last_error_code TEXT;
CREATE INDEX IF NOT EXISTS idx_delivery_outbox_recovery ON delivery_outbox(state,lease_expires_at);
CREATE TABLE IF NOT EXISTS maintenance_runs (
  job_key TEXT PRIMARY KEY NOT NULL,
  checked_at TEXT NOT NULL,
  outcome TEXT NOT NULL CHECK(outcome IN ('success','warning','failed')),
  summary TEXT NOT NULL CHECK(length(summary) <= 400)
);
CREATE TABLE IF NOT EXISTS commerce_webhook_replay_guard (
  provider TEXT NOT NULL,
  event_key_hash TEXT NOT NULL CHECK(length(event_key_hash)=64),
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY(provider,event_key_hash)
);
CREATE INDEX IF NOT EXISTS idx_commerce_webhook_replay_expiry ON commerce_webhook_replay_guard(expires_at);
CREATE TRIGGER IF NOT EXISTS staging_block_order_insert BEFORE INSERT ON commerce_orders
BEGIN SELECT RAISE(ABORT,'STAGING_ORDERS_DISABLED'); END;
CREATE TRIGGER IF NOT EXISTS staging_block_legacy_order_insert BEFORE INSERT ON order_records
BEGIN SELECT RAISE(ABORT,'STAGING_ORDERS_DISABLED'); END;
CREATE TRIGGER IF NOT EXISTS staging_block_payment_insert BEFORE INSERT ON commerce_payments
BEGIN SELECT RAISE(ABORT,'STAGING_PAYMENTS_DISABLED'); END;
CREATE TRIGGER IF NOT EXISTS staging_block_delivery_insert BEFORE INSERT ON commerce_delivery
BEGIN SELECT RAISE(ABORT,'STAGING_DELIVERIES_DISABLED'); END;
CREATE TRIGGER IF NOT EXISTS staging_block_payment_webhook_insert BEFORE INSERT ON commerce_payment_events
BEGIN SELECT RAISE(ABORT,'STAGING_PAYMENT_WEBHOOKS_DISABLED'); END;
CREATE TRIGGER IF NOT EXISTS staging_block_outbox_insert BEFORE INSERT ON delivery_outbox
BEGIN SELECT RAISE(ABORT,'STAGING_TASKS_DISABLED'); END;
INSERT OR IGNORE INTO schema_migrations(version) VALUES(3);
