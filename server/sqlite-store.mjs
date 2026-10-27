import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { directorySchema, createDirectoryStore } from './directory-store.mjs';
import { attendanceSchema, createAttendanceStore } from './attendance-store.mjs';

export function createSQLiteStore(dbPath) {
  mkdirSync(dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  // SQLite's built-in lower() handles ASCII only; names in this directory are Russian.
  db.function('lower', { deterministic: true }, value => value === null ? null : String(value).toLowerCase());
  db.exec(`PRAGMA foreign_keys=ON; PRAGMA busy_timeout=3000;
    CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, username TEXT NOT NULL UNIQUE, display_name TEXT NOT NULL, password_hash TEXT NOT NULL, created_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS sessions (token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, expires_at INTEGER NOT NULL);
    CREATE INDEX IF NOT EXISTS sessions_expiry ON sessions(expires_at);
    CREATE TABLE IF NOT EXISTS auth_rate_limits (bucket TEXT PRIMARY KEY, count INTEGER NOT NULL, expires_at INTEGER NOT NULL);
    CREATE INDEX IF NOT EXISTS rate_expiry ON auth_rate_limits(expires_at);`);
  db.exec([...directorySchema, ...attendanceSchema].join(';') + ';');
  function directoryQuery(text, params) {
    const values = [];
    const sql = text.replace(/\$(\d+)/g, (_, n) => { values.push(params[Number(n) - 1]); return '?'; });
    return db.prepare(sql).all(...values);
  }
  function sessionStatements(session, previousHash, now) {
    db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(now);
    if (previousHash) db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(previousHash);
    db.prepare('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)').run(session.tokenHash, session.userId, session.expiresAt);
  }
  function transaction(fn) {
    db.exec('BEGIN IMMEDIATE');
    try { const result = fn(); db.exec('COMMIT'); return result; }
    catch (error) { db.exec('ROLLBACK'); throw error; }
  }
  return {
    ...createDirectoryStore({ query: directoryQuery, transaction: statements => transaction(() => statements.map(s => directoryQuery(s.text, s.params))) }),
    ...createAttendanceStore({ query: directoryQuery, transaction: statements => transaction(() => statements.map(s => directoryQuery(s.text, s.params))) }),
    findUser: username => db.prepare('SELECT * FROM users WHERE username = ?').get(username) || null,
    createUserWithSession: (user, session, previousHash, now) => transaction(() => {
      db.prepare('INSERT INTO users (id, username, display_name, password_hash, created_at) VALUES (?, ?, ?, ?, ?)').run(user.id, user.username, user.display_name, user.password_hash, user.created_at);
      sessionStatements(session, previousHash, now);
    }),
    createSession: (session, previousHash, now) => transaction(() => sessionStatements(session, previousHash, now)),
    sessionUser: (hash, now) => db.prepare('SELECT users.* FROM sessions JOIN users ON users.id = sessions.user_id WHERE sessions.token_hash = ? AND sessions.expires_at > ?').get(hash, now) || null,
    deleteSession: hash => db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(hash),
    consumeRateLimit: (bucket, limit, window, now) => transaction(() => {
      db.prepare('DELETE FROM auth_rate_limits WHERE expires_at <= ? AND bucket <> ?').run(now, bucket);
      const row = db.prepare(`INSERT INTO auth_rate_limits (bucket, count, expires_at) VALUES (?, 1, ?)
        ON CONFLICT(bucket) DO UPDATE SET count = CASE WHEN auth_rate_limits.expires_at <= ? THEN 1 ELSE MIN(auth_rate_limits.count + 1, ?) END,
        expires_at = CASE WHEN auth_rate_limits.expires_at <= ? THEN excluded.expires_at ELSE auth_rate_limits.expires_at END RETURNING count, expires_at`).get(bucket, now + window, now, limit + 1, now);
      return { allowed: row.count <= limit, retryAfter: Math.max(1, Math.ceil((row.expires_at - now) / 1000)) };
    }),
    close: () => db.close(),
  };
}
