// First-run setup: the warehouse passcode (stored hashed) and a demo client.
import { db } from './db.js';
import { hashPassword, verifyPassword } from './passwords.js';

export function ensureSeed() {
  const out = { usingDefaultPasscode: false };
  // WAREHOUSE_PASSCODE always wins when set, so the passcode can be changed on any start.
  // Without it, the stored hash is kept; the very first start falls back to "warehouse".
  const envPass = process.env.WAREHOUSE_PASSCODE;
  const stored = db.setting('warehouse_pass_hash');
  if (envPass) {
    if (!stored || !verifyPassword(envPass, stored)) db.setSetting('warehouse_pass_hash', hashPassword(envPass));
  } else if (!stored) {
    db.setSetting('warehouse_pass_hash', hashPassword('warehouse'));
    out.usingDefaultPasscode = true;
  } else {
    out.usingDefaultPasscode = verifyPassword('warehouse', stored);
  }
  if (!db.get('SELECT 1 AS x FROM clients LIMIT 1')) {
    db.run('INSERT INTO clients (id, name, email, code, created_at) VALUES (?,?,?,?,?)', db.uid(), 'Demo Client', 'demo@example.com', 'DEMO01', new Date().toISOString());
  }
  return out;
}
