const path = require("path");
const fs = require("fs");
const { app } = require("electron");

let Database;
try {
  Database = require("better-sqlite3");
} catch (e) {
  throw new Error(
    "better-sqlite3 غير مثبت. شغّل: npm install better-sqlite3 داخل مجلد desktop"
  );
}

let db = null;

function getDbPath() {
  const dir = app.getPath("userData");
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, "dawa.db");
}

function applyMigrations(database) {
  const userColumns = database.prepare("PRAGMA table_info(users)").all();
  if (!userColumns.some((column) => column.name === "assigned_location_id")) database.exec("ALTER TABLE users ADD COLUMN assigned_location_id TEXT REFERENCES locations(id)");
  // Columns added after the initial schema — add them if missing.
  const cols = database.prepare("PRAGMA table_info(upload_batches)").all();
  const names = new Set(cols.map((c) => c.name));
  if (!names.has("snapshot_date")) {
    database.exec("ALTER TABLE upload_batches ADD COLUMN snapshot_date TEXT");
  }
  if (!names.has("batch_kind")) {
    database.exec(
      "ALTER TABLE upload_batches ADD COLUMN batch_kind TEXT NOT NULL DEFAULT 'monthly'"
    );
  }
  if (!names.has("content_hash")) database.exec("ALTER TABLE upload_batches ADD COLUMN content_hash TEXT");
  database.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_batch_content_hash ON upload_batches(content_hash) WHERE content_hash IS NOT NULL");
  database.exec(fs.readFileSync(path.join(__dirname, "operations.sql"), "utf8"));
  for (const table of ['upload_batches','branch_reports']) {
    const existing = new Set(database.prepare('PRAGMA table_info('+table+')').all().map(c=>c.name));
    for (const name of ['issued_from','issued_to','received_from','received_to','snapshot_boundary']) {
      if (!existing.has(name)) database.exec('ALTER TABLE '+table+' ADD COLUMN '+name+' TEXT');
    }
  }
  if(!database.prepare('PRAGMA table_info(branch_reports)').all().some(c=>c.name==='consumption_only'))database.exec('ALTER TABLE branch_reports ADD COLUMN consumption_only INTEGER NOT NULL DEFAULT 0');
  const txnColumns=new Set(database.prepare('PRAGMA table_info(stock_transactions)').all().map(c=>c.name));
  for(const name of ['issued_from','issued_to'])if(!txnColumns.has(name))database.exec('ALTER TABLE stock_transactions ADD COLUMN '+name+' TEXT');
  const itemColumns=new Set(database.prepare('PRAGMA table_info(item_master)').all().map(c=>c.name));
  for(const name of ['first_active_date','ven_class'])if(!itemColumns.has(name))database.exec('ALTER TABLE item_master ADD COLUMN '+name+' TEXT');
}

function getDb() {
  if (db) return db;
  const dbPath = getDbPath();
  db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  const schemaPath = path.join(__dirname, "schema.sql");
  const schema = fs.readFileSync(schemaPath, "utf8");
  db.exec(schema);
  applyMigrations(db);
  return db;
}

function closeDb(){if(db?.open)db.close();db=null;}
module.exports = { getDb, getDbPath, closeDb, applyMigrations };
