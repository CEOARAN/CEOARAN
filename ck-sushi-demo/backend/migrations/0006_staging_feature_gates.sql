-- CK Sushi 0006. Staging-only guards: never reuse in a production database.
-- Adding these triggers does not enable commerce, create orders or modify settings.
PRAGMA foreign_keys=ON;
CREATE TRIGGER IF NOT EXISTS staging_block_operational_insert
BEFORE INSERT ON operational_settings
WHEN NEW.key IN ('orders_enabled','payments_enabled','customer_data_enabled','tracking_enabled')
 AND NEW.value IS NOT 'false'
BEGIN
 SELECT RAISE(ABORT,'STAGING_COMMERCE_SETTINGS_IMMUTABLE');
END;
CREATE TRIGGER IF NOT EXISTS staging_block_operational_update
BEFORE UPDATE OF key,value ON operational_settings
WHEN (OLD.key IN ('orders_enabled','payments_enabled','customer_data_enabled','tracking_enabled')
 AND NEW.key IS NOT OLD.key)
 OR (NEW.key IN ('orders_enabled','payments_enabled','customer_data_enabled','tracking_enabled')
 AND NEW.value IS NOT 'false')
BEGIN
 SELECT RAISE(ABORT,'STAGING_COMMERCE_SETTINGS_IMMUTABLE');
END;
CREATE TRIGGER IF NOT EXISTS staging_block_operational_delete
BEFORE DELETE ON operational_settings
WHEN OLD.key IN ('orders_enabled','payments_enabled','customer_data_enabled','tracking_enabled')
BEGIN
 SELECT RAISE(ABORT,'STAGING_COMMERCE_SETTINGS_IMMUTABLE');
END;
INSERT OR IGNORE INTO schema_migrations(version) VALUES(6);
