// Flexible Excel/CSV import. Maps varied column headers to a canonical schema,
// then groups line-item rows into orders. Pure parsing — no DB writes here.
import xlsx from 'xlsx';

// Synonyms per canonical field. Lowercase, trimmed, non-alphanumeric stripped to spaces.
const SYNONYMS = {
  order:    ['order', 'order number', 'order no', 'order num', 'order id', 'ordernumber', 'order ref', 'reference', 'po', 'po number'],
  sku:      ['sku', 'item', 'item number', 'item no', 'item code', 'product code', 'productcode', 'code', 'upc', 'barcode'],
  qty:      ['qty', 'quantity', 'units', 'count', 'amount', 'ordered qty', 'qty ordered'],
  location: ['location', 'bin', 'shelf', 'aisle', 'slot', 'spot', 'position'],
  shipto:   ['ship to', 'shipto', 'recipient', 'customer', 'customer name', 'buyer', 'destination', 'address', 'ship to name'],
  name:     ['product', 'product name', 'name', 'title', 'item name', 'product title'],
  description: ['description', 'desc', 'details', 'long description', 'product description'],
};

function norm(h) {
  return String(h ?? '').toLowerCase().trim().replace(/[^a-z0-9]+/g, ' ').trim();
}

// Build a map: canonical field -> column index. Each column used at most once.
function mapColumns(header) {
  const normed = header.map(norm);
  const used = new Set();
  const map = {};
  // Priority order avoids "description" stealing the "name" slot, etc.
  for (const field of ['order', 'sku', 'qty', 'location', 'shipto', 'description', 'name']) {
    for (const syn of SYNONYMS[field]) {
      const idx = normed.findIndex((h, i) => h === syn && !used.has(i));
      if (idx !== -1) { map[field] = idx; used.add(idx); break; }
    }
  }
  return map;
}

export function parseWorkbook(buffer) {
  const wb = xlsx.read(buffer, { type: 'buffer' });
  const sheetName = wb.SheetNames[0];
  if (!sheetName) throw new Error('The file has no sheets.');
  const sheet = wb.Sheets[sheetName];
  const rows = xlsx.utils.sheet_to_json(sheet, { header: 1, defval: '', raw: false });
  if (!rows.length) throw new Error('The sheet is empty.');

  const header = rows[0];
  const map = mapColumns(header);
  if (map.sku === undefined && map.name === undefined && map.description === undefined) {
    throw new Error('Could not find a product column. Include a header like "SKU", "Product", or "Description".');
  }

  const get = (row, field) => (map[field] === undefined ? '' : String(row[map[field]] ?? '').trim());

  const records = [];
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    if (!row || row.every((c) => String(c ?? '').trim() === '')) continue;
    const sku = get(row, 'sku');
    let name = get(row, 'name');
    const description = get(row, 'description');
    if (!name) name = description || sku;
    if (!sku && !name) continue;
    const qtyRaw = get(row, 'qty');
    const qty = qtyRaw ? Math.max(1, parseInt(qtyRaw.replace(/[^0-9-]/g, ''), 10) || 1) : 1;
    records.push({
      order: get(row, 'order'),
      sku: sku || null,
      name,
      description,
      qty,
      location: get(row, 'location'),
      shipto: get(row, 'shipto'),
    });
  }

  const detected = Object.fromEntries(
    Object.entries(map).map(([field, idx]) => [field, header[idx]])
  );
  const hasOrders = map.order !== undefined || map.shipto !== undefined;
  return { records, mapping: detected, hasOrders, rowCount: records.length };
}
