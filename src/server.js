import express from 'express';
import multer from 'multer';
import { fileURLToPath } from 'node:url';
import { dirname, join, extname } from 'node:path';
import { existsSync, mkdirSync, createReadStream } from 'node:fs';
import { randomUUID } from 'node:crypto';

import { db } from './db.js';
import { parseWorkbook } from './services/excel.js';
import { findImages } from './services/images.js';
import { notifyClient } from './services/notify.js';
import { ensureSeed } from './seed.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const PUBLIC_DIR = join(ROOT, 'public');
const UP_LABELS = join(ROOT, 'uploads', 'labels');
const UP_PRODUCTS = join(ROOT, 'uploads', 'products');
for (const d of [UP_LABELS, UP_PRODUCTS]) mkdirSync(d, { recursive: true });

ensureSeed();

const app = express();
app.use(express.json({ limit: '2mb' }));
app.use(express.static(PUBLIC_DIR));
app.use('/files/products', express.static(UP_PRODUCTS));

// ---------- uploads ----------
const memUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024 } });
const labelUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _f, cb) => cb(null, UP_LABELS),
    filename: (_req, file, cb) => cb(null, `${randomUUID()}${extname(file.originalname) || ''}`),
  }),
  limits: { fileSize: 15 * 1024 * 1024 },
});
const productImgUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _f, cb) => cb(null, UP_PRODUCTS),
    filename: (_req, file, cb) => cb(null, `${randomUUID()}${extname(file.originalname) || '.jpg'}`),
  }),
  limits: { fileSize: 10 * 1024 * 1024 },
});

