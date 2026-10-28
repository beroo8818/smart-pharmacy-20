CREATE TABLE IF NOT EXISTS branch_reports (
 id TEXT PRIMARY KEY, location_id TEXT NOT NULL REFERENCES locations(id), month TEXT NOT NULL,
 snapshot_date TEXT NOT NULL, kind TEXT NOT NULL CHECK(kind IN ('monthly','partial_update')),
 rows TEXT NOT NULL, fingerprint TEXT NOT NULL UNIQUE, status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected')),
 note TEXT, created_by TEXT NOT NULL REFERENCES users(id), reviewed_by TEXT REFERENCES users(id),
 created_at TEXT NOT NULL DEFAULT (datetime('now')), reviewed_at TEXT, batch_id TEXT
);
CREATE TABLE IF NOT EXISTS branch_requests (
 id TEXT PRIMARY KEY, location_id TEXT NOT NULL REFERENCES locations(id), item_code TEXT NOT NULL,
 item_name TEXT NOT NULL, unit TEXT NOT NULL, qty REAL NOT NULL CHECK(qty > 0),
 status TEXT NOT NULL DEFAULT 'requested' CHECK(status IN ('requested','approved','preparing','received','rejected')),
 note TEXT NOT NULL, created_by TEXT NOT NULL REFERENCES users(id), created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS user_access_profiles(user_id TEXT PRIMARY KEY REFERENCES users(id),permissions TEXT NOT NULL,location_ids TEXT NOT NULL,all_branches INTEGER NOT NULL DEFAULT 0,updated_by TEXT REFERENCES users(id),updated_at TEXT NOT NULL DEFAULT(datetime('now')));
CREATE TABLE IF NOT EXISTS active_ingredient_dictionary(id TEXT PRIMARY KEY,original_item_name TEXT NOT NULL UNIQUE,scientific_name TEXT,trade_name TEXT,active_ingredient TEXT,strength TEXT,dosage_form TEXT,unit TEXT,standard_name TEXT,therapeutic_group_key TEXT,confidence_score REAL NOT NULL DEFAULT 0,needs_review INTEGER NOT NULL DEFAULT 1,approved INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS recommendation_actions(
 id TEXT PRIMARY KEY,upload_batch_id TEXT NOT NULL REFERENCES upload_batches(id),
 recommendation_key TEXT NOT NULL,recommendation_type TEXT NOT NULL,item_key TEXT,item_name TEXT,item_code TEXT,unit TEXT,
 from_location TEXT,to_location TEXT,suggested_qty REAL,executed_qty REAL,
 status TEXT NOT NULL CHECK(status IN('new','approved','rejected','postponed','executed')),note TEXT,
 acted_by TEXT NOT NULL REFERENCES users(id),acted_at TEXT NOT NULL,
 match_review_required INTEGER NOT NULL DEFAULT 0,override_unreviewed INTEGER NOT NULL DEFAULT 0,override_reason TEXT,therapeutic_group_key TEXT,
 client_id TEXT NOT NULL,source TEXT NOT NULL DEFAULT 'current' CHECK(source IN('current','legacy_local')),original_at TEXT,legacy_hash TEXT,
 UNIQUE(acted_by,client_id),UNIQUE(legacy_hash)
);
CREATE INDEX IF NOT EXISTS idx_recaction_batch ON recommendation_actions(upload_batch_id,acted_at DESC,id);
CREATE INDEX IF NOT EXISTS idx_recaction_scope ON recommendation_actions(to_location,from_location);
