-- 0004: commerce database invariants (also enforced in future production migrations).
-- These remain dormant in staging because 0003 rejects commerce INSERTs.
CREATE TRIGGER IF NOT EXISTS commerce_line_snapshot_price_guard
BEFORE INSERT ON commerce_order_lines
WHEN NOT EXISTS (
 SELECT 1 FROM products p
 WHERE p.id=NEW.product_id
   AND p.price_cents=NEW.unit_price_cents
   AND p.is_published=1 AND p.is_available=1
)
BEGIN SELECT RAISE(ABORT,'COMMERCE_PRODUCT_UNAVAILABLE_OR_PRICE_CHANGED'); END;
CREATE TRIGGER IF NOT EXISTS commerce_line_immutable_guard
BEFORE UPDATE ON commerce_order_lines
BEGIN SELECT RAISE(ABORT,'COMMERCE_ORDER_LINES_IMMUTABLE'); END;
CREATE TRIGGER IF NOT EXISTS commerce_payment_amount_guard
BEFORE INSERT ON commerce_payments
WHEN NOT EXISTS (
 SELECT 1 FROM commerce_orders o WHERE o.id=NEW.order_id
 AND o.total_cents=NEW.amount_cents
 AND o.currency=NEW.currency
)
BEGIN SELECT RAISE(ABORT,'PAYMENT_AMOUNT_MISMATCH'); END;
CREATE TRIGGER IF NOT EXISTS commerce_order_version_guard
BEFORE UPDATE OF status ON commerce_orders
WHEN NEW.version<>OLD.version+1
BEGIN SELECT RAISE(ABORT,'ORDER_VERSION_MUST_INCREMENT'); END;
CREATE TRIGGER IF NOT EXISTS commerce_order_no_direct_terminal_reopen
BEFORE UPDATE OF status ON commerce_orders
WHEN OLD.status='refunded' AND NEW.status<>'refunded'
BEGIN SELECT RAISE(ABORT,'REFUNDED_ORDER_IS_TERMINAL'); END;
INSERT OR IGNORE INTO schema_migrations(version) VALUES(4);
