// One public origin for the account UI and its private API. The browser never
// contacts the upstream account host directly or stores a session token.
const API_ORIGIN = 'https://tkpst-schedule.vercel.app';
const ACCOUNT_PATHS = new Set([
  '/api/auth/session', '/api/auth/login', '/api/auth/register', '/api/auth/logout',
  '/api/account', '/api/grades', '/api/attendance',
]);

const error = (status, message) => Response.json({ error: message }, {
  status, headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' },
});

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/health' && request.method === 'GET') {
      return Response.json({ status: 'ok' }, { headers: { 'Cache-Control': 'no-store' } });
    }
    if (!url.pathname.startsWith('/api/')) return env.ASSETS.fetch(request);
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
