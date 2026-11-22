-- CK Sushi migration 0005 — financial snapshots, future commerce only.
-- Do not remove 0003 staging_* triggers. This migration creates no orders or payments.
-- Enforce SQL-level invariants even if a future application bug bypasses the repository.
PRAGMA foreign_keys=ON;

-- A persisted order is a financial snapshot. Only lifecycle fields
-- (status, payment_status, version, timestamps, key rotation) may change.
CREATE TRIGGER IF NOT EXISTS commerce_order_financial_snapshot_immutable
BEFORE UPDATE OF id,idempotency_hash,request_fingerprint,fulfillment,currency,
 subtotal_cents,discount_cents,delivery_fee_cents,total_cents ON commerce_orders
WHEN NEW.id IS NOT OLD.id
 OR NEW.idempotency_hash IS NOT OLD.idempotency_hash
 OR NEW.request_fingerprint IS NOT OLD.request_fingerprint
 OR NEW.fulfillment IS NOT OLD.fulfillment
 OR NEW.currency IS NOT OLD.currency
 OR NEW.subtotal_cents IS NOT OLD.subtotal_cents
 OR NEW.discount_cents IS NOT OLD.discount_cents
 OR NEW.delivery_fee_cents IS NOT OLD.delivery_fee_cents
 OR NEW.total_cents IS NOT OLD.total_cents
BEGIN
 SELECT RAISE(ABORT,'ORDER_FINANCIAL_SNAPSHOT_IMMUTABLE');
END;

-- Order item snapshots must never be deleted or modified after creation.
CREATE TRIGGER IF NOT EXISTS commerce_order_line_delete_guard
BEFORE DELETE ON commerce_order_lines
BEGIN
 SELECT RAISE(ABORT,'COMMERCE_ORDER_LINES_IMMUTABLE');
END;

-- Payment amount, identity and linkage cannot be rewritten after creation.
-- Provider identifiers may be filled once, when initially NULL; never replaced.
CREATE TRIGGER IF NOT EXISTS commerce_payment_financial_snapshot_immutable
BEFORE UPDATE OF id,order_id,provider,amount_cents,currency,idempotency_hash,
 provider_payment_id,provider_merchant_id ON commerce_payments
WHEN NEW.id IS NOT OLD.id
 OR NEW.order_id IS NOT OLD.order_id
 OR NEW.provider IS NOT OLD.provider
 OR NEW.amount_cents IS NOT OLD.amount_cents
 OR NEW.currency IS NOT OLD.currency
 OR NEW.idempotency_hash IS NOT OLD.idempotency_hash
 OR (OLD.provider_payment_id IS NOT NULL
      AND NEW.provider_payment_id IS NOT OLD.provider_payment_id)
 OR (OLD.provider_merchant_id IS NOT NULL
      AND NEW.provider_merchant_id IS NOT OLD.provider_merchant_id)
BEGIN
 SELECT RAISE(ABORT,'PAYMENT_FINANCIAL_SNAPSHOT_IMMUTABLE');
END;

-- Avoid silently deleting financial evidence while retention/legal processes
-- and explicit deletion procedures have not been approved.
CREATE TRIGGER IF NOT EXISTS commerce_payment_delete_guard
BEFORE DELETE ON commerce_payments
BEGIN
 SELECT RAISE(ABORT,'COMMERCE_PAYMENT_DELETE_REQUIRES_REVIEW');
END;

INSERT OR IGNORE INTO schema_migrations(version) VALUES(5);
