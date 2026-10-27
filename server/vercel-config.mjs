import { isIP } from 'node:net';
import { HttpError } from './accounts.mjs';

export function allowedOrigin(req, env) {
  const allowed = new Set();
  if (env.PUBLIC_ORIGIN) {
    const parsed = new URL(env.PUBLIC_ORIGIN);
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.search || parsed.hash || parsed.pathname !== '/') throw new Error('Invalid public origin.');
    allowed.add(parsed.origin);
  }
  for (const value of [env.VERCEL_URL, env.VERCEL_BRANCH_URL, env.VERCEL_ENV === 'production' ? env.VERCEL_PROJECT_PRODUCTION_URL : null]) {
    if (value && /^[a-zA-Z0-9.-]+$/.test(value)) allowed.add('https://' + value);
  }
  const origin = req.headers.origin;
  if (origin === 'https://wtfhoshi.github.io' && req.url?.split('?')[0].startsWith('/api/admin/') && allowed.size) return allowed.values().next().value;
  if (typeof origin !== 'string' || !allowed.has(origin)) throw new HttpError(403, 'Запрос с другого сайта запрещён.');
  return origin;
}
export function vercelAddress(req) {
  // This function is used only inside the Vercel entry point. Vercel overwrites
  // these headers; the standalone server continues to use the socket address.
  const header = req.headers['x-vercel-forwarded-for'] || req.headers['x-forwarded-for'];
  const value = typeof header === 'string' ? header.split(',')[0].trim() : '';
  return isIP(value) ? value : 'unknown';
}
