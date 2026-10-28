import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { customAlphabet } from "nanoid";

export const DATA_DIR = path.resolve(process.env.DATA_DIR ?? "data");
export const UPLOAD_DIR = path.join(DATA_DIR, "uploads");
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

export const db = new Database(path.join(DATA_DIR, "studio.db"));
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

export const newId = customAlphabet("0123456789abcdefghijklmnopqrstuvwxyz", 12);
export const now = () => new Date().toISOString();

db.exec(`
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS images (
  id TEXT PRIMARY KEY,
  file TEXT NOT NULL,
  thumb TEXT NOT NULL,
  mime TEXT NOT NULL,
  width INTEGER NOT NULL,
  height INTEGER NOT NULL,
  source_url TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS items (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  category TEXT NOT NULL,
  photo_ids TEXT NOT NULL DEFAULT '[]',
  known_dims TEXT NOT NULL DEFAULT '{}',
  notes TEXT NOT NULL DEFAULT '',
  tags TEXT NOT NULL DEFAULT '[]',
  model TEXT,
  history TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'draft',
  error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS rooms (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  layout TEXT NOT NULL,
  state TEXT NOT NULL,
  source_image_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS configurations (
  id TEXT PRIMARY KEY,
  room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  state TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS collections (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'manual',
  pinterest_board_id TEXT,
  summary TEXT,
  item_ids TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS rooms_project ON rooms(project_id);
`);

// Pins are many-to-many with collections. Databases from before that change stored a single
// collection_id on each pin; rebuild that table and carry the memberships over.
const pinColumns = (db.prepare("PRAGMA table_info(pins)").all() as { name: string }[]).map((c) => c.name);
const legacyPins = pinColumns.includes("collection_id");
db.exec(`
CREATE TABLE IF NOT EXISTS collection_pins (
  collection_id TEXT NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
  pin_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (collection_id, pin_id)
);
CREATE INDEX IF NOT EXISTS collection_pins_pin ON collection_pins(pin_id);
`);
if (legacyPins) {
  db.transaction(() => {
    db.exec(`
      INSERT OR IGNORE INTO collection_pins (collection_id, pin_id, created_at) SELECT collection_id, id, created_at FROM pins;
      CREATE TABLE pins_new (id TEXT PRIMARY KEY, image_id TEXT, image_url TEXT, title TEXT NOT NULL DEFAULT '', link TEXT, pinterest_pin_id TEXT, created_at TEXT NOT NULL);
      INSERT INTO pins_new SELECT id, image_id, image_url, title, link, pinterest_pin_id, created_at FROM pins;
      DROP TABLE pins;
      ALTER TABLE pins_new RENAME TO pins;
    `);
  })();
}
db.exec(`
CREATE TABLE IF NOT EXISTS pins (
  id TEXT PRIMARY KEY,
  image_id TEXT,
  image_url TEXT,
  title TEXT NOT NULL DEFAULT '',
  link TEXT,
  pinterest_pin_id TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS pins_pinterest ON pins(pinterest_pin_id);
`);

// Rooms gained a style link (board + last fit check)
const roomColumns = (db.prepare("PRAGMA table_info(rooms)").all() as { name: string }[]).map((c) => c.name);
if (!roomColumns.includes("style")) db.exec("ALTER TABLE rooms ADD COLUMN style TEXT");

export function getSetting(key: string): string | null {
  const row = db.prepare("SELECT value FROM settings WHERE key = ?").get(key) as { value: string } | undefined;
  return row?.value ?? null;
}

export function setSetting(key: string, value: string | null) {
  if (value === null) db.prepare("DELETE FROM settings WHERE key = ?").run(key);
  else db.prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(key, value);
}

export const json = <T>(s: string | null | undefined, fallback: T): T => {
  if (!s) return fallback;
  try {
    return JSON.parse(s) as T;
  } catch {
    return fallback;
  }
};
