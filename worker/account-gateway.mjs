// One public origin for the account UI and its private API. The browser never
// contacts the upstream account host directly or stores a session token.
const API_ORIGIN = 'https://tkpst-schedule.vercel.app';
const SCHEDULE_ORIGIN = 'https://api.thisishyum.ru';
const PUBLIC_ORIGIN = 'https://wtfhoshi.github.io';
const ACCOUNT_PATHS = new Set([
  '/api/auth/session', '/api/auth/login', '/api/auth/register', '/api/auth/logout',
  '/api/auth/reset-password', '/api/account', '/api/grades', '/api/attendance',
]);

// The admin panel on GitHub Pages reaches its API through this Worker as well:
// one always-on address instead of a sleeping standalone service. Authorization
// stays with the upstream (bearer tokens); the Worker only narrows what passes.
const ADMIN_ORIGIN = PUBLIC_ORIGIN;
const ADMIN_PATHS = new Set([
  '/api/admin/login', '/api/admin/users', '/api/admin/link', '/api/admin/logout', '/api/admin/sync',
  '/api/admin/sync/start', '/api/admin/delete-user', '/api/admin/attendance/login',
  '/api/admin/attendance/start', '/api/admin/attendance/sync', '/api/admin/attendance/logout',
]);
const ADMIN_LARGE = new Set(['/api/admin/sync', '/api/admin/attendance/sync']);

export async function adminApi(request, url) {
  const cors = { 'Access-Control-Allow-Origin': ADMIN_ORIGIN, Vary: 'Origin', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };
  const fail = (status, message) => Response.json({ error: message }, { status, headers: cors });
  if (request.headers.get('Origin') !== ADMIN_ORIGIN) return error(403, 'Этот сайт не имеет доступа к админке.');
  if (!ADMIN_PATHS.has(url.pathname) || url.search) return fail(404, 'Адрес API не найден.');
  if (request.method === 'OPTIONS') {
    if (request.headers.get('Access-Control-Request-Method') !== 'POST') return fail(405, 'Нужен POST-запрос.');
    const asked = (request.headers.get('Access-Control-Request-Headers') || '').toLowerCase().split(',').map(x => x.trim()).filter(Boolean);
    if (asked.some(x => !['authorization', 'content-type'].includes(x))) return fail(403, 'Заголовок запрещён.');
    return new Response(null, { status: 204, headers: { ...cors, 'Access-Control-Allow-Methods': 'POST', 'Access-Control-Allow-Headers': 'Authorization, Content-Type', 'Access-Control-Max-Age': '600' } });
  }
  if (request.method !== 'POST') return fail(405, 'Нужен POST-запрос.');
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get('Content-Type') || '')) return fail(415, 'Нужен запрос в формате JSON.');
  const body = await request.arrayBuffer();
  if (body.byteLength > (ADMIN_LARGE.has(url.pathname) ? 512 : 16) * 1024) return fail(413, 'Запрос слишком большой.');
  const headers = new Headers({ 'Content-Type': 'application/json', Origin: ADMIN_ORIGIN, Accept: 'application/json' });
  const authorization = request.headers.get('Authorization');
  if (authorization) {
    if (!/^Bearer [A-Za-z0-9_-]{43}$/.test(authorization)) return fail(401, 'Нужен вход в админ-панель.');
    headers.set('Authorization', authorization);
  }
  try {
    // Cookies are never forwarded: student sessions cannot authorize admin calls.
    const upstream = await fetch(API_ORIGIN + url.pathname, { method: 'POST', headers, body, redirect: 'manual', cache: 'no-store', signal: AbortSignal.timeout(25_000) });
    if (upstream.status >= 300 && upstream.status < 400) return fail(502, 'Сервис пользователей временно недоступен.');
    const out = new Headers(cors);
    for (const name of ['Content-Type', 'Retry-After']) { const value = upstream.headers.get(name); if (value) out.set(name, value); }
    return new Response(upstream.status === 204 ? null : upstream.body, { status: upstream.status, headers: out });
  } catch { return fail(503, 'Сервис пользователей временно недоступен.'); }
}

