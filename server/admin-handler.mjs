import { HttpError } from './accounts.mjs';
import { json, readBody } from './auth-handler.mjs';

export function createAdminHandler({ admin, accounts, publicOrigin, now = Date.now, clientAddress }) {
  const allowed = new Set([new URL(publicOrigin).origin, 'https://wtfhoshi.github.io']);
  return async (req, res) => {
    res.setHeader('Cache-Control', 'no-store'); res.setHeader('Vary', 'Origin');
    try {
      if (!allowed.has(req.headers.origin)) throw new HttpError(403, 'Этот сайт не имеет доступа к админке.');
      res.setHeader('Access-Control-Allow-Origin', req.headers.origin);
      if (req.method === 'OPTIONS') {
        if (req.headers['access-control-request-method'] !== 'POST') throw new HttpError(405, 'Нужен POST-запрос.');
        const headers = (req.headers['access-control-request-headers'] || '').toLowerCase().split(',').map(x => x.trim()).filter(Boolean);
        if (headers.some(x => !['authorization', 'content-type'].includes(x))) throw new HttpError(403, 'Заголовок запрещён.');
        res.setHeader('Access-Control-Allow-Methods', 'POST'); res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
        json(res, 204); return;
      }
      if (req.method !== 'POST') { res.setHeader('Allow', 'POST, OPTIONS'); throw new HttpError(405, 'Нужен POST-запрос.'); }
      const path = new URL(req.url, publicOrigin).pathname;
      const body = await readBody(req, path === '/api/admin/sync' ? 512 * 1024 : 16 * 1024);
      if (path === '/api/admin/login') {
        for (const [bucket, limit] of [['admin-login:' + clientAddress(req), 5], ['admin-login:global', 50]]) {
          const rate = await accounts.consumeRateLimit(bucket, limit, 900_000, now());
          if (!rate.allowed) { res.setHeader('Retry-After', String(rate.retryAfter)); throw new HttpError(429, 'Слишком много попыток. Попробуйте позже.'); }
        }
        json(res, 200, await admin.login(body)); return;
      }
      const token = /^Bearer ([A-Za-z0-9_-]{43})$/.exec(req.headers.authorization || '')?.[1];
      await admin.authorize(token);
      if (path === '/api/admin/sync/start') { json(res, 200, await admin.beginSync(token)); return; }
      if (path === '/api/admin/sync') { json(res, 200, await admin.sync(body, token)); return; }
      if (path === '/api/admin/users') { json(res, 200, await admin.users(body)); return; }
      if (path === '/api/admin/link') { json(res, 200, await admin.link(body)); return; }
      if (path === '/api/admin/logout') { await admin.logout(token); json(res, 204); return; }
      throw new HttpError(404, 'Адрес API не найден.');
    } catch (error) {
      if (!res.writableEnded && !res.destroyed) json(res, error.status || 500, { error: error.status ? error.message : 'Сервис пользователей временно недоступен.' });
    }
  };
}
