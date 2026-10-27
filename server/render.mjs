import { createAccounts } from './accounts.mjs';
import { createNeonStore } from './neon.mjs';
import { createAdminService } from './admin-service.mjs';
import { createAdminHandler } from './admin-handler.mjs';
import { createAdminApiServer } from './render-http.mjs';

const port = Number(process.env.PORT || 10000);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid PORT');
const originURL = new URL(process.env.RENDER_EXTERNAL_URL || process.env.PUBLIC_ORIGIN);
if (originURL.protocol !== 'https:' || originURL.username || originURL.password || originURL.pathname !== '/' || originURL.search || originURL.hash) throw new Error('HTTPS public origin required');
if (!process.env.DATABASE_URL) throw new Error('Database configuration required');
const publicOrigin = originURL.origin;
const store = createNeonStore(process.env.DATABASE_URL);
const accounts = await createAccounts({ store });
const admin = createAdminService({ store });
// Keep a conservative shared limit behind Render's proxy instead of trusting
// arbitrary forwarded headers. Administrator credentials are still required.
const handler = createAdminHandler({ accounts, admin, publicOrigin, clientAddress: () => 'render-admin' });
const server = createAdminApiServer({ handler, publicOrigin });
server.on('error', error => { console.error('API startup failed: ' + (error.code || 'unknown')); process.exitCode = 1; });
server.listen(port, '0.0.0.0', () => console.log('Admin API ready'));
for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => server.close(() => { accounts.close(); process.exit(0); }));
