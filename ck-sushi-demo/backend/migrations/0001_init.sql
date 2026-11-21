-- CK Sushi staging: no real customer orders are accepted until legal and security sign-off.
PRAGMA foreign_keys=ON;
CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')));
CREATE TABLE IF NOT EXISTS products (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL CHECK(length(name) BETWEEN 2 AND 180),
  description TEXT NOT NULL DEFAULT '' CHECK(length(description)<=2000),
  category TEXT NOT NULL CHECK(length(category) BETWEEN 2 AND 80),
  price_cents INTEGER NOT NULL CHECK(price_cents>=0 AND price_cents<=100000000),
  old_price_cents INTEGER CHECK(old_price_cents IS NULL OR old_price_cents>=price_cents),
  image_url TEXT NOT NULL DEFAULT '',
  thumbnail_url TEXT NOT NULL DEFAULT '',
  tag TEXT,
  source_category TEXT NOT NULL DEFAULT '',
  is_published INTEGER NOT NULL DEFAULT 1 CHECK(is_published IN (0,1)),
  is_available INTEGER NOT NULL DEFAULT 1 CHECK(is_available IN (0,1)),
  sort_order INTEGER NOT NULL DEFAULT 0,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_products_public ON products(is_published,category,sort_order);
CREATE TABLE IF NOT EXISTS admin_audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  actor TEXT NOT NULL,
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  detail TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_admin_audit_created ON admin_audit(created_at DESC);
CREATE TABLE IF NOT EXISTS operational_settings (
  key TEXT PRIMARY KEY NOT NULL,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
INSERT OR IGNORE INTO operational_settings(key,value) VALUES('orders_enabled','false'),('payments_enabled','false'),('customer_data_enabled','false'),('tracking_enabled','false'),('catalog_reviewed','false');
CREATE TABLE IF NOT EXISTS privacy_requests (
  id TEXT PRIMARY KEY,
  request_type TEXT NOT NULL CHECK(request_type IN('access','correction','erasure','portability','objection','other')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN('pending','verifying','processing','completed','rejected')),
  requester_token_hash TEXT NOT NULL DEFAULT '',
  verified_at TEXT,
  resolved_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE TABLE IF NOT EXISTS incident_register (
  id TEXT PRIMARY KEY,
  identified_at TEXT NOT NULL,
  classification TEXT NOT NULL,
  severity TEXT NOT NULL,
  status TEXT NOT NULL,
  notification_deadline TEXT,
  notification_completed_at TEXT,
  summary TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE TABLE IF NOT EXISTS order_records (
  id TEXT PRIMARY KEY,
  status TEXT NOT NULL CHECK(status IN('pending','confirmed','preparing','ready','dispatched','delivered','cancelled')),
  total_cents INTEGER NOT NULL CHECK(total_cents>=0),
  fulfillment_mode TEXT NOT NULL CHECK(fulfillment_mode IN('pickup','delivery')),
  customer_data_encrypted TEXT,
  encryption_key_version INTEGER,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE TABLE IF NOT EXISTS order_items (
  order_id TEXT NOT NULL REFERENCES order_records(id),
  product_id TEXT NOT NULL,
  product_name TEXT NOT NULL,
  price_cents INTEGER NOT NULL,
  quantity INTEGER NOT NULL CHECK(quantity BETWEEN 1 AND 99),
  PRIMARY KEY (order_id,product_id)
);
CREATE TABLE IF NOT EXISTS webhook_idempotency (
  provider TEXT NOT NULL,
  event_id TEXT NOT NULL,
  processed_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY (provider,event_id)
);
INSERT OR IGNORE INTO schema_migrations(version) VALUES(1);
