// SQLite data layer. Everything lives in one file, data/zip.sqlite (WAL mode, foreign keys on).
//
// Driver: Node's built-in SQLite (Node 22.13+ / 24, nothing to install). On an older Node,
// `npm install better-sqlite3` and the same code runs on that instead.
//
// On first start with an old data/store.json next to it, the JSON is imported once and then
// renamed, so an existing installation keeps all of its records.
import { existsSync, mkdirSync, readFileSync, renameSync, readdirSync, unlinkSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { hashPassword } from './passwords.js';

const DATA_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'data');
const DB_FILE = join(DATA_DIR, 'zip.sqlite');
const LEGACY_JSON = join(DATA_DIR, 'store.json');
const BACKUP_DIR = join(DATA_DIR, 'backups');
const SCHEMA_VERSION = 2;

// Node labels its SQLite module "experimental" and prints a warning on every start. The API we
// use is stable enough; hide just that warning and keep every other one.
{
  const printers = process.listeners('warning');
  process.removeAllListeners('warning');
  process.on('warning', (w) => {
    if (w && w.name === 'ExperimentalWarning' && /sqlite/i.test(String(w.message))) return;
    for (const p of printers) p(w);
  });
}

let Driver = null;
let driverName = '';
try {
  ({ DatabaseSync: Driver } = await import('node:sqlite'));
  driverName = 'node:sqlite';
} catch {
  try {
    Driver = (await import('better-sqlite3')).default;
    driverName = 'better-sqlite3';
  } catch {
    throw new Error('No SQLite driver available. Run on Node 22.13 or newer (built-in SQLite), or on older Node run: npm install better-sqlite3');
  }
}

mkdirSync(DATA_DIR, { recursive: true });
const conn = new Driver(DB_FILE);
conn.exec('PRAGMA journal_mode = WAL');
conn.exec('PRAGMA synchronous = NORMAL');
conn.exec('PRAGMA foreign_keys = ON');
conn.exec('PRAGMA busy_timeout = 5000');

// Refuse to run on a damaged file rather than silently working with broken data.
{
  const check = conn.prepare('PRAGMA quick_check').get();
  const result = check && Object.values(check)[0];
  if (result !== 'ok') {
    console.error(`[db] ${DB_FILE} failed its integrity check: ${result}. Restore the latest file from data/backups/.`);
    process.exit(1);
  }
}

// Bound values: SQLite takes null/number/string/Buffer. Map JS conveniences onto those.
const norm = (params) => params.map((v) => (v === undefined ? null : typeof v === 'boolean' ? (v ? 1 : 0) : v));
const cache = new Map();
function stmt(sql) {
  let s = cache.get(sql);
  if (!s) { s = conn.prepare(sql); cache.set(sql, s); }
  return s;
}
let txDepth = 0;

