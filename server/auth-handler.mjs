import { HttpError } from './accounts.mjs';

export function json(res, status, value) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', Pragma: 'no-cache' });
  res.end(status === 204 ? undefined : JSON.stringify(value));
}
export function readBody(req, max = 16 * 1024) {
  if (!/^application\/json(?:\s*;|$)/i.test(req.headers['content-type'] || '')) throw new HttpError(415, 'Нужен запрос в формате JSON.');
  if (+req.headers['content-length'] > max) { req.resume(); throw new HttpError(413, 'Запрос слишком большой.'); }
  // Vercel may parse JSON before invoking a Node handler; native HTTP leaves a stream.
  let parsedBody;
  try { parsedBody = req.body; } catch { throw new HttpError(400, 'Не удалось прочитать запрос.'); }
  if (parsedBody !== undefined) {
    const encoded = JSON.stringify(parsedBody);
    if (Buffer.byteLength(encoded || '') > max) throw new HttpError(413, 'Запрос слишком большой.');
    return Promise.resolve(parsedBody);
  }
  return new Promise((resolveBody, reject) => {
    let size = 0, chunks = [], exceeded = false;
    req.on('data', chunk => {
      size += chunk.length;
      if (size > max) { chunks = []; exceeded = true; reject(new HttpError(413, 'Запрос слишком большой.')); }
      else if (!exceeded) chunks.push(chunk);
    });
    req.on('end', () => {
      if (exceeded) return;
      try { resolveBody(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
      catch { reject(new HttpError(400, 'Не удалось прочитать запрос.')); }
    });
    req.on('error', () => reject(new HttpError(400, 'Не удалось прочитать запрос.')));
    req.on('aborted', () => reject(new HttpError(400, 'Запрос прерван.')));
  });
}

export function createAuthHandler({ accounts, adminHandler, publicOrigin, loginLimit = 20, registrationLimit = 50, now = Date.now, clientAddress = req => req.socket?.remoteAddress || 'unknown' }) {
  const origin = new URL(publicOrigin).origin;
  const secure = origin.startsWith('https:');
  if (!secure && !['127.0.0.1', 'localhost', '[::1]'].includes(new URL(origin).hostname)) throw new Error('Non-local deployments require HTTPS.');
  const cookieName = secure ? '__Host-tkpst_session' : 'tkpst_session';
  const cookieOf = req => (req.headers.cookie || '').split(';').map(s => s.trim()).find(s => s.startsWith(cookieName + '='))?.slice(cookieName.length + 1);
  const setCookie = (res, token) => res.setHeader('Set-Cookie', `${cookieName}=${token || ''}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${token ? Math.floor(accounts.sessionTtl / 1000) : 0}${secure ? '; Secure' : ''}`);
  return async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'no-store');
    if (req.url.split('?')[0].startsWith('/api/admin/') && adminHandler) { await adminHandler(req, res); return; }
    try {
      if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); throw new HttpError(405, 'Для API нужен POST-запрос.'); }
      if (req.headers.origin !== origin || req.headers['sec-fetch-site'] === 'cross-site') throw new HttpError(403, 'Запрос с другого сайта запрещён.');
      const url = new URL(req.url, origin);
      const body = await readBody(req);
      const token = cookieOf(req);
      if (url.pathname === '/api/attendance') { json(res, 200, await accounts.attendance(token, body)); return; }
      if (url.pathname === '/api/auth/session') { json(res, 200, { user: await accounts.session(token) }); return; }
      if (['/api/account', '/api/grades'].includes(url.pathname)) {
        const user = await accounts.session(token);
        if (!user) throw new HttpError(401, 'Войдите в личный кабинет.');
        json(res, 200, url.pathname === '/api/account' ? { user } : { connected: false, subjects: [] }); return;
      }
      if (url.pathname === '/api/auth/register' || url.pathname === '/api/auth/login') {
        const action = url.pathname.endsWith('/register') ? 'register' : 'login';
        const rate = await accounts.consumeRateLimit(action + ':' + clientAddress(req), action === 'register' ? registrationLimit : loginLimit, action === 'register' ? 3600_000 : 900_000, now());
        if (!rate.allowed) { res.setHeader('Retry-After', String(rate.retryAfter)); throw new HttpError(429, 'Слишком много попыток. Попробуйте позже.'); }
        const result = await accounts[action](body, token); setCookie(res, result.token);
        json(res, action === 'register' ? 201 : 200, { user: result.user }); return;
      }
      if (url.pathname === '/api/auth/reset-password') {
        const time = now();
        const rate = await accounts.consumeRateLimit('reset:' + clientAddress(req), 10, 900_000, time);
        if (!rate.allowed) { res.setHeader('Retry-After', String(rate.retryAfter)); throw new HttpError(429, 'Слишком много попыток. Попробуйте позже.'); }
        json(res, 200, await accounts.resetPassword(body)); return;
      }
      if (url.pathname === '/api/auth/logout') { await accounts.logout(token); setCookie(res, null); json(res, 204); return; }
      throw new HttpError(404, 'Адрес API не найден.');
    } catch (error) {
      if (!res.writableEnded && !res.destroyed) json(res, error.status || 500, { error: error.status ? error.message : 'Ошибка сервера. Попробуйте позже.', ...(error.field ? { field: error.field } : {}) });
    }
  };
}
