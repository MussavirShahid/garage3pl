// Tiny atomic JSON store. Single-process, fine for garage-scale volumes.
// Collections: clients, products, orders, notifications, settings.
import { readFileSync, writeFileSync, existsSync, mkdirSync, renameSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';

// Always next to the project, regardless of where the process was launched from.
const DATA_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'data');
const DB_FILE = join(DATA_DIR, 'store.json');

const EMPTY = { clients: [], products: [], orders: [], notifications: [], settings: {} };

let state;

function load() {
  if (existsSync(DB_FILE)) {
    try {
      state = JSON.parse(readFileSync(DB_FILE, 'utf8'));
    } catch {
      state = structuredClone(EMPTY);
    }
  } else {
    state = structuredClone(EMPTY);
  }
  for (const k of Object.keys(EMPTY)) {
    if (state[k] === undefined) state[k] = structuredClone(EMPTY[k]);
  }
}

let saveTimer = null;
function persistNow() {
  mkdirSync(DATA_DIR, { recursive: true });
  const tmp = DB_FILE + '.tmp';
  writeFileSync(tmp, JSON.stringify(state, null, 2));
  renameSync(tmp, DB_FILE);
}

// Debounced save for bursty writes; also exposes a synchronous flush.
function save() {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(persistNow, 40);
}

load();

export const db = {
  get clients() { return state.clients; },
  get products() { return state.products; },
  get orders() { return state.orders; },
  get notifications() { return state.notifications; },
  get settings() { return state.settings; },
  uid: () => randomUUID(),
  save,
  flush: persistNow,
  _state: () => state,
};