export const db = {
  file: DB_FILE,
  driver: driverName,
  uid: () => randomUUID(),
  get: (sql, ...params) => stmt(sql).get(...norm(params)),
  all: (sql, ...params) => stmt(sql).all(...norm(params)),
  run: (sql, ...params) => stmt(sql).run(...norm(params)),
  exec: (sql) => conn.exec(sql),
  // Run fn inside one transaction (nested calls join the outer one). BEGIN IMMEDIATE takes the
  // write lock up front, so stock checks and the writes that depend on them cannot interleave.
  tx(fn) {
    if (txDepth > 0) return fn();
    conn.exec('BEGIN IMMEDIATE');
    txDepth++;
    try {
      const out = fn();
      conn.exec('COMMIT');
      return out;
    } catch (e) {
      try { conn.exec('ROLLBACK'); } catch { /* already rolled back */ }
      throw e;
    } finally {
      txDepth--;
    }
  },
  setting(key) {
    const r = stmt('SELECT value FROM settings WHERE key = ?').get(key);
    return r ? r.value : null;
  },
  setSetting(key, value) {
    stmt('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, String(value));
  },
  // Consistent online backup via SQLite itself. Keeps the newest `keep` files in data/backups.
  backup({ keep = 14 } = {}) {
    mkdirSync(BACKUP_DIR, { recursive: true });
    const stamp = new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
    const out = join(BACKUP_DIR, `zip-${stamp}.sqlite`);
    if (existsSync(out)) unlinkSync(out);
    conn.exec(`VACUUM INTO '${out.replace(/'/g, "''")}'`);
    const files = readdirSync(BACKUP_DIR).filter((f) => /^zip-\d{8}-\d{6}\.sqlite$/.test(f)).sort();
    while (files.length > keep) unlinkSync(join(BACKUP_DIR, files.shift()));
    return out;
  },
  // Take a backup only if the newest one is older than `hours` (used at startup and on a timer).
  backupIfStale(hours) {
    try {
      mkdirSync(BACKUP_DIR, { recursive: true });
      const files = readdirSync(BACKUP_DIR).filter((f) => /^zip-\d{8}-\d{6}\.sqlite$/.test(f)).sort();
      const newest = files.length ? statSync(join(BACKUP_DIR, files[files.length - 1])).mtimeMs : 0;
      if (Date.now() - newest > hours * 3600 * 1000) return this.backup();
    } catch (e) {
      console.warn('[db] backup failed:', e.message);
    }
    return null;
  },
};

// ---------- schema ----------
const SCHEMA_V1 = `
CREATE TABLE clients (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL DEFAULT '', code TEXT NOT NULL UNIQUE, created_at TEXT NOT NULL);
CREATE TABLE products (
  id TEXT PRIMARY KEY, client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  sku TEXT, name TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', location TEXT NOT NULL DEFAULT '', type TEXT NOT NULL DEFAULT '',
  image TEXT, image_source TEXT, stock INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL);
CREATE INDEX products_client ON products(client_id);
CREATE UNIQUE INDEX products_client_sku ON products(client_id, sku COLLATE NOCASE) WHERE sku IS NOT NULL AND sku <> '';
CREATE TABLE orders (
  id TEXT PRIMARY KEY, client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  order_number TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'new', ship_to TEXT NOT NULL DEFAULT '',
  label_filename TEXT, label_mime TEXT, label_original TEXT,
  created_at TEXT NOT NULL, printed_at TEXT, stock_deducted INTEGER NOT NULL DEFAULT 0,
  UNIQUE(client_id, order_number));
CREATE INDEX orders_client ON orders(client_id);
CREATE INDEX orders_status ON orders(status);
CREATE INDEX orders_created ON orders(created_at);
CREATE TABLE order_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT, order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id TEXT REFERENCES products(id) ON DELETE SET NULL,
  sku TEXT, name TEXT NOT NULL, quantity INTEGER NOT NULL, position INTEGER NOT NULL DEFAULT 0);
CREATE INDEX order_items_order ON order_items(order_id);
CREATE INDEX order_items_product ON order_items(product_id);
CREATE TABLE inbound (
  id TEXT PRIMARY KEY, client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  quantity INTEGER NOT NULL, expected_at TEXT NOT NULL DEFAULT '', tracking_id TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'expected', created_by TEXT NOT NULL DEFAULT 'client',
  created_at TEXT NOT NULL, received_at TEXT, received_quantity INTEGER);
CREATE INDEX inbound_client ON inbound(client_id);
CREATE INDEX inbound_status ON inbound(status);
CREATE TABLE notifications (
  id TEXT PRIMARY KEY, client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  order_id TEXT, type TEXT NOT NULL DEFAULT 'info', message TEXT NOT NULL, read INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL);
CREATE INDEX notifications_client ON notifications(client_id, created_at);
CREATE TABLE sessions (
  id TEXT PRIMARY KEY, kind TEXT NOT NULL, client_id TEXT REFERENCES clients(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL, expires_at TEXT NOT NULL, last_seen_at TEXT NOT NULL,
  ip TEXT NOT NULL DEFAULT '', user_agent TEXT NOT NULL DEFAULT '');
CREATE INDEX sessions_expires ON sessions(expires_at);
CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
`;

function migrate() {
  const version = Number(Object.values(conn.prepare('PRAGMA user_version').get())[0]) || 0;
  if (version >= SCHEMA_VERSION) return;
  db.tx(() => {
    if (version < 1) conn.exec(SCHEMA_V1);
    // v2: an order may be placed against inventory that is still on its way.
    if (version < 2) conn.exec('ALTER TABLE orders ADD COLUMN awaiting_stock INTEGER NOT NULL DEFAULT 0');
    conn.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`);
  });
}
migrate();

// ---------- one-time import of the old JSON store ----------
function importLegacyJson() {
  if (!existsSync(LEGACY_JSON)) return;
  if (db.get('SELECT 1 AS x FROM clients LIMIT 1')) return; // already has data; leave the JSON alone
  let raw;
  try { raw = JSON.parse(readFileSync(LEGACY_JSON, 'utf8')); } catch (e) { console.warn('[db] store.json could not be read, skipping import:', e.message); return; }
  const counts = { clients: 0, products: 0, orders: 0, items: 0, inbound: 0, notifications: 0, skippedProducts: 0 };
  db.tx(() => {
    for (const c of raw.clients || []) {
      db.run('INSERT INTO clients (id, name, email, code, created_at) VALUES (?,?,?,?,?)', c.id, c.name, c.email || '', c.code, c.created_at || new Date().toISOString());
      counts.clients++;
    }
    for (const p of raw.products || []) {
      const row = [p.id, p.client_id, p.sku || null, p.name, p.description || '', p.location || '', p.type || '', p.image || null, p.image_source || null, Math.max(0, parseInt(p.stock, 10) || 0), p.created_at || new Date().toISOString()];
      try {
        db.run('INSERT INTO products (id, client_id, sku, name, description, location, type, image, image_source, stock, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)', ...row);
        counts.products++;
      } catch (e) {
        // Duplicate SKU within a client (case-insensitive): keep the product, drop the SKU.
        if (/UNIQUE/i.test(e.message)) { row[2] = null; db.run('INSERT INTO products (id, client_id, sku, name, description, location, type, image, image_source, stock, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)', ...row); counts.products++; counts.skippedProducts++; }
        else throw e;
      }
    }
    for (const o of raw.orders || []) {
      db.run('INSERT INTO orders (id, client_id, order_number, status, ship_to, label_filename, label_mime, label_original, created_at, printed_at, stock_deducted) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
        o.id, o.client_id, o.order_number, o.status || 'new', o.ship_to || '', o.label?.filename || null, o.label?.mime || null, o.label?.original || null, o.created_at || new Date().toISOString(), o.printed_at || null, o.stock_deducted ? 1 : 0);
      counts.orders++;
      (o.items || []).forEach((it, i) => {
        const pid = it.product_id && db.get('SELECT 1 AS x FROM products WHERE id = ?', it.product_id) ? it.product_id : null;
        db.run('INSERT INTO order_items (order_id, product_id, sku, name, quantity, position) VALUES (?,?,?,?,?,?)', o.id, pid, it.sku || null, it.name, Math.max(1, parseInt(it.quantity, 10) || 1), i);
        counts.items++;
      });
    }
    for (const r of raw.inbound || []) {
      if (!db.get('SELECT 1 AS x FROM products WHERE id = ?', r.product_id)) continue;
      db.run('INSERT INTO inbound (id, client_id, product_id, quantity, expected_at, tracking_id, status, created_by, created_at, received_at, received_quantity) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
        r.id, r.client_id, r.product_id, r.quantity, r.expected_at || '', r.tracking_id || '', r.status || 'expected', r.created_by || 'client', r.created_at || new Date().toISOString(), r.received_at || null, r.received_quantity ?? null);
      counts.inbound++;
    }
    for (const n of raw.notifications || []) {
      db.run('INSERT INTO notifications (id, client_id, order_id, type, message, read, created_at) VALUES (?,?,?,?,?,?,?)', n.id, n.client_id, n.order_id || null, n.type || 'info', n.message, n.read ? 1 : 0, n.created_at || new Date().toISOString());
      counts.notifications++;
    }
    // The old store kept the warehouse passcode in plain text; it is stored hashed from now on.
    if (raw.settings?.warehousePass) db.setSetting('warehouse_pass_hash', hashPassword(raw.settings.warehousePass));
  });
  const moved = `${LEGACY_JSON}.migrated-${new Date().toISOString().slice(0, 10)}`;
  renameSync(LEGACY_JSON, moved);
  console.log(`[db] Imported store.json into ${DB_FILE}: ${counts.clients} clients, ${counts.products} products, ${counts.orders} orders (${counts.items} lines), ${counts.inbound} deliveries, ${counts.notifications} notifications.${counts.skippedProducts ? ` ${counts.skippedProducts} duplicate SKU(s) cleared.` : ''}`);
  console.log(`[db] The old file was renamed to ${moved}. Delete it once you are happy with the import.`);
}
importLegacyJson();
