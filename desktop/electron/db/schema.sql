-- SQLite schema for Dawa Desktop
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id            TEXT PRIMARY KEY,
  username      TEXT NOT NULL UNIQUE,
  full_name     TEXT,
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL CHECK (role IN ('system_admin','pharmacy_manager','warehouse_keeper','viewer')),
  active        INTEGER NOT NULL DEFAULT 1,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS user_sessions (
  token       TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at  TEXT NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS locations (
  id     TEXT PRIMARY KEY,
  name   TEXT NOT NULL,
  type   TEXT NOT NULL CHECK (type IN ('main_warehouse','sub_pharmacy')),
  active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS item_master (
  id                    TEXT PRIMARY KEY,
  item_code             TEXT,
  item_name_ar          TEXT,
  item_name_en          TEXT,
  active_ingredient_ar  TEXT,
  active_ingredient_en  TEXT,
  strength              TEXT,
  dosage_form           TEXT,
  unit                  TEXT,
  ven_class             TEXT
);
CREATE INDEX IF NOT EXISTS idx_item_code ON item_master(item_code);
CREATE INDEX IF NOT EXISTS idx_item_name_ar ON item_master(item_name_ar);

CREATE TABLE IF NOT EXISTS upload_batches (
  id           TEXT PRIMARY KEY,
  file_name    TEXT NOT NULL,
  month        TEXT NOT NULL,
  status       TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','saved','archived')),
  row_count    INTEGER NOT NULL DEFAULT 0,
  uploaded_by  TEXT REFERENCES users(id),
  uploaded_at  TEXT NOT NULL DEFAULT (datetime('now')),
  notes        TEXT
);
CREATE INDEX IF NOT EXISTS idx_batch_status ON upload_batches(status, uploaded_at DESC);

-- Continuous-analysis extensions
CREATE TABLE IF NOT EXISTS stock_transactions (
  id                  TEXT PRIMARY KEY,
  txn_date            TEXT NOT NULL,
  txn_type            TEXT NOT NULL CHECK (txn_type IN (
    'warehouse_receipt','warehouse_issue_to_pharmacy','pharmacy_issue',
    'pharmacy_transfer','warehouse_return','pharmacy_return_to_warehouse'
  )),
  item_key            TEXT NOT NULL,
  item_name           TEXT,
  item_code           TEXT,
  unit                TEXT,
  from_location_name  TEXT,
  from_location_type  TEXT,
  to_location_name    TEXT,
  to_location_type    TEXT,
  qty                 REAL NOT NULL CHECK (qty > 0),
  note                TEXT CHECK (length(trim(coalesce(note, ''))) >= 5),
  source_batch_id     TEXT,
  created_by          TEXT REFERENCES users(id),
  created_at          TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_stx_date ON stock_transactions(txn_date DESC);
CREATE INDEX IF NOT EXISTS idx_stx_item ON stock_transactions(item_key);

CREATE TABLE IF NOT EXISTS inventory_movements (
  id                TEXT PRIMARY KEY,
  upload_batch_id   TEXT NOT NULL REFERENCES upload_batches(id) ON DELETE CASCADE,
  item_master_id    TEXT NOT NULL REFERENCES item_master(id),
  location_id       TEXT NOT NULL REFERENCES locations(id),
  month             TEXT NOT NULL,
  opening_balance   REAL DEFAULT 0,
  received_qty      REAL DEFAULT 0,
  issued_qty        REAL DEFAULT 0,
  closing_balance   REAL DEFAULT 0,
  unit_price        REAL,
  expiry_date       TEXT,
  min_stock         REAL,
  max_stock         REAL,
  lead_time_days    INTEGER DEFAULT 30
);
CREATE INDEX IF NOT EXISTS idx_mov_batch ON inventory_movements(upload_batch_id);
CREATE INDEX IF NOT EXISTS idx_mov_item_loc ON inventory_movements(item_master_id, location_id);
CREATE INDEX IF NOT EXISTS idx_mov_month ON inventory_movements(month);

CREATE TABLE IF NOT EXISTS audit_log (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    TEXT,
  action     TEXT NOT NULL,
  entity     TEXT,
  entity_id  TEXT,
  details    TEXT,
  at         TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT
);

INSERT OR IGNORE INTO settings(key, value) VALUES
  ('coverage_target_days', '30'),
  ('overstock_multiplier', '2'),
  ('deadstock_months', '6'),
  ('schema_version', '1');
