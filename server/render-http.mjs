import { createServer } from 'node:http';

export function createAdminApiServer({ handler, publicOrigin }) {
  const server = createServer(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store'); res.setHeader('X-Content-Type-Options', 'nosniff'); res.setHeader('Referrer-Policy', 'no-referrer');
    const json = (status, data) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(data)); };
    try {
      const path = new URL(req.url, publicOrigin).pathname;
      if (path === '/health' && ['GET', 'HEAD'].includes(req.method)) { json(200, { ok: true }); return; }
      if (!path.startsWith('/api/admin/')) { json(404, { error: 'Адрес API не найден.' }); return; }
      await handler(req, res);
    } catch { if (!res.writableEnded && !res.destroyed) json(503, { error: 'Сервис личных кабинетов временно недоступен.' }); }
  });
  server.requestTimeout = 70000; server.headersTimeout = 10000; server.keepAliveTimeout = 5000;
  return server;
}