// ---------- helpers ----------
const now = () => new Date().toISOString();
const localDay = (iso) => {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

function productFor(clientId, { sku, name }) {
  if (sku) {
    const p = db.products.find((x) => x.client_id === clientId && x.sku && x.sku.toLowerCase() === sku.toLowerCase());
    if (p) return p;
  }
  if (name) {
    const p = db.products.find((x) => x.client_id === clientId && !x.sku && x.name.toLowerCase() === name.toLowerCase());
    if (p) return p;
  }
  return null;
}

function serializeOrder(order, { includeClient = false } = {}) {
  const items = order.items.map((it) => {
    const p = it.product_id ? db.products.find((x) => x.id === it.product_id) : null;
    return {
      sku: it.sku,
      name: it.name,
      quantity: it.quantity,
      product_id: it.product_id,
      image: p?.image || null,
      location: p?.location || '',
      description: p?.description || '',
      type: p?.type || '',
    };
  });
  const out = {
    id: order.id,
    client_id: order.client_id,
    order_number: order.order_number,
    status: order.status,
    ship_to: order.ship_to,
    items,
    has_label: !!order.label,
    created_at: order.created_at,
    printed_at: order.printed_at || null,
  };
  if (includeClient) {
    const c = db.clients.find((x) => x.id === order.client_id);
    out.client_name = c?.name || 'Unknown';
  }
  return out;
}

// Kick off best-effort image lookups for products missing an image. Non-blocking.
async function backfillImages(products) {
  for (const p of products) {
    if (p.image) continue;
    try {
      const { results } = await findImages(p.name, { limit: 1 });
      // Re-check: the user may have uploaded a picture while the lookup ran.
      if (results[0] && !p.image) {
        p.image = results[0].url;
        p.image_source = results[0].provider;
        db.save();
      }
    } catch { /* best effort */ }
  }
}

// ---------- auth middleware ----------
function warehouseAuth(req, res, next) {
  const pass = req.get('x-wh-pass') || req.query.pass;
  if (!pass || pass !== db.settings.warehousePass) {
    return res.status(401).json({ error: 'Bad warehouse passcode.' });
  }
  next();
}
function clientAuth(req, res, next) {
  const code = req.get('x-client-code') || req.query.code;
  const client = db.clients.find((c) => c.code === code);
  if (!client) return res.status(401).json({ error: 'Bad client code.' });
  req.client = client;
  next();
}

// ================= AUTH =================
app.post('/api/auth/warehouse', (req, res) => {
  const { passcode } = req.body || {};
  if (passcode !== db.settings.warehousePass) return res.status(401).json({ error: 'Incorrect passcode.' });
  res.json({ ok: true });
});
app.post('/api/auth/client', (req, res) => {
  const { code } = req.body || {};
  const client = db.clients.find((c) => c.code === code);
  if (!client) return res.status(401).json({ error: 'Unknown client code.' });
  res.json({ ok: true, client: { id: client.id, name: client.name } });
});

// ================= CLIENT API =================
app.get('/api/client/me', clientAuth, (req, res) => {
  res.json({ id: req.client.id, name: req.client.name, email: req.client.email });
});

app.get('/api/client/products', clientAuth, (req, res) => {
  res.json(db.products.filter((p) => p.client_id === req.client.id));
});

// manually add a product (image can be a URL here, or uploaded right after)
app.post('/api/client/products', clientAuth, (req, res) => {
  const { name, sku, description, location, type, image } = req.body || {};
  if (!name || !String(name).trim()) return res.status(400).json({ error: 'Product name is required.' });
  const cleanSku = sku ? String(sku).trim() : null;
  if (cleanSku && productFor(req.client.id, { sku: cleanSku })) {
    return res.status(409).json({ error: `A product with SKU ${cleanSku} already exists.` });
  }
  const p = {
    id: db.uid(),
    client_id: req.client.id,
    sku: cleanSku,
    name: String(name).trim(),
    description: String(description || '').trim(),
    location: String(location || '').trim(),
    type: String(type || '').trim(),
    image: image ? String(image).trim() : null,
    image_source: image ? 'manual' : null,
    created_at: now(),
  };
  db.products.push(p);
  db.save();
  if (!p.image) backfillImages([p]);
  res.json(p);
});

// manually create an order from existing products
app.post('/api/client/orders', clientAuth, (req, res) => {
  const { order_number, ship_to, items } = req.body || {};
  if (!Array.isArray(items) || !items.length) return res.status(400).json({ error: 'Add at least one item.' });
  const lines = [];
  for (const it of items) {
    const p = db.products.find((x) => x.id === it.product_id && x.client_id === req.client.id);
    if (!p) return res.status(400).json({ error: 'Unknown product in order.' });
    const q = Math.max(1, parseInt(it.quantity, 10) || 1);
    lines.push({ sku: p.sku, name: p.name, quantity: q, product_id: p.id });
  }
  let num = String(order_number || '').trim();
  if (!num) num = `M-${Date.now().toString(36).toUpperCase()}`;
  if (db.orders.some((o) => o.client_id === req.client.id && o.order_number === num)) {
    return res.status(409).json({ error: `Order ${num} already exists.` });
  }
  const order = {
    id: db.uid(),
    client_id: req.client.id,
    order_number: num,
    status: 'new',
    ship_to: String(ship_to || '').trim(),
    items: lines,
    label: null,
    created_at: now(),
    printed_at: null,
  };
  db.orders.push(order);
  db.save();
  res.json(serializeOrder(order));
});

app.get('/api/client/orders', clientAuth, (req, res) => {
  const orders = db.orders
    .filter((o) => o.client_id === req.client.id)
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
    .map((o) => serializeOrder(o));
  res.json(orders);
});

app.get('/api/client/notifications', clientAuth, (req, res) => {
  const notes = db.notifications
    .filter((n) => n.client_id === req.client.id)
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
  res.json(notes);
});
app.post('/api/client/notifications/read', clientAuth, (req, res) => {
  for (const n of db.notifications) if (n.client_id === req.client.id) n.read = true;
  db.save();
  res.json({ ok: true });
});

// Excel/CSV import -> products + orders
app.post('/api/client/import', clientAuth, memUpload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded.' });
  let parsed;
  try {
    parsed = parseWorkbook(req.file.buffer);
  } catch (e) {
    return res.status(400).json({ error: e.message });
  }

  const clientId = req.client.id;
  const createdProducts = [];
  let productCount = 0;
  const orderMap = new Map(); // key -> order (orders touched by this import)
  const lockedOrders = new Set(); // already printed/shipped: never rewritten by a re-import
  let ordersCreated = 0, ordersUpdated = 0;

  for (let i = 0; i < parsed.records.length; i++) {
    const rec = parsed.records[i];
    // upsert product
    let product = productFor(clientId, rec);
    if (!product) {
      product = {
        id: db.uid(),
        client_id: clientId,
        sku: rec.sku,
        name: rec.name,
        description: rec.description || '',
        location: rec.location || '',
        type: rec.type || '',
        image: null,
        image_source: null,
        created_at: now(),
      };
      db.products.push(product);
      createdProducts.push(product);
      productCount++;
    } else {
      if (rec.location && !product.location) product.location = rec.location;
      if (rec.description && !product.description) product.description = rec.description;
      if (rec.type && !product.type) product.type = rec.type;
    }

    if (!parsed.hasOrders) continue;

    const orderNumber = rec.order || `IMP-${new Date().toISOString().slice(0, 10)}-${i + 1}`;
    const key = orderNumber;
    if (lockedOrders.has(key)) continue;
    let order = orderMap.get(key);
    if (!order) {
      order = db.orders.find((o) => o.client_id === clientId && o.order_number === orderNumber);
      if (!order) {
        order = {
          id: db.uid(),
          client_id: clientId,
          order_number: orderNumber,
          status: 'new',
          ship_to: rec.shipto || '',
          items: [],
          label: null,
          created_at: now(),
          printed_at: null,
        };
        db.orders.push(order);
        ordersCreated++;
      } else if (order.status === 'printed' || order.status === 'shipped') {
        // The sheet is the source of truth only until the order has been printed.
        lockedOrders.add(key);
        continue;
      } else {
        // Re-import: rebuild this order's lines from the sheet instead of appending duplicates.
        order.items = [];
        ordersUpdated++;
      }
      orderMap.set(key, order);
    }
    if (rec.shipto && !order.ship_to) order.ship_to = rec.shipto;
    order.items.push({ sku: rec.sku, name: rec.name, quantity: rec.qty, product_id: product.id });
  }

  db.save();
  // background image enrichment (do not block response)
  backfillImages(createdProducts);

  res.json({
    ok: true,
    mapping: parsed.mapping,
    products_added: productCount,
    orders_added: ordersCreated,
    orders_updated: ordersUpdated,
    orders_skipped: lockedOrders.size,
    catalog_only: !parsed.hasOrders,
    rows: parsed.rowCount,
  });
});

