// Password hashing for the warehouse passcode: scrypt with a random salt, constant-time compare.
// Stored form: scrypt$N$r$p$<salt b64>$<key b64>
import { scryptSync, randomBytes, timingSafeEqual } from 'node:crypto';

const N = 16384, R = 8, P = 1, KEYLEN = 64;

export function hashPassword(password) {
  const salt = randomBytes(16);
  const key = scryptSync(String(password), salt, KEYLEN, { N, r: R, p: P });
  return `scrypt$${N}$${R}$${P}$${salt.toString('base64')}$${key.toString('base64')}`;
}

export function verifyPassword(password, stored) {
  try {
    const [alg, n, r, p, saltB64, keyB64] = String(stored || '').split('$');
    if (alg !== 'scrypt') return false;
    const salt = Buffer.from(saltB64, 'base64');
    const key = Buffer.from(keyB64, 'base64');
    const test = scryptSync(String(password), salt, key.length, { N: Number(n), r: Number(r), p: Number(p) });
    return test.length === key.length && timingSafeEqual(test, key);
  } catch {
    return false;
  }
}
