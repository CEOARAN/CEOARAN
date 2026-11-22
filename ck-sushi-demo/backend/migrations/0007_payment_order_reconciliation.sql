-- CK Sushi migration 0007: persist Mercado Pago Orders API identity.
-- Additive; safe to run on staging, creates no orders or payments.
-- Preserve every staging_block_* guard and four false commercial flags.
PRAGMA foreign_keys=ON;
ALTER TABLE commerce_payments ADD COLUMN provider_order_id TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_commerce_payments_provider_order
 ON commerce_payments(provider_order_id) WHERE provider_order_id IS NOT NULL;
INSERT OR IGNORE INTO schema_migrations(version) VALUES(7);
