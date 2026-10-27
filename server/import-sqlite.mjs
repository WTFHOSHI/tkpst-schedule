// One-time, insert-only migration. The local database and sessions are untouched.
import { DatabaseSync } from 'node:sqlite';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createNeonStore } from './neon.mjs';
const path = process.env.AUTH_DB_PATH || fileURLToPath(new URL('./.data/accounts.sqlite', import.meta.url));
if (!existsSync(path)) { console.error('Local SQLite database not found.'); process.exitCode = 1; }
else {
  const db = new DatabaseSync(path, { readOnly: true });
  const users = db.prepare('SELECT id, username, display_name, password_hash, created_at FROM users').all(); db.close();
  if (!process.argv.includes('--apply')) console.log(`Dry run: ${users.length} account(s) available. Pass --apply to copy; no records sent.`);
  else if (!users.length) console.log('No local accounts to copy.');
  else {
    try { await createNeonStore(process.env.DATABASE_URL).importUsers(users); console.log(`Copied ${users.length} account(s). Local data preserved; sessions were not copied.`); }
    catch { console.error('Account copy failed and was rolled back. No local records changed. Check destination collisions and connection.'); process.exitCode = 1; }
  }
}