// product edits (client can set/correct image, location, description)
app.patch('/api/client/products/:id', clientAuth, (req, res) => {
  const p = db.products.find((x) => x.id === req.params.id && x.client_id === req.client.id);
  if (!p) return res.status(404).json({ error: 'Product not found.' });
  for (const k of ['image', 'location', 'description', 'name', 'type']) {
    if (typeof req.body[k] === 'string') p[k] = req.body[k];
  }
  if (req.body.image) p.image_source = 'manual';
  db.save();
  res.json(p);
});

app.post('/api/client/products/:id/image', clientAuth, productImgUpload.single('image'), (req, res) => {
  const p = db.products.find((x) => x.id === req.params.id && x.client_id === req.client.id);
  if (!p) return res.status(404).json({ error: 'Product not found.' });
  if (!req.file) return res.status(400).json({ error: 'No image uploaded.' });
  p.image = `/files/products/${req.file.filename}`;
  p.image_source = 'upload';
  db.save();
  res.json(p);
});

// suggest images from the web for manual selection
app.get('/api/client/products/:id/find-image', clientAuth, async (req, res) => {
  const p = db.products.find((x) => x.id === req.params.id && x.client_id === req.client.id);
  if (!p) return res.status(404).json({ error: 'Product not found.' });
  const { query, results } = await findImages(req.query.q || p.name, { limit: 8 });
  res.json({ query, results });
});

// upload shipping label for an order
app.post('/api/client/orders/:id/label', clientAuth, labelUpload.single('label'), (req, res) => {
  const o = db.orders.find((x) => x.id === req.params.id && x.client_id === req.client.id);
  if (!o) return res.status(404).json({ error: 'Order not found.' });
  if (!req.file) return res.status(400).json({ error: 'No label uploaded.' });
  o.label = { filename: req.file.filename, mime: req.file.mimetype, original: req.file.originalname };
  if (o.status === 'new') o.status = 'label_ready';
  db.save();
  res.json(serializeOrder(o));
});

// ================= WAREHOUSE API =================
app.get('/api/wh/clients', warehouseAuth, (req, res) => {
  res.json(db.clients.map((c) => ({
    id: c.id, name: c.name, email: c.email, code: c.code,
    orders: db.orders.filter((o) => o.client_id === c.id).length,
  })));
});

