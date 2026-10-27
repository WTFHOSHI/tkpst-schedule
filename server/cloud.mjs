import { createAccounts } from './accounts.mjs';
import { createAuthHandler } from './auth-handler.mjs';
import { createNeonStore } from './neon.mjs';
import { allowedOrigin, vercelAddress } from './vercel-config.mjs';
import { createAdminService } from './admin-service.mjs';
import { createAdminHandler } from './admin-handler.mjs';

export function createCloudHandler({ env = process.env } = {}) {
  let pending;
  return async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    try {
      if (req.method !== 'POST' && !(req.method === 'OPTIONS' && req.url.split('?')[0].startsWith('/api/admin/'))) { res.setHeader('Allow', 'POST'); res.writeHead(405, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Для API нужен POST-запрос.' })); return; }
      const publicOrigin = allowedOrigin(req, env);
      if (!env.DATABASE_URL) throw new Error('Missing database configuration.');
      if (!pending) pending = (async () => {
        const store = createNeonStore(env.DATABASE_URL);
        return { accounts: await createAccounts({ store }), admin: createAdminService({ store }) };
      })().catch(error => { pending = undefined; throw error; });
      const { accounts, admin } = await pending;
      const adminHandler = createAdminHandler({ admin, accounts, publicOrigin, clientAddress: vercelAddress });
      await createAuthHandler({ accounts, adminHandler, publicOrigin, clientAddress: vercelAddress })(req, res);
    } catch (error) {
      if (!res.writableEnded && !res.destroyed) {
        res.writeHead(error.status || 503, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ error: error.status ? error.message : 'Сервис входа временно недоступен. Попробуйте позже.' }));
      }
    }
  };
}
