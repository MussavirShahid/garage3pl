// Sessions, sign-in protection and browser security headers.
//
// Sign-in creates a server-side session (table `sessions`) and hands the browser an HttpOnly
// cookie. Only a SHA-256 of the session token is stored, so the database never holds a usable
// token. Nothing secret lives in localStorage or in URLs any more.
import { createHash, randomBytes } from 'node:crypto';
import { db } from './db.js';
import { verifyPassword } from './passwords.js';

const COOKIE = 'zp_session';
const SESSION_DAYS = Math.max(1, Number(process.env.SESSION_DAYS) || 30);
const now = () => new Date().toISOString();
const hashToken = (t) => createHash('sha256').update(t).digest('hex');
const expiry = () => new Date(Date.now() + SESSION_DAYS * 864e5).toISOString();

export function parseCookies(req) {
  const out = {};
  const header = req.headers.cookie;
  if (!header) return out;
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    const k = part.slice(0, i).trim();
    if (k) out[k] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

// True when the browser reached us over HTTPS, directly or through the host's proxy.
export const isSecure = (req) => req.secure || req.get('x-forwarded-proto') === 'https';

function cookieHeader(value, maxAgeSec, secure) {
  return `${COOKIE}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSec}${secure ? '; Secure' : ''}`;
}

export function createSession(req, res, { kind, clientId = null }) {
  const token = randomBytes(32).toString('base64url');
  const t = now();
  db.run('INSERT INTO sessions (id, kind, client_id, created_at, expires_at, last_seen_at, ip, user_agent) VALUES (?,?,?,?,?,?,?,?)',
    hashToken(token), kind, clientId, t, expiry(), t, String(req.ip || '').slice(0, 64), String(req.get('user-agent') || '').slice(0, 200));
  res.setHeader('Set-Cookie', cookieHeader(token, SESSION_DAYS * 86400, isSecure(req)));
}

export function destroySession(req, res) {
  const token = parseCookies(req)[COOKIE];
  if (token) db.run('DELETE FROM sessions WHERE id = ?', hashToken(token));
  res.setHeader('Set-Cookie', cookieHeader('', 0, isSecure(req)));
}

// Sign every other warehouse device out (used after a passcode change).
export function destroyOtherWarehouseSessions(req) {
  const token = parseCookies(req)[COOKIE];
  db.run('DELETE FROM sessions WHERE kind = ? AND id <> ?', 'warehouse', token ? hashToken(token) : '');
}

function loadSession(req) {
  const token = parseCookies(req)[COOKIE];
  if (!token) return null;
  const s = db.get('SELECT * FROM sessions WHERE id = ? AND expires_at > ?', hashToken(token), now());
  if (!s) return null;
  // Sliding expiry, refreshed at most every 10 minutes to keep writes rare.
  if (Date.now() - Date.parse(s.last_seen_at) > 10 * 60 * 1000) {
    db.run('UPDATE sessions SET last_seen_at = ?, expires_at = ? WHERE id = ?', now(), expiry(), s.id);
  }
  return s;
}

export function requireClient(req, res, next) {
  const s = loadSession(req);
  const c = s && s.kind === 'client' ? db.get('SELECT id, name, email, code FROM clients WHERE id = ?', s.client_id) : null;
  if (!c) return res.status(401).json({ error: 'Please sign in.' });
  req.client = c;
  next();
}

export function requireWarehouse(req, res, next) {
  const s = loadSession(req);
  if (!s || s.kind !== 'warehouse') return res.status(401).json({ error: 'Please sign in.' });
  next();
}

export function pruneSessions() {
  db.run('DELETE FROM sessions WHERE expires_at < ?', now());
}

export function verifyWarehousePass(passcode) {
  return verifyPassword(passcode, db.setting('warehouse_pass_hash'));
}

// ---------- sign-in rate limiting (per IP, in memory) ----------
const WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILURES = 20;
const failures = new Map();
export function loginLimiter(req, res, next) {
  const ip = req.ip || 'unknown';
  const t = Date.now();
  let f = failures.get(ip);
  if (!f || f.resetAt < t) { f = { count: 0, resetAt: t + WINDOW_MS }; failures.set(ip, f); }
  if (f.count >= MAX_FAILURES) {
    res.setHeader('Retry-After', String(Math.ceil((f.resetAt - t) / 1000)));
    return res.status(429).json({ error: 'Too many sign-in attempts. Try again in a few minutes.' });
  }
  req.loginFailed = () => { f.count++; };
  req.loginSucceeded = () => { failures.delete(ip); };
  next();
}
setInterval(() => { const t = Date.now(); for (const [k, f] of failures) if (f.resetAt < t) failures.delete(k); }, WINDOW_MS).unref();

// ---------- browser security headers ----------
// Scripts only from this origin (no inline scripts or handlers), styles from this origin and
// Google Fonts, product pictures from anywhere over https, frames never.
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com",
  "img-src 'self' data: https: http:",
  "connect-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
].join('; ');
export function securityHeaders(req, res, next) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  res.setHeader('Content-Security-Policy', CSP);
  if (isSecure(req)) res.setHeader('Strict-Transport-Security', 'max-age=15552000');
  next();
}

// CSRF defence in depth: SameSite=Lax cookies already block cross-site POSTs in modern browsers;
// on top of that, every state-changing API call must carry a header that a cross-site form cannot set.
export function requireFetchHeader(req, res, next) {
  if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') return next();
  if (req.get('x-requested-with') !== 'fetch') return res.status(403).json({ error: 'Request blocked.' });
  next();
}
