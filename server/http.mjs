import { createServer } from 'node:http';
import { readFile, realpath, stat } from 'node:fs/promises';
import { resolve, relative, isAbsolute, sep, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createAccounts, HttpError } from './accounts.mjs';
import { createAuthHandler } from './auth-handler.mjs';
import { createSQLiteStore } from './sqlite-store.mjs';
import { createAdminService } from './admin-service.mjs';
import { createAdminHandler } from './admin-handler.mjs';

const webRoot = fileURLToPath(new URL('../web/', import.meta.url));
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };
const isOutside = path => { const rel = relative(webRoot, path); return rel === '..' || rel.startsWith('..' + sep) || isAbsolute(rel); };

export async function createAuthServer({ dbPath, store, publicOrigin = 'http://127.0.0.1:4173', loginLimit = 20, registrationLimit = 50, now = Date.now, sessionTtl, adminFetch } = {}) {
  const origin = new URL(publicOrigin).origin;
  const persistence = store || createSQLiteStore(dbPath);
  const accounts = await createAccounts({ store: persistence, now, sessionTtl });
  const clientAddress = req => req.socket?.remoteAddress || 'unknown';
  const admin = createAdminService({ store: persistence, fetchImpl: adminFetch, now });
  const adminHandler = createAdminHandler({ admin, accounts, publicOrigin, now, clientAddress });
  const authHandler = createAuthHandler({ accounts, adminHandler, publicOrigin, loginLimit, registrationLimit, now });

  const server = createServer(async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'same-origin');
    res.setHeader('X-Frame-Options', 'DENY');
    try {
      const url = new URL(req.url, origin);
      if (url.pathname.startsWith('/api/')) { await authHandler(req, res); return; }
      if (!['GET', 'HEAD'].includes(req.method)) throw new HttpError(405, 'Метод не поддерживается.');
      let pathname;
      try { pathname = decodeURIComponent(url.pathname); } catch { throw new HttpError(400, 'Неверный адрес.'); }
      if (pathname.includes('\0') || pathname.split(/[\\/]/).some(part => part.startsWith('.'))) throw new HttpError(403, 'Нет доступа.');
      const file = resolve(webRoot, '.' + (pathname === '/' ? '/index.html' : pathname));
      if (isOutside(file) || !mime[extname(file)]) throw new HttpError(404, 'Страница не найдена.');
      try {
        const actual = await realpath(file);
        if (isOutside(actual) || !(await stat(actual)).isFile()) throw new HttpError(403, 'Нет доступа.');
        const data = await readFile(actual);
        res.writeHead(200, { 'Content-Type': mime[extname(file)], 'Cache-Control': 'no-cache' });
        res.end(req.method === 'HEAD' ? undefined : data);
      } catch (error) {
        if (error.code === 'ENOENT' || error.code === 'ENOTDIR') throw new HttpError(404, 'Страница не найдена.');
        throw error;
      }
    } catch (error) {
      if (!res.writableEnded && !res.destroyed) { res.writeHead(error.status || 500, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify({ error: error.status ? error.message : 'Ошибка сервера. Попробуйте позже.' })); }
    }
  });
  server.requestTimeout = 15_000;
  server.headersTimeout = 10_000;
  server.keepAliveTimeout = 5_000;
  return { server, close: () => accounts.close() };
}
