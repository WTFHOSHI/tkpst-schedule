import { fileURLToPath } from 'node:url';
import { createAuthServer } from './http.mjs';

const port = Number(process.env.PORT || 4173);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be between 1 and 65535.');
const host = process.env.HOST || '127.0.0.1';
const publicOrigin = process.env.PUBLIC_ORIGIN || `http://127.0.0.1:${port}`;
if (!['127.0.0.1', 'localhost', '::1'].includes(host) && !publicOrigin.startsWith('https://')) throw new Error('Public hosting requires PUBLIC_ORIGIN=https://your-domain.');
const dbPath = process.env.AUTH_DB_PATH || fileURLToPath(new URL('./.data/accounts.sqlite', import.meta.url));
const store = process.env.DATABASE_URL ? (await import('./neon.mjs')).createNeonStore(process.env.DATABASE_URL) : undefined;
const app = await createAuthServer({ dbPath, store, publicOrigin });
app.server.on('error', error => { console.error(`Server could not start: ${error.code || 'unknown error'}`); app.close(); process.exitCode = 1; });
app.server.listen(port, host, () => console.log(`TKPST running at ${publicOrigin}`));
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => app.server.close(() => { app.close(); process.exit(0); }));
