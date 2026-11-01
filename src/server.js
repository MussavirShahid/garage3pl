import express from 'express';
import multer from 'multer';
import { fileURLToPath } from 'node:url';
import { dirname, join, extname } from 'node:path';
import { existsSync, mkdirSync, createReadStream, unlinkSync } from 'node:fs';
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

// ---------- inventory ----------
// stock      = units physically on hand (goes up when inbound is received, down when an order is first printed)
// committed  = units promised to orders that are not printed yet
// available  = stock - committed: what a client may still create orders for
const stockOf = (p) => Math.max(0, parseInt(p?.stock, 10) || 0);
function committedFor(productId) {
  let n = 0;
  for (const o of db.orders) {
    if (o.status !== 'new' && o.status !== 'label_ready') continue;
    for (const it of o.items) if (it.product_id === productId) n += it.quantity;
  }
  return n;
}
const availableFor = (p) => stockOf(p) - committedFor(p.id);
function stockSummary(p) {
  const stock = stockOf(p), committed = committedFor(p.id);
  return { stock, committed, available: stock - committed };
}
function serializeInbound(r) {
  const p = db.products.find((x) => x.id === r.product_id);
  const c = db.clients.find((x) => x.id === r.client_id);
  return { ...r, product_name: p?.name || 'Deleted product', sku: p?.sku || '', image: p?.image || null, client_name: c?.name || 'Unknown' };
}
// Expected deliveries first (soonest expected date first), then received (latest first).
function inboundSort(a, b) {
  if (a.status !== b.status) return a.status === 'expected' ? -1 : 1;
  if (a.status === 'expected') return (a.expected_at || '9999').localeCompare(b.expected_at || '9999') || b.created_at.localeCompare(a.created_at);
  return (b.received_at || '').localeCompare(a.received_at || '');
}
function newInbound({ client_id, product_id, quantity, expected_at, tracking_id, created_by }) {
  const p = db.products.find((x) => x.id === product_id && x.client_id === client_id);
  if (!p) return { error: 'Choose a product that belongs to this client.' };
  const q = parseInt(quantity, 10);
  if (!Number.isInteger(q) || q < 1) return { error: 'Quantity must be a whole number of at least 1.' };
  const date = String(expected_at || '').trim();
  if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) return { error: 'Expected delivery date must be a calendar date.' };
  const r = {
    id: db.uid(), client_id, product_id, quantity: q, expected_at: date, tracking_id: String(tracking_id || '').trim(),
    status: 'expected', created_by, created_at: now(), received_at: null, received_quantity: null,
  };
  db.inbound.push(r);
  return { inbound: r };
}
// Mark an inbound delivery received: stock goes up by the quantity that actually arrived, client is told.
function receiveInbound(r, quantity) {
  const q = Number.isInteger(parseInt(quantity, 10)) && parseInt(quantity, 10) >= 1 ? parseInt(quantity, 10) : r.quantity;
  const p = db.products.find((x) => x.id === r.product_id);
  r.status = 'received'; r.received_at = now(); r.received_quantity = q;
  if (p) p.stock = stockOf(p) + q;
  db.save();
  notifyClient(r.client_id, {
    orderId: null,
    type: 'inventory_received',
    message: `Inventory received: ${q} × ${p ? p.name : 'product'}${r.tracking_id ? ` (tracking ${r.tracking_id})` : ''}. It is now available to order.`,
  });
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

// Remove an order's label file from disk (best effort).
function removeLabelFile(order) {
  if (!order || !order.label) return;
  const full = join(UP_LABELS, order.label.filename);
  try { if (existsSync(full)) unlinkSync(full); } catch { /* best effort */ }
}
// Remove an uploaded product photo from disk (external URLs are left alone).
function removeProductImage(product) {
  if (!product || !product.image || !product.image.startsWith('/files/products/')) return;
  const full = join(UP_PRODUCTS, product.image.replace('/files/products/', ''));
  try { if (existsSync(full)) unlinkSync(full); } catch { /* best effort */ }
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
  res.json(db.products.filter((p) => p.client_id === req.client.id).map((p) => ({ ...p, ...stockSummary(p) })));
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
    stock: 0,
    created_at: now(),
  };
  db.products.push(p);
  db.save();
  if (!p.image) backfillImages([p]);
  res.json({ ...p, ...stockSummary(p) });
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
  // Inventory rule: every product in the order must have that many units available
  // (on hand minus units already promised to other unprinted orders).
  const want = new Map();
  for (const l of lines) want.set(l.product_id, (want.get(l.product_id) || 0) + l.quantity);
  for (const [pid, qty] of want) {
    const p = db.products.find((x) => x.id === pid);
    const avail = availableFor(p);
    if (qty > avail) {
      return res.status(409).json({ error: avail > 0
        ? `Not enough inventory for "${p.name}": ${avail} available, ${qty} requested.`
        : `No available inventory for "${p.name}". Log it on the Inventory tab; once the warehouse receives it you can order it.` });
    }
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

// ---------- client inventory ----------
// Stock per product plus the client's incoming deliveries.
app.get('/api/client/inventory', clientAuth, (req, res) => {
  const products = db.products
    .filter((p) => p.client_id === req.client.id)
    .map((p) => ({ id: p.id, name: p.name, sku: p.sku, image: p.image, ...stockSummary(p) }))
    .sort((a, b) => a.name.localeCompare(b.name));
  const inbound = db.inbound.filter((r) => r.client_id === req.client.id).sort(inboundSort).map(serializeInbound);
  res.json({ products, inbound });
});
// Log a delivery that is on its way: product, quantity, expected date, tracking ID.
app.post('/api/client/inbound', clientAuth, (req, res) => {
  const { product_id, quantity, expected_at, tracking_id } = req.body || {};
  const r = newInbound({ client_id: req.client.id, product_id, quantity, expected_at, tracking_id, created_by: 'client' });
  if (r.error) return res.status(400).json({ error: r.error });
  db.save();
  res.json(serializeInbound(r.inbound));
});
// A client may cancel a delivery only while it is still expected.
app.delete('/api/client/inbound/:id', clientAuth, (req, res) => {
  const i = db.inbound.findIndex((r) => r.id === req.params.id && r.client_id === req.client.id);
  if (i === -1) return res.status(404).json({ error: 'Delivery not found.' });
  if (db.inbound[i].status !== 'expected') return res.status(409).json({ error: 'This delivery was already received; stock has been updated.' });
  db.inbound.splice(i, 1);
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
  const newOrderIds = new Set(); // orders created by this import
  const prevItems = new Map(); // order id -> lines before a re-import rebuilt them
  const linesSkipped = []; // lines refused because the product has too few available units
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
        stock: 0,
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
        newOrderIds.add(order.id);
        ordersCreated++;
      } else if (order.status === 'printed' || order.status === 'shipped') {
        // The sheet is the source of truth only until the order has been printed.
        lockedOrders.add(key);
        continue;
      } else {
        // Re-import: rebuild this order's lines from the sheet instead of appending duplicates.
        prevItems.set(order.id, order.items);
        order.items = [];
        ordersUpdated++;
      }
      orderMap.set(key, order);
    }
    if (rec.shipto && !order.ship_to) order.ship_to = rec.shipto;
    // Inventory rule, same as creating an order by hand: the line must fit within the
    // product's available units. Lines already accepted in this import sit in unprinted
    // orders, so they are counted; a re-imported order's old lines were cleared, so they are not.
    const avail = availableFor(product);
    if (rec.qty > avail) {
      linesSkipped.push({ order: orderNumber, sku: rec.sku || '', name: rec.name, qty: rec.qty, available: Math.max(0, avail) });
      continue;
    }
    order.items.push({ sku: rec.sku, name: rec.name, quantity: rec.qty, product_id: product.id });
  }

  // An order with no accepted lines is not saved empty: a new one is dropped, an
  // existing one keeps the lines it had before this import.
  let ordersWithoutStock = 0;
  for (const order of orderMap.values()) {
    if (order.items.length) continue;
    ordersWithoutStock++;
    if (newOrderIds.has(order.id)) {
      const idx = db.orders.indexOf(order);
      if (idx !== -1) db.orders.splice(idx, 1);
      ordersCreated--;
    } else {
      order.items = prevItems.get(order.id) || [];
      ordersUpdated--;
    }
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
    orders_without_stock: ordersWithoutStock,
    lines_skipped: linesSkipped,
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

// delete an order: allowed only until the warehouse has printed it
app.delete('/api/client/orders/:id', clientAuth, (req, res) => {
  const i = db.orders.findIndex((x) => x.id === req.params.id && x.client_id === req.client.id);
  if (i === -1) return res.status(404).json({ error: 'Order not found.' });
  const o = db.orders[i];
  if (o.status === 'printed' || o.status === 'shipped') {
    return res.status(409).json({ error: `Order ${o.order_number} has already been printed and can no longer be deleted. Contact the warehouse.` });
  }
  removeLabelFile(o);
  db.orders.splice(i, 1);
  db.save();
  res.json({ ok: true });
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

// delete a client and everything that belongs to them (orders, products, labels, photos, notifications)
app.delete('/api/wh/clients/:id', warehouseAuth, (req, res) => {
  const i = db.clients.findIndex((c) => c.id === req.params.id);
  if (i === -1) return res.status(404).json({ error: 'Client not found.' });
  const id = db.clients[i].id;
  const state = db._state();
  const gone = { orders: 0, products: 0 };
  for (const o of state.orders) if (o.client_id === id) { removeLabelFile(o); gone.orders++; }
  for (const p of state.products) if (p.client_id === id) { removeProductImage(p); gone.products++; }
  state.orders = state.orders.filter((o) => o.client_id !== id);
  state.products = state.products.filter((p) => p.client_id !== id);
  state.inbound = state.inbound.filter((r) => r.client_id !== id);
  state.notifications = state.notifications.filter((n) => n.client_id !== id);
  state.clients.splice(i, 1);
  db.save();
  res.json({ ok: true, removed: gone });
});

// Queue with filters: status, date range (YYYY-MM-DD), item type; sort newest|oldest.
app.get('/api/wh/orders', warehouseAuth, (req, res) => {
  const { status, from, to, type, sort, client } = req.query;
  let orders = db.orders.slice();
  if (status && status !== 'all') orders = orders.filter((o) => o.status === status);
  if (client) orders = orders.filter((o) => o.client_id === client);
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
  // First print takes the order's units out of stock. Reprints never deduct again,
  // and orders printed before inventory existed are left alone too.
  const firstPrint = o.status !== 'printed' && o.status !== 'shipped' && !o.stock_deducted;
  if (firstPrint) {
    for (const it of o.items) {
      const p = it.product_id ? db.products.find((x) => x.id === it.product_id) : null;
      if (p) p.stock = Math.max(0, stockOf(p) - it.quantity);
    }
    o.stock_deducted = true;
  }
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

// ---------- warehouse inventory ----------
// Every client's stock per product, plus all incoming deliveries.
app.get('/api/wh/inventory', warehouseAuth, (req, res) => {
  const { client, status } = req.query;
  const stock = db.products
    .filter((p) => !client || p.client_id === client)
    .map((p) => {
      const c = db.clients.find((x) => x.id === p.client_id);
      return { client_id: p.client_id, client_name: c?.name || 'Unknown', product_id: p.id, name: p.name, sku: p.sku, image: p.image, ...stockSummary(p) };
    })
    .sort((a, b) => a.client_name.localeCompare(b.client_name) || a.name.localeCompare(b.name));
  const inbound = db.inbound
    .filter((r) => (!client || r.client_id === client) && (!status || status === 'all' || r.status === status))
    .sort(inboundSort)
    .map(serializeInbound);
  res.json({ stock, inbound });
});
// Warehouse logs a delivery for a client; with received=true it goes straight into stock.
app.post('/api/wh/inbound', warehouseAuth, (req, res) => {
  const { client_id, product_id, quantity, expected_at, tracking_id, received } = req.body || {};
  if (!db.clients.some((c) => c.id === client_id)) return res.status(400).json({ error: 'Choose a client.' });
  const r = newInbound({ client_id, product_id, quantity, expected_at, tracking_id, created_by: 'warehouse' });
  if (r.error) return res.status(400).json({ error: r.error });
  if (received === true || received === 'true') receiveInbound(r.inbound, r.inbound.quantity);
  db.save();
  res.json(serializeInbound(r.inbound));
});
// Mark a delivery received. Optional quantity if what arrived differs from what was expected.
app.post('/api/wh/inbound/:id/receive', warehouseAuth, (req, res) => {
  const r = db.inbound.find((x) => x.id === req.params.id);
  if (!r) return res.status(404).json({ error: 'Delivery not found.' });
  if (r.status === 'received') return res.status(409).json({ error: 'Already received.' });
  receiveInbound(r, (req.body || {}).quantity);
  res.json(serializeInbound(r));
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

// ---------- printable label: the original file, exactly as the client uploaded it ----------
app.get('/api/wh/orders/:id/print-label', warehouseAuth, (req, res) => {
  streamLabel(db.orders.find((x) => x.id === req.params.id), res);
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
  console.log(`\n  Zip Packers running:  http://localhost:${PORT}`);
  console.log(`  Warehouse passcode:  ${db.settings.warehousePass}`);
  const demo = db.clients.find((c) => c.name === 'Demo Client');
  if (demo) console.log(`  Demo client code:    ${demo.code}`);
  console.log('');
  // Catch up on any products still missing a picture (non-blocking, best effort).
  backfillImages(db.products.filter((p) => !p.image));
});
