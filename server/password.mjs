import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const derive = promisify(scrypt);
// OWASP scrypt configuration: N=2^15, r=8, p=3 (32 MiB).
const options = { N: 32768, r: 8, p: 3, maxmem: 64 * 1024 * 1024 };
export async function hashPassword(password) {
  const salt = randomBytes(16).toString('base64url');
  const key = await derive(password, salt, 64, options);
  return `scrypt$32768$8$3$${salt}$${key.toString('base64url')}`;
}
export async function verifyPassword(password, stored) {
  const [scheme, n, r, p, salt, digest] = stored.split('$');
  if (scheme !== 'scrypt' || n !== '32768' || r !== '8' || p !== '3' || !salt || !digest) return false;
  const expected = Buffer.from(digest, 'base64url');
  const actual = await derive(password, salt, 64, options);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}
