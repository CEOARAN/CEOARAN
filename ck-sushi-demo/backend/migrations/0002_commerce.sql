-- 0002: future transactional commerce model. No customer/payment intake is enabled.
PRAGMA foreign_keys=ON;
ALTER TABLE products ADD COLUMN last_modified_by TEXT NOT NULL DEFAULT 'system' CHECK(length(last_modified_by) BETWEEN 1 AND 254);
CREATE TRIGGER IF NOT EXISTS trg_product_create_audit
AFTER INSERT ON products
BEGIN
 INSERT INTO admin_audit(actor,action,entity_type,entity_id,detail)
 VALUES(NEW.last_modified_by,'create','product',NEW.id,'Product inserted; version '||NEW.version);
END;
CREATE TRIGGER IF NOT EXISTS trg_product_update_audit
AFTER UPDATE ON products
BEGIN
 INSERT INTO admin_audit(actor,action,entity_type,entity_id,detail)
 VALUES(NEW.last_modified_by,'update','product',NEW.id,'Product changed; version '||NEW.version);
END;
CREATE TABLE IF NOT EXISTS commerce_orders (
 id TEXT PRIMARY KEY NOT NULL,
 idempotency_hash TEXT UNIQUE NOT NULL,
 status TEXT NOT NULL CHECK(status IN('pending_payment','paid','accepted','preparing','ready','awaiting_courier','courier_assigned','picked_up','delivery_exception','delivered','cancelled','refund_pending','refund_failed','refunded')),
 payment_status TEXT NOT NULL CHECK(payment_status IN('none','pending','approved','rejected','cancelled','refunded','in_refund')),
 fulfillment TEXT NOT NULL CHECK(fulfillment IN('delivery','pickup')),
 currency TEXT NOT NULL DEFAULT 'BRL' CHECK(currency='BRL'),
 subtotal_cents INTEGER NOT NULL CHECK(subtotal_cents>=0),
 discount_cents INTEGER NOT NULL DEFAULT 0 CHECK(discount_cents>=0 AND discount_cents<=subtotal_cents),
 delivery_fee_cents INTEGER NOT NULL DEFAULT 0 CHECK(delivery_fee_cents>=0),
 total_cents INTEGER NOT NULL CHECK(total_cents>=0 AND total_cents=subtotal_cents-discount_cents+delivery_fee_cents),
 customer_encrypted BLOB,
 customer_key_version INTEGER,
 placed_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
 expires_at TEXT,
 updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
 version INTEGER NOT NULL DEFAULT 1 CHECK(version>0),
 CHECK((customer_encrypted IS NULL AND customer_key_version IS NULL) OR (customer_encrypted IS NOT NULL AND customer_key_version>0))
);
CREATE INDEX IF NOT EXISTS idx_commerce_orders_status ON commerce_orders(status,placed_at);
CREATE TABLE IF NOT EXISTS commerce_order_lines (
 order_id TEXT NOT NULL REFERENCES commerce_orders(id) ON DELETE RESTRICT,
 line_no INTEGER NOT NULL CHECK(line_no>=1),
 product_id TEXT NOT NULL,
 name_snapshot TEXT NOT NULL CHECK(length(name_snapshot) BETWEEN 2 AND 180),
 unit_price_cents INTEGER NOT NULL CHECK(unit_price_cents>=0),
 quantity INTEGER NOT NULL CHECK(quantity BETWEEN 1 AND 20),
 total_cents INTEGER NOT NULL CHECK(total_cents=unit_price_cents*quantity),
 PRIMARY KEY (order_id,line_no),
 UNIQUE (order_id,product_id)
);
CREATE TABLE IF NOT EXISTS commerce_payments (
 id TEXT PRIMARY KEY NOT NULL,
 order_id TEXT NOT NULL REFERENCES commerce_orders(id),
 provider TEXT NOT NULL CHECK(provider='mercadopago'),
 provider_payment_id TEXT UNIQUE,
 provider_merchant_id TEXT,
 amount_cents INTEGER NOT NULL CHECK(amount_cents>=0),
 currency TEXT NOT NULL DEFAULT 'BRL' CHECK(currency='BRL'),
 status TEXT NOT NULL CHECK(status IN('created','pending','approved','rejected','cancelled','in_refund','refunded')),
 idempotency_hash TEXT UNIQUE NOT NULL,
 created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
 updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_payments_one_approved_per_order ON commerce_payments(order_id) WHERE status='approved';
CREATE TABLE IF NOT EXISTS commerce_payment_events (
 provider TEXT NOT NULL,
 event_id TEXT NOT NULL,
 provider_payment_id TEXT NOT NULL,
 event_type TEXT NOT NULL CHECK(length(event_type) BETWEEN 1 AND 80),
 received_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
 handled_at TEXT,
 handled_status TEXT NOT NULL DEFAULT 'pending' CHECK(handled_status IN('pending','verified','ignored','failed')),
 PRIMARY KEY(provider,event_id)
);
CREATE TABLE IF NOT EXISTS commerce_delivery (
 order_id TEXT PRIMARY KEY REFERENCES commerce_orders(id),
 provider TEXT NOT NULL CHECK(provider IN('ifood','manual')),
 provider_delivery_id TEXT UNIQUE,
 state TEXT NOT NULL CHECK(state IN('not_requested','quoted','requested','assigned','picked_up','delivered','failed','cancelled')),
 quotation_cents INTEGER CHECK(quotation_cents IS NULL OR quotation_cents>=0),
 tracking_url TEXT,
 last_status_at TEXT,
 created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE TABLE IF NOT EXISTS commerce_order_events (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 order_id TEXT NOT NULL REFERENCES commerce_orders(id),
 actor_type TEXT NOT NULL CHECK(actor_type IN('system','store','payment_provider','logistics_provider')),
 from_status TEXT,
 to_status TEXT NOT NULL,
 event_hash TEXT NOT NULL UNIQUE,
 recorded_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_order_events_order ON commerce_order_events(order_id,id);
CREATE TABLE IF NOT EXISTS delivery_outbox (
 id TEXT PRIMARY KEY NOT NULL,
 kind TEXT NOT NULL CHECK(kind IN('payment_reconcile','delivery_request','delivery_status','notification')),
 dedupe_key TEXT NOT NULL UNIQUE,
 payload_encrypted BLOB,
 state TEXT NOT NULL DEFAULT 'pending' CHECK(state IN('pending','processing','done','failed')),
 attempts INTEGER NOT NULL DEFAULT 0 CHECK(attempts BETWEEN 0 AND 100),
 next_attempt_at TEXT NOT NULL,
 created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
 processed_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_outbox_due ON delivery_outbox(state,next_attempt_at);
INSERT OR IGNORE INTO schema_migrations(version) VALUES(2);
