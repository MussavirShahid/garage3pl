import express from 'express';
import multer from 'multer';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { existsSync, mkdirSync, createReadStream, unlinkSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { randomUUID, randomInt, createHash } from 'node:crypto';

import { db } from './db.js';
import { hashPassword } from './passwords.js';
import {
  createSession, destroySession, destroyOtherWarehouseSessions, requireClient, requireWarehouse,
  loginLimiter, verifyWarehousePass, securityHeaders, requireFetchHeader, pruneSessions,
} from './auth.js';
import { findImages } from './services/images.js';
import { notifyClient } from './services/notify.js';
import { ensureSeed } from './seed.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const PUBLIC_DIR = join(ROOT, 'public');
const UP_LABELS = join(ROOT, 'uploads', 'labels');
const UP_PRODUCTS = join(ROOT, 'uploads', 'products');
for (const d of [UP_LABELS, UP_PRODUCTS]) mkdirSync(d, { recursive: true });

const seeded = ensureSeed();
pruneSessions();

const app = express();
app.disable('x-powered-by');
// Behind a host's proxy (cPanel/Passenger, Cloudflare, Render) the client IP and https flag come
// from forwarded headers. TRUST_PROXY=false turns that off for a server exposed directly.
{
  const tp = process.env.TRUST_PROXY ?? '1';
  app.set('trust proxy', tp === 'false' ? false : (Number.isNaN(Number(tp)) ? tp : Number(tp)));
}
app.use(securityHeaders);
app.use(express.json({ limit: '256kb' }));
app.use('/api', requireFetchHeader);
app.use('/api', (_req, res, next) => { res.setHeader('Cache-Control', 'no-store'); next(); }); // private data: never cached

// ---------- browser caching ----------
// ASSET_V changes whenever a CSS/JS file changes. Pages are served with every /css and /js
// reference stamped "?v=ASSET_V": the stamped files may be cached for a year, while pages and
// unstamped files are always re-checked with the server. Result: a plain reload after an
// update always shows the new version, with no manual cache clearing.
const ASSET_V = (() => {
  const h = createHash('sha1');
  for (const dir of ['css', 'js']) {
    const full = join(PUBLIC_DIR, dir);
    if (!existsSync(full)) continue;
    for (const f of readdirSync(full).sort()) { const p = join(full, f); h.update(f); h.update(String(statSync(p).size)); h.update(readFileSync(p)); }
  }
  return h.digest('hex').slice(0, 10);
})();
const pageCache = new Map();
function servePage(file, res) {
  let html = pageCache.get(file);
  if (!html) {
    html = readFileSync(join(PUBLIC_DIR, file), 'utf8').replace(/(["'])(\/(?:css|js)\/[^"'?#]+)\1/g, `$1$2?v=${ASSET_V}$1`);
    pageCache.set(file, html);
  }
  res.setHeader('Cache-Control', 'no-cache');
  res.type('html').send(html);
}
app.get(['/', '/index.html'], (_req, res) => servePage('index.html', res));
app.get(/^\/([\w-]+\.html)$/, (req, res, next) => (existsSync(join(PUBLIC_DIR, req.params[0])) ? servePage(req.params[0], res) : next()));
app.use((req, res, next) => {
  if (!req.path.startsWith('/api/')) res.setHeader('Cache-Control', req.query.v === ASSET_V ? 'public, max-age=31536000, immutable' : 'no-cache');
  next();
});
app.use(express.static(PUBLIC_DIR, { index: false }));
app.use('/files/products', express.static(UP_PRODUCTS, { dotfiles: 'deny', index: false }));

// ---------- uploads (type allow-lists, random file names, size caps) ----------
const LABEL_TYPES = { 'application/pdf': '.pdf', 'image/png': '.png', 'image/jpeg': '.jpg', 'image/webp': '.webp' };
const IMAGE_TYPES = { 'image/png': '.png', 'image/jpeg': '.jpg', 'image/webp': '.webp', 'image/gif': '.gif' };
function uploader(dir, types, maxMb, what) {
  return multer({
    storage: multer.diskStorage({
      destination: (_req, _f, cb) => cb(null, dir),
      filename: (_req, file, cb) => cb(null, `${randomUUID()}${types[file.mimetype]}`),
    }),
    limits: { fileSize: maxMb * 1024 * 1024, files: 1 },
    fileFilter: (_req, file, cb) => (types[file.mimetype] ? cb(null, true) : cb(new Error(`${what} must be ${Object.values(types).map((e) => e.slice(1).toUpperCase()).join(', ')}.`))),
  });
}
const labelUpload = uploader(UP_LABELS, LABEL_TYPES, 15, 'A label');
const productImgUpload = uploader(UP_PRODUCTS, IMAGE_TYPES, 10, 'A product photo');
// Turn multer's errors into a normal 400 instead of a stack trace.
const upload = (mw) => (req, res, next) => mw(req, res, (err) => {
  if (!err) return next();
  res.status(400).json({ error: err.code === 'LIMIT_FILE_SIZE' ? 'That file is too large.' : err.message });
});

// ---------- helpers ----------
const now = () => new Date().toISOString();
const str = (v, max = 200) => String(v ?? '').trim().slice(0, max);
const isDay = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s);

// Products with their stock figures:
//   stock     = units on hand (up when a delivery is received, down when an order is first printed)
//   incoming  = units in deliveries logged but not received yet ("ordered")
//   committed = units promised to orders that are not printed yet (including ones awaiting delivery)
//   available = stock + incoming - committed: what a client may still create orders for
//   An order needing more than stock - committed is created "awaiting delivery" and released
//   when the inventory arrives.
const PRODUCT_SQL = `SELECT p.*,
  COALESCE((SELECT SUM(oi.quantity) FROM order_items oi JOIN orders o ON o.id = oi.order_id
    WHERE oi.product_id = p.id AND o.status IN ('new','label_ready')), 0) AS committed,
  COALESCE((SELECT SUM(r.quantity) FROM inbound r WHERE r.product_id = p.id AND r.status = 'expected'), 0) AS incoming
  FROM products p`;
const withStock = (p) => (p ? { ...p, available: p.stock + p.incoming - p.committed } : p);
const stockFields = (p) => ({ stock: p.stock, incoming: p.incoming, committed: p.committed, available: p.available });

// Release orders that were waiting for inventory, oldest first, once their units are on hand.
// The pool per product is stock minus what non-waiting unprinted orders already hold.
function resolveAwaiting() {
  const waiting = db.all("SELECT id, client_id, order_number FROM orders WHERE awaiting_stock = 1 AND status IN ('new','label_ready') ORDER BY created_at");
  if (!waiting.length) return;
  const pool = new Map();
  const poolFor = (pid) => {
    if (!pool.has(pid)) {
      const r = db.get(`SELECT p.stock - COALESCE((SELECT SUM(oi.quantity) FROM order_items oi JOIN orders o ON o.id = oi.order_id
        WHERE oi.product_id = p.id AND o.status IN ('new','label_ready') AND o.awaiting_stock = 0), 0) AS ready FROM products p WHERE p.id = ?`, pid);
      pool.set(pid, r ? r.ready : 0);
    }
    return pool.get(pid);
  };
  for (const o of waiting) {
    const lines = db.all('SELECT product_id, SUM(quantity) AS q FROM order_items WHERE order_id = ? AND product_id IS NOT NULL GROUP BY product_id', o.id);
    if (!lines.every((l) => l.q <= poolFor(l.product_id))) continue;
    for (const l of lines) pool.set(l.product_id, poolFor(l.product_id) - l.q);
    db.run('UPDATE orders SET awaiting_stock = 0 WHERE id = ?', o.id);
    notifyClient(o.client_id, { orderId: o.id, type: 'order_ready', message: `Order ${o.order_number}: the inventory it was waiting for has arrived, so the warehouse can now pick it.` });
  }
}
const products = (where, ...params) => db.all(`${PRODUCT_SQL} ${where}`, ...params).map(withStock);
const product = (where, ...params) => withStock(db.get(`${PRODUCT_SQL} ${where}`, ...params));

function loadOrders(where, orderBy, params, { includeClient = false } = {}) {
  const rows = db.all(`SELECT o.*${includeClient ? ', c.name AS client_name' : ''} FROM orders o${includeClient ? ' JOIN clients c ON c.id = o.client_id' : ''} ${where} ${orderBy}`, ...params);
  const byId = new Map(rows.map((o) => [o.id, (o.items = [])]));
  const ids = [...byId.keys()];
  for (let i = 0; i < ids.length; i += 400) {
    const chunk = ids.slice(i, i + 400);
    const items = db.all(`SELECT oi.order_id, oi.sku, oi.name, oi.quantity, oi.product_id, p.image, p.location, p.description, p.type
      FROM order_items oi LEFT JOIN products p ON p.id = oi.product_id WHERE oi.order_id IN (${chunk.map(() => '?').join(',')}) ORDER BY oi.position, oi.id`, ...chunk);
    for (const it of items) byId.get(it.order_id).push({ sku: it.sku, name: it.name, quantity: it.quantity, product_id: it.product_id, image: it.image || null, location: it.location || '', description: it.description || '', type: it.type || '' });
  }
  return rows.map(serializeOrder);
}
function serializeOrder(o) {
  const waiting = !!o.awaiting_stock && (o.status === 'new' || o.status === 'label_ready');
  const out = {
    id: o.id, client_id: o.client_id, order_number: o.order_number,
    status: waiting ? 'awaiting_delivery' : o.status, // the label state is still visible via has_label
    awaiting_delivery: waiting, ship_to: o.ship_to,
    items: o.items, has_label: !!o.label_filename, created_at: o.created_at, printed_at: o.printed_at || null,
  };
  if (o.client_name !== undefined) out.client_name = o.client_name;
  return out;
}
const orderById = (id, clientId = null) => loadOrders(`WHERE o.id = ?${clientId ? ' AND o.client_id = ?' : ''}`, '', clientId ? [id, clientId] : [id], { includeClient: !clientId })[0] || null;

const INBOUND_SQL = `SELECT r.*, COALESCE(p.name, 'Deleted product') AS product_name, COALESCE(p.sku, '') AS sku, p.image, COALESCE(c.name, 'Unknown') AS client_name
  FROM inbound r LEFT JOIN products p ON p.id = r.product_id LEFT JOIN clients c ON c.id = r.client_id`;
// Expected deliveries first (soonest expected date first), then received (latest first).
const INBOUND_ORDER = `ORDER BY CASE r.status WHEN 'expected' THEN 0 ELSE 1 END,
  CASE WHEN r.status = 'expected' THEN COALESCE(NULLIF(r.expected_at, ''), '9999') END ASC, r.received_at DESC, r.created_at DESC`;
const inboundRows = (where, ...params) => db.all(`${INBOUND_SQL} ${where} ${INBOUND_ORDER}`, ...params);
const inboundById = (id) => db.get(`${INBOUND_SQL} WHERE r.id = ?`, id) || null;

function newInbound({ client_id, product_id, quantity, expected_at, tracking_id, created_by }) {
  const p = db.get('SELECT id FROM products WHERE id = ? AND client_id = ?', product_id, client_id);
  if (!p) return { error: 'Choose a product that belongs to this client.' };
  const q = parseInt(quantity, 10);
  if (!Number.isInteger(q) || q < 1 || q > 1000000) return { error: 'Quantity must be a whole number of at least 1.' };
  const date = str(expected_at, 10);
  if (date && !isDay(date)) return { error: 'Expected delivery date must be a calendar date.' };
  const id = db.uid();
  db.run('INSERT INTO inbound (id, client_id, product_id, quantity, expected_at, tracking_id, status, created_by, created_at) VALUES (?,?,?,?,?,?,?,?,?)',
    id, client_id, product_id, q, date, str(tracking_id, 100), 'expected', created_by, now());
  return { id };
}
// Close an expected delivery with the quantity that actually arrived.
//   quantity omitted  -> the expected quantity
//   quantity 0        -> nothing arrived: status "not_received", stock untouched
//   anything else     -> must be a whole number >= 0, otherwise an error (never a silent fallback)
function receiveInbound(id, quantity) {
  return db.tx(() => {
    const r = db.get('SELECT * FROM inbound WHERE id = ?', id);
    if (!r) return { error: 'Delivery not found.', status: 404 };
    if (r.status !== 'expected') return { error: 'This delivery was already closed.', status: 409 };
    let q = r.quantity;
    if (quantity !== undefined && quantity !== null && String(quantity).trim() !== '') {
      const parsed = Number(String(quantity).trim());
      if (!Number.isInteger(parsed) || parsed < 0 || parsed > 1000000) return { error: 'Quantity received must be a whole number (0 if nothing arrived).', status: 400 };
      q = parsed;
    }
    const p = db.get('SELECT name FROM products WHERE id = ?', r.product_id);
    const what = `${r.quantity} × ${p ? p.name : 'product'}${r.tracking_id ? ` (tracking ${r.tracking_id})` : ''}`;
    if (q === 0) {
      db.run('UPDATE inbound SET status = ?, received_at = ?, received_quantity = 0 WHERE id = ?', 'not_received', now(), id);
      notifyClient(r.client_id, { type: 'inventory_not_received', message: `Delivery not received: ${what} did not arrive at the warehouse. Stock is unchanged; log a new delivery when it ships.` });
    } else {
      db.run('UPDATE inbound SET status = ?, received_at = ?, received_quantity = ? WHERE id = ?', 'received', now(), q, id);
      db.run('UPDATE products SET stock = stock + ? WHERE id = ?', q, r.product_id);
      notifyClient(r.client_id, { type: 'inventory_received', message: `Inventory received: ${q} × ${p ? p.name : 'product'}${q !== r.quantity ? ` (${r.quantity} were expected)` : ''}${r.tracking_id ? ` (tracking ${r.tracking_id})` : ''}. It is now available to order.` });
    }
    resolveAwaiting();
    return { id: r.id };
  });
}

const unlinkQuiet = (full) => { try { if (existsSync(full)) unlinkSync(full); } catch { /* best effort */ } };
const removeLabelFile = (filename) => filename && unlinkQuiet(join(UP_LABELS, filename));
const removeProductImage = (image) => image && image.startsWith('/files/products/') && unlinkQuiet(join(UP_PRODUCTS, image.replace('/files/products/', '')));

// Best-effort web image lookups for products missing a picture. Non-blocking.
async function backfillImages(list) {
  for (const p of list) {
    if (p.image) continue;
    try {
      const { results } = await findImages(p.name, { limit: 1 });
      // Only fill if nobody set a picture while the lookup ran.
      if (results[0]) db.run("UPDATE products SET image = ?, image_source = ? WHERE id = ? AND (image IS NULL OR image = '')", results[0].url, results[0].provider, p.id);
    } catch { /* best effort */ }
  }
}

function genCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = '';
  for (let i = 0; i < 8; i++) s += chars[randomInt(chars.length)];
  return db.get('SELECT 1 AS x FROM clients WHERE code = ?', s) ? genCode() : s;
}

// ================= AUTH =================
app.post('/api/auth/warehouse', loginLimiter, (req, res) => {
  const passcode = String((req.body || {}).passcode ?? '');
  if (!passcode || !verifyWarehousePass(passcode)) { req.loginFailed(); return res.status(401).json({ error: 'Incorrect passcode.' }); }
  req.loginSucceeded();
  createSession(req, res, { kind: 'warehouse' });
  res.json({ ok: true });
});
app.post('/api/auth/client', loginLimiter, (req, res) => {
  const code = str((req.body || {}).code, 32).toUpperCase();
  const client = code ? db.get('SELECT id, name FROM clients WHERE code = ?', code) : null;
  if (!client) { req.loginFailed(); return res.status(401).json({ error: 'Unknown access code.' }); }
  req.loginSucceeded();
  createSession(req, res, { kind: 'client', clientId: client.id });
  res.json({ ok: true, client });
});
app.post('/api/auth/logout', (req, res) => { destroySession(req, res); res.json({ ok: true }); });

// ================= CLIENT API =================
app.get('/api/client/me', requireClient, (req, res) => {
  res.json({ id: req.client.id, name: req.client.name, email: req.client.email });
});

app.get('/api/client/products', requireClient, (req, res) => {
  res.json(products('WHERE p.client_id = ? ORDER BY p.created_at', req.client.id));
});

app.post('/api/client/products', requireClient, (req, res) => {
  const b = req.body || {};
  const name = str(b.name, 200);
  if (!name) return res.status(400).json({ error: 'Product name is required.' });
  const sku = str(b.sku, 64) || null;
  if (sku && db.get('SELECT 1 AS x FROM products WHERE client_id = ? AND sku = ? COLLATE NOCASE', req.client.id, sku)) {
    return res.status(409).json({ error: `A product with SKU ${sku} already exists.` });
  }
  const image = str(b.image, 2000) || null;
  const id = db.uid();
  db.run('INSERT INTO products (id, client_id, sku, name, description, location, type, image, image_source, stock, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
    id, req.client.id, sku, name, str(b.description, 2000), str(b.location, 100), str(b.type, 100), image, image ? 'manual' : null, 0, now());
  const p = product('WHERE p.id = ?', id);
  if (!p.image) backfillImages([p]);
  res.json(p);
});

app.patch('/api/client/products/:id', requireClient, (req, res) => {
  const p = db.get('SELECT id FROM products WHERE id = ? AND client_id = ?', req.params.id, req.client.id);
  if (!p) return res.status(404).json({ error: 'Product not found.' });
  const b = req.body || {};
  const sets = [], vals = [];
  for (const [k, max] of [['name', 200], ['type', 100], ['location', 100], ['description', 2000], ['image', 2000]]) {
    if (typeof b[k] === 'string') { sets.push(`${k} = ?`); vals.push(str(b[k], max)); }
  }
  if (typeof b.name === 'string' && !str(b.name)) return res.status(400).json({ error: 'Product name cannot be empty.' });
  if (typeof b.image === 'string' && str(b.image)) { sets.push('image_source = ?'); vals.push('manual'); }
  if (sets.length) db.run(`UPDATE products SET ${sets.join(', ')} WHERE id = ?`, ...vals, p.id);
  res.json(product('WHERE p.id = ?', p.id));
});

app.post('/api/client/products/:id/image', requireClient, upload(productImgUpload.single('image')), (req, res) => {
  const p = db.get('SELECT id, image FROM products WHERE id = ? AND client_id = ?', req.params.id, req.client.id);
  if (!p) { if (req.file) unlinkQuiet(req.file.path); return res.status(404).json({ error: 'Product not found.' }); }
  if (!req.file) return res.status(400).json({ error: 'No image uploaded.' });
  removeProductImage(p.image);
  db.run('UPDATE products SET image = ?, image_source = ? WHERE id = ?', `/files/products/${req.file.filename}`, 'upload', p.id);
  res.json(product('WHERE p.id = ?', p.id));
});

app.get('/api/client/products/:id/find-image', requireClient, async (req, res, next) => {
  try {
    const p = db.get('SELECT name FROM products WHERE id = ? AND client_id = ?', req.params.id, req.client.id);
    if (!p) return res.status(404).json({ error: 'Product not found.' });
    const { query, results } = await findImages(str(req.query.q, 200) || p.name, { limit: 8 });
    res.json({ query, results });
  } catch (e) { next(e); }
});

// Create an order. Every product must have enough available units (checked inside the same
// write transaction, so two orders cannot both take the last unit).
app.post('/api/client/orders', requireClient, (req, res) => {
  const b = req.body || {};
  if (!Array.isArray(b.items) || !b.items.length || b.items.length > 200) return res.status(400).json({ error: 'Add at least one item.' });
  const result = db.tx(() => {
    const lines = [];
    for (const it of b.items) {
      const p = db.get('SELECT id, sku, name FROM products WHERE id = ? AND client_id = ?', String(it?.product_id ?? ''), req.client.id);
      if (!p) return { status: 400, error: 'Unknown product in order.' };
      lines.push({ product_id: p.id, sku: p.sku, name: p.name, quantity: Math.min(1000000, Math.max(1, parseInt(it.quantity, 10) || 1)) });
    }
    const want = new Map();
    for (const l of lines) want.set(l.product_id, (want.get(l.product_id) || 0) + l.quantity);
    // Units beyond what is on hand (after other orders) may still be ordered against incoming
    // deliveries; such an order waits ("awaiting delivery") until the inventory is received.
    let awaiting = false;
    for (const [pid, qty] of want) {
      const p = product('WHERE p.id = ?', pid);
      if (qty > p.available) {
        return { status: 409, error: p.available > 0
          ? `Not enough inventory for "${p.name}": ${p.available} available (${Math.max(0, p.stock - p.committed)} on hand, ${p.incoming} on the way), ${qty} requested.`
          : `No inventory for "${p.name}". Log a delivery for it on the Inventory tab, then you can order it.` };
      }
      if (qty > p.stock - p.committed) awaiting = true;
    }
    let num = str(b.order_number, 64);
    if (!num) num = `M-${Date.now().toString(36).toUpperCase()}`;
    if (db.get('SELECT 1 AS x FROM orders WHERE client_id = ? AND order_number = ?', req.client.id, num)) return { status: 409, error: `Order ${num} already exists.` };
    const id = db.uid();
    db.run('INSERT INTO orders (id, client_id, order_number, status, ship_to, created_at, awaiting_stock) VALUES (?,?,?,?,?,?,?)', id, req.client.id, num, 'new', str(b.ship_to, 500), now(), awaiting ? 1 : 0);
    lines.forEach((l, i) => db.run('INSERT INTO order_items (order_id, product_id, sku, name, quantity, position) VALUES (?,?,?,?,?,?)', id, l.product_id, l.sku, l.name, l.quantity, i));
    return { id };
  });
  if (result.error) return res.status(result.status).json({ error: result.error });
  res.json(orderById(result.id, req.client.id));
});

app.get('/api/client/orders', requireClient, (req, res) => {
  res.json(loadOrders('WHERE o.client_id = ?', 'ORDER BY o.created_at DESC', [req.client.id]));
});

app.post('/api/client/orders/:id/label', requireClient, upload(labelUpload.single('label')), (req, res) => {
  const o = db.get('SELECT id, status, label_filename FROM orders WHERE id = ? AND client_id = ?', req.params.id, req.client.id);
  if (!o) { if (req.file) unlinkQuiet(req.file.path); return res.status(404).json({ error: 'Order not found.' }); }
  if (!req.file) return res.status(400).json({ error: 'No label uploaded.' });
  removeLabelFile(o.label_filename);
  db.run('UPDATE orders SET label_filename = ?, label_mime = ?, label_original = ?, status = ? WHERE id = ?',
    req.file.filename, req.file.mimetype, str(req.file.originalname, 200) || 'label', o.status === 'new' ? 'label_ready' : o.status, o.id);
  res.json(orderById(o.id, req.client.id));
});

// Delete an order: allowed only until the warehouse has printed it.
app.delete('/api/client/orders/:id', requireClient, (req, res) => {
  const o = db.get('SELECT id, order_number, status, label_filename FROM orders WHERE id = ? AND client_id = ?', req.params.id, req.client.id);
  if (!o) return res.status(404).json({ error: 'Order not found.' });
  if (o.status === 'printed' || o.status === 'shipped') {
    return res.status(409).json({ error: `Order ${o.order_number} has already been printed and can no longer be deleted. Contact the warehouse.` });
  }
  db.tx(() => { db.run('DELETE FROM orders WHERE id = ?', o.id); resolveAwaiting(); }); // freed units may release a waiting order
  removeLabelFile(o.label_filename);
  res.json({ ok: true });
});

app.get('/api/client/notifications', requireClient, (req, res) => {
  res.json(db.all('SELECT id, client_id, order_id, type, message, read, created_at FROM notifications WHERE client_id = ? ORDER BY created_at DESC LIMIT 200', req.client.id)
    .map((n) => ({ ...n, read: !!n.read })));
});
app.post('/api/client/notifications/read', requireClient, (req, res) => {
  db.run('UPDATE notifications SET read = 1 WHERE client_id = ? AND read = 0', req.client.id);
  res.json({ ok: true });
});

// ---------- client inventory ----------
app.get('/api/client/inventory', requireClient, (req, res) => {
  const list = products('WHERE p.client_id = ? ORDER BY p.name', req.client.id)
    .map((p) => ({ id: p.id, name: p.name, sku: p.sku, image: p.image, ...stockFields(p) }));
  res.json({ products: list, inbound: inboundRows('WHERE r.client_id = ?', req.client.id) });
});
app.post('/api/client/inbound', requireClient, (req, res) => {
  const b = req.body || {};
  const r = newInbound({ client_id: req.client.id, product_id: String(b.product_id ?? ''), quantity: b.quantity, expected_at: b.expected_at, tracking_id: b.tracking_id, created_by: 'client' });
  if (r.error) return res.status(400).json({ error: r.error });
  res.json(inboundById(r.id));
});
app.delete('/api/client/inbound/:id', requireClient, (req, res) => {
  const r = db.get('SELECT id, status FROM inbound WHERE id = ? AND client_id = ?', req.params.id, req.client.id);
  if (!r) return res.status(404).json({ error: 'Delivery not found.' });
  if (r.status !== 'expected') return res.status(409).json({ error: 'This delivery was already received; stock has been updated.' });
  db.run('DELETE FROM inbound WHERE id = ?', r.id);
  res.json({ ok: true });
});

// ================= WAREHOUSE API =================
app.get('/api/wh/me', requireWarehouse, (_req, res) => res.json({ ok: true }));

// Change the warehouse passcode; every other warehouse device is signed out.
app.post('/api/wh/passcode', requireWarehouse, (req, res) => {
  const { current, next: nextPass } = req.body || {};
  if (!verifyWarehousePass(String(current ?? ''))) return res.status(401).json({ error: 'Current passcode is incorrect.' });
  const np = String(nextPass ?? '');
  if (np.length < 8 || np.length > 128) return res.status(400).json({ error: 'New passcode must be at least 8 characters.' });
  db.setSetting('warehouse_pass_hash', hashPassword(np));
  destroyOtherWarehouseSessions(req);
  res.json({ ok: true });
});

app.get('/api/wh/clients', requireWarehouse, (_req, res) => {
  res.json(db.all('SELECT c.id, c.name, c.email, c.code, (SELECT COUNT(*) FROM orders o WHERE o.client_id = c.id) AS orders FROM clients c ORDER BY c.name'));
});
app.post('/api/wh/clients', requireWarehouse, (req, res) => {
  const b = req.body || {};
  const name = str(b.name, 200);
  if (!name) return res.status(400).json({ error: 'Client name is required.' });
  const client = { id: db.uid(), name, email: str(b.email, 200), code: genCode(), created_at: now() };
  db.run('INSERT INTO clients (id, name, email, code, created_at) VALUES (?,?,?,?,?)', client.id, client.name, client.email, client.code, client.created_at);
  res.json(client);
});
// Delete a client and everything that belongs to them (orders, products, labels, photos, deliveries, notifications).
app.delete('/api/wh/clients/:id', requireWarehouse, (req, res) => {
  const c = db.get('SELECT id FROM clients WHERE id = ?', req.params.id);
  if (!c) return res.status(404).json({ error: 'Client not found.' });
  const labels = db.all('SELECT label_filename FROM orders WHERE client_id = ? AND label_filename IS NOT NULL', c.id);
  const images = db.all('SELECT image FROM products WHERE client_id = ?', c.id);
  const removed = {
    orders: db.get('SELECT COUNT(*) AS n FROM orders WHERE client_id = ?', c.id).n,
    products: db.get('SELECT COUNT(*) AS n FROM products WHERE client_id = ?', c.id).n,
  };
  db.run('DELETE FROM clients WHERE id = ?', c.id); // cascades to products, orders, items, inbound, notifications, sessions
  for (const l of labels) removeLabelFile(l.label_filename);
  for (const i of images) removeProductImage(i.image);
  res.json({ ok: true, removed });
});

// Queue with filters: status, client, item type, local-calendar-day range; sort newest|oldest.
app.get('/api/wh/orders', requireWarehouse, (req, res) => {
  const q = req.query;
  const where = [], params = [];
  // "awaiting_delivery" is a virtual status: unprinted orders still waiting for inventory.
  if (q.status === 'awaiting_delivery') where.push("o.awaiting_stock = 1 AND o.status IN ('new','label_ready')");
  else if (q.status && q.status !== 'all') { where.push('o.status = ? AND o.awaiting_stock = 0'); params.push(str(q.status, 20)); }
  if (q.client) { where.push('o.client_id = ?'); params.push(str(q.client, 64)); }
  if (isDay(str(q.from, 10))) { where.push("date(o.created_at, 'localtime') >= ?"); params.push(str(q.from, 10)); }
  if (isDay(str(q.to, 10))) { where.push("date(o.created_at, 'localtime') <= ?"); params.push(str(q.to, 10)); }
  if (q.type) { where.push('EXISTS (SELECT 1 FROM order_items oi JOIN products p ON p.id = oi.product_id WHERE oi.order_id = o.id AND lower(p.type) = lower(?))'); params.push(str(q.type, 100)); }
  res.json(loadOrders(where.length ? `WHERE ${where.join(' AND ')}` : '', `ORDER BY o.created_at ${q.sort === 'oldest' ? 'ASC' : 'DESC'} LIMIT 2000`, params, { includeClient: true }));
});
app.get('/api/wh/product-types', requireWarehouse, (_req, res) => {
  res.json(db.all("SELECT DISTINCT trim(type) AS t FROM products WHERE trim(type) <> '' ORDER BY t COLLATE NOCASE").map((r) => r.t));
});
app.get('/api/wh/orders/:id', requireWarehouse, (req, res) => {
  const o = orderById(req.params.id);
  if (!o) return res.status(404).json({ error: 'Order not found.' });
  res.json(o);
});

// Mark an order printed and notify the client. The first print takes its units out of stock;
// reprints (and orders printed before inventory existed) never deduct again.
app.post('/api/wh/orders/:id/print', requireWarehouse, (req, res) => {
  const done = db.tx(() => {
    const o = db.get('SELECT * FROM orders WHERE id = ?', req.params.id);
    if (!o) return null;
    if (o.awaiting_stock && (o.status === 'new' || o.status === 'label_ready')) return { error: `Order ${o.order_number} is awaiting delivery of its inventory and cannot be printed yet.` };
    const firstPrint = o.status !== 'printed' && o.status !== 'shipped' && !o.stock_deducted;
    if (firstPrint) {
      for (const it of db.all('SELECT product_id, quantity FROM order_items WHERE order_id = ? AND product_id IS NOT NULL', o.id)) {
        db.run('UPDATE products SET stock = MAX(0, stock - ?) WHERE id = ?', it.quantity, it.product_id);
      }
    }
    db.run('UPDATE orders SET status = ?, printed_at = ?, stock_deducted = ? WHERE id = ?', 'printed', now(), firstPrint ? 1 : o.stock_deducted, o.id);
    notifyClient(o.client_id, { orderId: o.id, type: 'printed', message: `Order ${o.order_number} has been printed and is being prepared to ship.` });
    return o.id;
  });
  if (!done) return res.status(404).json({ error: 'Order not found.' });
  if (done.error) return res.status(409).json({ error: done.error });
  res.json(orderById(done));
});

app.patch('/api/wh/products/:id', requireWarehouse, (req, res) => {
  const p = db.get('SELECT id FROM products WHERE id = ?', req.params.id);
  if (!p) return res.status(404).json({ error: 'Product not found.' });
  const b = req.body || {};
  const sets = [], vals = [];
  for (const [k, max] of [['type', 100], ['location', 100], ['description', 2000], ['image', 2000]]) {
    if (typeof b[k] === 'string') { sets.push(`${k} = ?`); vals.push(str(b[k], max)); }
  }
  if (sets.length) db.run(`UPDATE products SET ${sets.join(', ')} WHERE id = ?`, ...vals, p.id);
  res.json(product('WHERE p.id = ?', p.id));
});

// ---------- warehouse inventory ----------
app.get('/api/wh/inventory', requireWarehouse, (req, res) => {
  const client = str(req.query.client, 64), status = str(req.query.status, 20);
  const stock = db.all(`${PRODUCT_SQL} JOIN clients c ON c.id = p.client_id ${client ? 'WHERE p.client_id = ?' : ''} ORDER BY c.name, p.name`, ...(client ? [client] : []))
    .map(withStock)
    .map((p) => ({ client_id: p.client_id, client_name: db.get('SELECT name FROM clients WHERE id = ?', p.client_id)?.name || 'Unknown', product_id: p.id, name: p.name, sku: p.sku, image: p.image, ...stockFields(p) }));
  const where = [], params = [];
  if (client) { where.push('r.client_id = ?'); params.push(client); }
  if (status && status !== 'all') { where.push('r.status = ?'); params.push(status); }
  res.json({ stock, inbound: inboundRows(where.length ? `WHERE ${where.join(' AND ')}` : '', ...params) });
});
app.post('/api/wh/inbound', requireWarehouse, (req, res) => {
  const b = req.body || {};
  const client_id = str(b.client_id, 64);
  if (!db.get('SELECT 1 AS x FROM clients WHERE id = ?', client_id)) return res.status(400).json({ error: 'Choose a client.' });
  const r = db.tx(() => {
    const made = newInbound({ client_id, product_id: str(b.product_id, 64), quantity: b.quantity, expected_at: b.expected_at, tracking_id: b.tracking_id, created_by: 'warehouse' });
    if (made.error) return made;
    if (b.received === true || b.received === 'true') receiveInbound(made.id);
    return made;
  });
  if (r.error) return res.status(400).json({ error: r.error });
  res.json(inboundById(r.id));
});
app.post('/api/wh/inbound/:id/receive', requireWarehouse, (req, res) => {
  const r = receiveInbound(req.params.id, (req.body || {}).quantity);
  if (r.error) return res.status(r.status).json({ error: r.error });
  res.json(inboundById(r.id));
});

// Correct a product's on-hand count (stock take, damaged units, a receipt entered wrongly).
app.patch('/api/wh/products/:id/stock', requireWarehouse, (req, res) => {
  const p = db.get('SELECT id, stock, name FROM products WHERE id = ?', req.params.id);
  if (!p) return res.status(404).json({ error: 'Product not found.' });
  const n = Number(String((req.body || {}).stock ?? '').trim());
  if (!Number.isInteger(n) || n < 0 || n > 1000000) return res.status(400).json({ error: 'On hand must be a whole number of 0 or more.' });
  db.tx(() => {
    db.run('UPDATE products SET stock = ? WHERE id = ?', n, p.id);
    if (n > p.stock) resolveAwaiting(); // more units on hand may release a waiting order
  });
  res.json(product('WHERE p.id = ?', p.id));
});

// ---------- label files (served to the owning client and the warehouse; cookies work in a new tab) ----------
function streamLabel(o, res) {
  if (!o || !o.label_filename) { res.status(404).send('No label on file.'); return; }
  const full = join(UP_LABELS, o.label_filename);
  if (!existsSync(full)) { res.status(404).send('Label file missing.'); return; }
  res.removeHeader('Content-Security-Policy'); // a bare PDF/image response, not a page
  res.setHeader('Content-Type', LABEL_TYPES[o.label_mime] ? o.label_mime : 'application/octet-stream');
  res.setHeader('Content-Disposition', `inline; filename="${String(o.label_original || 'label').replace(/[^\w.\- ]/g, '_')}"`);
  createReadStream(full).pipe(res);
}
const labelCols = 'SELECT id, label_filename, label_mime, label_original FROM orders';
app.get('/api/client/orders/:id/label', requireClient, (req, res) => streamLabel(db.get(`${labelCols} WHERE id = ? AND client_id = ?`, req.params.id, req.client.id), res));
app.get('/api/wh/orders/:id/label', requireWarehouse, (req, res) => streamLabel(db.get(`${labelCols} WHERE id = ?`, req.params.id), res));
// The printable label is the client's file exactly as uploaded.
app.get('/api/wh/orders/:id/print-label', requireWarehouse, (req, res) => streamLabel(db.get(`${labelCols} WHERE id = ?`, req.params.id), res));

// ---------- misc ----------
app.get('/healthz', (_req, res) => res.json({ ok: true }));
app.use('/api', (_req, res) => res.status(404).json({ error: 'Not found.' }));
// Never leak stack traces to the browser.
app.use((err, _req, res, next) => {
  if (res.headersSent) return next(err);
  if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Invalid request body.' });
  if (err.type === 'entity.too.large') return res.status(413).json({ error: 'Request is too large.' });
  console.error('[server]', err);
  res.status(500).json({ error: 'Something went wrong.' });
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`\n  Zip Packers running:  http://localhost:${PORT}`);
  console.log(`  Database:            ${db.file} (${db.driver})`);
  if (seeded.usingDefaultPasscode) console.log('  Warehouse passcode:  "warehouse" (the default) — change it on the warehouse Clients tab before going live.');
  const demo = db.get("SELECT code FROM clients WHERE name = 'Demo Client'");
  if (demo) console.log(`  Demo client code:    ${demo.code}`);
  console.log('');
  backfillImages(db.all("SELECT id, name, image FROM products WHERE image IS NULL OR image = ''"));
  // Housekeeping: a daily database backup (AUTO_BACKUP_HOURS=0 disables) and expired-session cleanup.
  const hours = Number(process.env.AUTO_BACKUP_HOURS ?? 24);
  if (hours > 0) {
    db.backupIfStale(hours);
    setInterval(() => db.backupIfStale(hours), 60 * 60 * 1000).unref();
  }
  setInterval(pruneSessions, 60 * 60 * 1000).unref();
});
