// Write a consistent copy of the database to data/backups/ (keeps the newest 14).
//   npm run backup
// Copy the uploads/ folder alongside it for a complete backup.
import { db } from './db.js';

const out = db.backup();
console.log(`Backup written: ${out}`);
