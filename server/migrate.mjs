import { createNeonDriver } from './neon.mjs';
import { migratePostgres } from './postgres-store.mjs';
try { await migratePostgres(createNeonDriver(process.env.DATABASE_URL)); console.log('Postgres schema is ready.'); }
catch { console.error('Migration failed. Check DATABASE_URL and Neon availability; credentials were not logged.'); process.exitCode = 1; }
