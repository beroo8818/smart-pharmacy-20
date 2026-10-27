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

module.exports = { getDb, getDbPath };