const error = (status, message) => Response.json({ error: message }, {
  status, headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' },
});

function schedulePath(url) {
  const path = url.pathname;
  if (path === '/schedule_api/tyumen/colleges/1/groups' || /^\/schedule_api\/tyumen\/groups\/\d{1,6}\/schedules\/last$/.test(path)) {
    return url.search ? null : path;
  }
  if (!/^\/schedule_api\/tyumen\/groups\/\d{1,6}\/schedules$/.test(path) || [...url.searchParams.keys()].join() !== 'date') return null;
  const date = url.searchParams.get('date');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '') || Number.isNaN(Date.parse(date + 'T12:00:00Z')) || new Date(date + 'T12:00:00Z').toISOString().slice(0, 10) !== date) return null;
  return path + '?date=' + date;
}

export async function publicSchedule(request, url) {
  const headers = { 'Access-Control-Allow-Origin': PUBLIC_ORIGIN, 'X-Content-Type-Options': 'nosniff' };
  const fail = (status) => Response.json({ error: 'Расписание временно недоступно.' }, { status, headers: { ...headers, 'Cache-Control': 'no-store' } });
  if (request.method !== 'GET') return fail(405);
  const path = schedulePath(url);
  if (!path) return fail(404);
  try {
    const upstream = await fetch(SCHEDULE_ORIGIN + path, {
      headers: new Headers({ Accept: 'application/json' }), redirect: 'manual', signal: AbortSignal.timeout(10_000),
      cf: { cacheTtlByStatus: { '200-299': 120, '400-599': 0 } },
    });
    if (!upstream.ok) return fail(502);
    const body = await upstream.text();
    if (body.length > 256 * 1024) return fail(502);
    JSON.parse(body);
    return new Response(body, { headers: { ...headers, 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'public, max-age=30' } });
  } catch { return fail(503); }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/health' && request.method === 'GET') {
      return Response.json({ status: 'ok' }, { headers: { 'Cache-Control': 'no-store' } });
    }
    if (url.pathname.startsWith('/schedule_api/')) return publicSchedule(request, url);
    if (!url.pathname.startsWith('/api/')) return env.ASSETS.fetch(request);
    if (url.pathname.startsWith('/api/admin/')) return adminApi(request, url);
    if (!ACCOUNT_PATHS.has(url.pathname)) return error(404, 'Адрес API не найден.');
    if (request.method !== 'POST') return error(405, 'Для API нужен POST-запрос.');
    if (request.headers.get('Origin') !== url.origin || request.headers.get('Sec-Fetch-Site') === 'cross-site') {
      return error(403, 'Запрос с другого сайта запрещён.');
    }
    if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get('Content-Type') || '')) {
      return error(415, 'Нужен запрос в формате JSON.');
    }
    const body = await request.arrayBuffer();
    if (body.byteLength > 16 * 1024) return error(413, 'Запрос слишком большой.');
    const headers = new Headers({ 'Content-Type': 'application/json', Origin: API_ORIGIN, Accept: 'application/json' });
    const cookie = request.headers.get('Cookie');
    if (cookie) headers.set('Cookie', cookie);
    try {
      const upstream = await fetch(API_ORIGIN + url.pathname + url.search, {
        method: 'POST', headers, body, redirect: 'manual', cache: 'no-store',
      });
      if (upstream.status >= 300 && upstream.status < 400) return error(502, 'Сервис входа временно недоступен.');
      const responseHeaders = new Headers(upstream.headers);
      responseHeaders.set('Cache-Control', 'no-store');
      responseHeaders.set('X-Content-Type-Options', 'nosniff');
      return new Response(upstream.body, { status: upstream.status, headers: responseHeaders });
    } catch { return error(503, 'Сервис входа временно недоступен.'); }
  },
};
