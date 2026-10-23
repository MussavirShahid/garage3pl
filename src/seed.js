// First-run setup: default warehouse passcode, a demo client, and a sample
// Excel file you can import to see the whole flow immediately.
import xlsx from 'xlsx';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync, mkdirSync } from 'node:fs';
import { db } from './db.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

export function ensureSeed() {
  let changed = false;
  // WAREHOUSE_PASSCODE always wins when set, so the passcode can be changed on
  // any start. Without it, the stored value is kept (default "warehouse").
  const envPass = process.env.WAREHOUSE_PASSCODE;
  if (envPass && db.settings.warehousePass !== envPass) {
    db.settings.warehousePass = envPass;
    changed = true;
  } else if (!db.settings.warehousePass) {
    db.settings.warehousePass = 'warehouse';
    changed = true;
  }
  if (db.clients.length === 0) {
    db.clients.push({
      id: db.uid(),
      name: 'Demo Client',
      email: 'demo@example.com',
      code: 'DEMO01',
      created_at: new Date().toISOString(),
    });
    changed = true;
  }
  if (changed) db.flush();
  writeSampleExcel();
}

function writeSampleExcel() {
  const out = join(ROOT, 'public', 'sample-orders.xlsx');
  if (existsSync(out)) return;
  mkdirSync(dirname(out), { recursive: true });
  const rows = [
    ['Order Number', 'SKU', 'Product Name', 'Description', 'Qty', 'Location', 'Ship To'],
    ['1001', 'MUG-BLU-12', 'Blue Ceramic Mug 12oz', 'Glossy blue ceramic coffee mug', 2, 'Shelf A2', 'Jane Doe, Austin TX'],
    ['1001', 'TEE-BLK-L', 'Black T-Shirt Large', '100% cotton crew neck tee, black', 1, 'Bin B1', 'Jane Doe, Austin TX'],
    ['1002', 'CAN-SOY-8', 'Soy Candle 8oz', 'Lavender scented soy wax candle', 3, 'Shelf A3', 'Mark Lee, Denver CO'],
    ['1003', 'MUG-BLU-12', 'Blue Ceramic Mug 12oz', 'Glossy blue ceramic coffee mug', 1, 'Shelf A2', 'Priya Shah, Seattle WA'],
    ['1003', 'NB-DOT-A5', 'Dot Grid Notebook A5', 'Hardcover dotted notebook, 160 pages', 2, 'Bin C4', 'Priya Shah, Seattle WA'],
  ];
  const ws = xlsx.utils.aoa_to_sheet(rows);
  const wb = xlsx.utils.book_new();
  xlsx.utils.book_append_sheet(wb, ws, 'Orders');
  xlsx.writeFile(wb, out);
}