app.post('/api/wh/clients', warehouseAuth, (req, res) => {
  const { name, email } = req.body || {};
  if (!name || !name.trim()) return res.status(400).json({ error: 'Client name is required.' });
  const code = genCode();
  const client = { id: db.uid(), name: name.trim(), email: (email || '').trim(), code, created_at: now() };
  db.clients.push(client);
  db.save();
  res.json(client);
});

// Queue with filters: status, date range (YYYY-MM-DD), item type; sort newest|oldest.
app.get('/api/wh/orders', warehouseAuth, (req, res) => {
  const { status, from, to, type, sort } = req.query;
  let orders = db.orders.slice();
  if (status && status !== 'all') orders = orders.filter((o) => o.status === status);
  // Compare on the server's local calendar day, matching the dates people see in the UI.
  if (from) orders = orders.filter((o) => localDay(o.created_at) >= from);
  if (to) orders = orders.filter((o) => localDay(o.created_at) <= to);
  if (type) {
    const t = String(type).toLowerCase();
    orders = orders.filter((o) => o.items.some((it) => {
      const p = db.products.find((x) => x.id === it.product_id);
      return p && (p.type || '').toLowerCase() === t;
    }));
  }
  const dir = sort === 'oldest' ? 1 : -1;
  orders.sort((a, b) => dir * a.created_at.localeCompare(b.created_at));
  res.json(orders.map((o) => serializeOrder(o, { includeClient: true })));
});

// distinct item types across all clients, for the warehouse filter
app.get('/api/wh/product-types', warehouseAuth, (_req, res) => {
  const types = [...new Set(db.products.map((p) => (p.type || '').trim()).filter(Boolean))];
  res.json(types.sort((a, b) => a.localeCompare(b)));
});

app.get('/api/wh/orders/:id', warehouseAuth, (req, res) => {
  const o = db.orders.find((x) => x.id === req.params.id);
  if (!o) return res.status(404).json({ error: 'Order not found.' });
  res.json(serializeOrder(o, { includeClient: true }));
});

// mark order printed + notify client
app.post('/api/wh/orders/:id/print', warehouseAuth, (req, res) => {
  const o = db.orders.find((x) => x.id === req.params.id);
  if (!o) return res.status(404).json({ error: 'Order not found.' });
  o.status = 'printed';
  o.printed_at = now();
  db.save();
  notifyClient(o.client_id, {
    orderId: o.id,
    type: 'printed',
    message: `Order ${o.order_number} has been printed and is being prepared to ship.`,
  });
  res.json(serializeOrder(o, { includeClient: true }));
});

app.patch('/api/wh/products/:id', warehouseAuth, (req, res) => {
  const p = db.products.find((x) => x.id === req.params.id);
  if (!p) return res.status(404).json({ error: 'Product not found.' });
  for (const k of ['image', 'location', 'description', 'type']) {
    if (typeof req.body[k] === 'string') p[k] = req.body[k];
  }
  db.save();
  res.json(p);
});

// ---------- label file streaming (query-param auth so it works in a print tab) ----------
function streamLabel(order, res) {
  if (!order || !order.label) { res.status(404).send('No label on file.'); return; }
  const full = join(UP_LABELS, order.label.filename);
  if (!existsSync(full)) { res.status(404).send('Label file missing.'); return; }
  res.setHeader('Content-Type', order.label.mime || 'application/octet-stream');
  res.setHeader('Content-Disposition', `inline; filename="${order.label.original || 'label'}"`);
  createReadStream(full).pipe(res);
}
app.get('/api/wh/orders/:id/label', warehouseAuth, (req, res) => {
  streamLabel(db.orders.find((x) => x.id === req.params.id), res);
});
app.get('/api/client/orders/:id/label', clientAuth, (req, res) => {
  streamLabel(db.orders.find((x) => x.id === req.params.id && x.client_id === req.client.id), res);
});

// ---------- misc ----------
function genCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = '';
  for (let i = 0; i < 6; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return db.clients.some((c) => c.code === s) ? genCode() : s;
}

app.get('/healthz', (_req, res) => res.json({ ok: true }));

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`\n  Garage 3PL running:  http://localhost:${PORT}`);
  console.log(`  Warehouse passcode:  ${db.settings.warehousePass}`);
  const demo = db.clients.find((c) => c.name === 'Demo Client');
  if (demo) console.log(`  Demo client code:    ${demo.code}`);
  console.log('');
  // Catch up on any products still missing a picture (non-blocking, best effort).
  backfillImages(db.products.filter((p) => !p.image));
});
