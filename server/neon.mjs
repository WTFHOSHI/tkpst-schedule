import { neon } from '@neondatabase/serverless';
import { createPostgresStore } from './postgres-store.mjs';

export function createNeonDriver(connectionString) {
  if (!connectionString) throw new Error('DATABASE_URL is required.');
  const parsed = new URL(connectionString);
  if (!['postgres:', 'postgresql:'].includes(parsed.protocol) || !parsed.hostname.endsWith('.neon.tech')) throw new Error('DATABASE_URL must point to a Neon Postgres database.');
  const sql = neon(connectionString);
  return {
    query: (text, params = []) => sql.query(text, params, { fetchOptions: { signal: AbortSignal.timeout(10_000) } }),
    transaction: statements => sql.transaction(statements.map(s => sql.query(s.text, s.params)), { fetchOptions: { signal: AbortSignal.timeout(10_000) } }),
  };
}
export function createNeonStore(connectionString) { return createPostgresStore(createNeonDriver(connectionString)); }
