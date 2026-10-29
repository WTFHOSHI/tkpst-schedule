import { directorySchema, createDirectoryStore } from './directory-store.mjs';
import { attendanceSchema, createAttendanceStore } from './attendance-store.mjs';
export const schemaStatements = [
  'CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, username TEXT NOT NULL UNIQUE, display_name TEXT NOT NULL, password_hash TEXT NOT NULL, created_at BIGINT NOT NULL)',
  'CREATE TABLE IF NOT EXISTS sessions (token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, expires_at BIGINT NOT NULL)',
  'CREATE INDEX IF NOT EXISTS sessions_expiry ON sessions(expires_at)',
  'CREATE TABLE IF NOT EXISTS auth_rate_limits (bucket TEXT PRIMARY KEY, count INTEGER NOT NULL, expires_at BIGINT NOT NULL)',
  'CREATE INDEX IF NOT EXISTS rate_expiry ON auth_rate_limits(expires_at)',
  ...directorySchema,
  ...attendanceSchema,
];
export async function migratePostgres(driver) {
  await driver.transaction(schemaStatements.map(text => ({ text, params: [] })));
}
const insertUser = user => ({ text: 'INSERT INTO users (id, username, display_name, password_hash, created_at) VALUES ($1, $2, $3, $4, $5)', params: [user.id, user.username, user.display_name, user.password_hash, user.created_at] });
function sessionStatements(session, previousHash, now) {
  const statements = [{ text: 'DELETE FROM sessions WHERE expires_at <= $1', params: [now] }];
  if (previousHash) statements.push({ text: 'DELETE FROM sessions WHERE token_hash = $1', params: [previousHash] });
  statements.push({ text: 'INSERT INTO sessions (token_hash, user_id, expires_at) VALUES ($1, $2, $3)', params: [session.tokenHash, session.userId, session.expiresAt] });
  return statements;
}
export function createPostgresStore(driver) {
  return {
    ...createDirectoryStore(driver),
    ...createAttendanceStore(driver),
    findUser: async username => (await driver.query('SELECT * FROM users WHERE username = $1', [username]))[0] || null,
    createUserWithSession: (user, session, previousHash, now) => driver.transaction([insertUser(user), ...sessionStatements(session, previousHash, now)]),
    createSession: (session, previousHash, now) => driver.transaction(sessionStatements(session, previousHash, now)),
    sessionUser: async (hash, now) => (await driver.query('SELECT users.* FROM sessions JOIN users ON users.id = sessions.user_id WHERE sessions.token_hash = $1 AND sessions.expires_at > $2', [hash, now]))[0] || null,
    deleteSession: hash => driver.query('DELETE FROM sessions WHERE token_hash = $1', [hash]),
    async consumeRateLimit(bucket, limit, window, now) {
      // Lock only the current bucket. Cross-bucket cleanup inside this statement
      // can deadlock with concurrent cold function instances.
      const [row] = await driver.query(`INSERT INTO auth_rate_limits (bucket, count, expires_at) VALUES ($1, 1, $2)
        ON CONFLICT(bucket) DO UPDATE SET count = CASE WHEN auth_rate_limits.expires_at <= $3 THEN 1 ELSE LEAST(auth_rate_limits.count + 1, $4) END,
        expires_at = CASE WHEN auth_rate_limits.expires_at <= $3 THEN excluded.expires_at ELSE auth_rate_limits.expires_at END RETURNING count, expires_at`, [bucket, now + window, now, limit + 1]);
      return { allowed: row.count <= limit, retryAfter: Math.max(1, Math.ceil((Number(row.expires_at) - now) / 1000)) };
    },
    importUsers: users => driver.transaction(users.map(insertUser)),
    close() {},
  };
}
