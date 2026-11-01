// First-run setup: default warehouse passcode and a demo client.
import { db } from './db.js';

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
}
