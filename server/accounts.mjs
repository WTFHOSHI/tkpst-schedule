import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { hashPassword, verifyPassword } from './password.mjs';
import { directoryStudent } from './directory-store.mjs';

export class HttpError extends Error {
  constructor(status, message, field) { super(message); this.status = status; this.field = field; }
}
const tokenHash = token => createHash('sha256').update(token).digest('hex');
const publicUser = (row, student = null) => row ? { id: row.id, username: row.username, displayName: row.display_name, verifiedStudent: !!student, ...(student ? { student } : {}) } : null;
const usernameOf = value => typeof value === 'string' ? value.trim().toLowerCase() : '';
function objectBody(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new HttpError(400, 'Проверьте заполнение формы.');
}

export async function createAccounts({ dbPath, store, now = Date.now, sessionTtl = 7 * 24 * 60 * 60 * 1000 }) {
  const persistence = store || (await import('./sqlite-store.mjs')).createSQLiteStore(dbPath);
  const dummyHash = await hashPassword(randomBytes(32).toString('base64url'));
  let hashing = 0;
  async function boundedHash(fn) {
    if (hashing >= 4) throw new HttpError(429, 'Сервер занят. Повторите попытку чуть позже.');
    hashing++;
    try { return await fn(); } finally { hashing--; }
  }
  function newSession(userId) {
    const token = randomBytes(32).toString('base64url');
    return { token, session: { tokenHash: tokenHash(token), userId, expiresAt: now() + sessionTtl } };
  }
  return {
    sessionTtl,
    async register(body, previousToken) {
      objectBody(body);
      const username = usernameOf(body.username);
      const displayName = typeof body.displayName === 'string' ? body.displayName.trim() : '';
      if (!/^[a-z0-9][a-z0-9_.-]{2,31}$/.test(username)) throw new HttpError(400, 'Логин: 3–32 символа, латинские буквы, цифры, точка, дефис или подчёркивание.', 'username');
      if (displayName.length < 2 || displayName.length > 80 || /[\u0000-\u001f\u007f]/.test(displayName)) throw new HttpError(400, 'Укажите имя длиной от 2 до 80 символов.', 'displayName');
      if (typeof body.password !== 'string' || body.password.length < 12 || body.password.length > 128) throw new HttpError(400, 'Пароль должен содержать от 12 до 128 символов.', 'password');
      const hash = await boundedHash(() => hashPassword(body.password));
      const id = randomUUID();
      const row = { id, username, display_name: displayName, password_hash: hash, created_at: now() };
      const { token, session } = newSession(id);
      try {
        await persistence.createUserWithSession(row, session, previousToken ? tokenHash(previousToken) : null, now());
        return { user: publicUser(row), token };
      } catch (error) {
        if (error.errcode === 2067 || error.code === 'SQLITE_CONSTRAINT_UNIQUE' || (error.code === '23505' && error.constraint === 'users_username_key')) throw new HttpError(409, 'Этот логин уже занят. Выберите другой.', 'username');
        throw error;
      }
    },
    async login(body, previousToken) {
      objectBody(body);
      const username = usernameOf(body.username);
      if (!username || username.length > 32 || typeof body.password !== 'string' || !body.password || body.password.length > 128) throw new HttpError(400, 'Введите логин и пароль.');
      const row = await persistence.findUser(username);
      const valid = await boundedHash(() => verifyPassword(body.password, row?.password_hash || dummyHash));
      if (!valid || !row) throw new HttpError(401, 'Неверный логин или пароль.');
      const { token, session } = newSession(row.id);
      await persistence.createSession(session, previousToken ? tokenHash(previousToken) : null, now());
      return { user: publicUser(row, directoryStudent(await persistence.directoryForUser(row.id), now())), token };
    },
    async session(token) {
      if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
      const row = await persistence.sessionUser(tokenHash(token), now());
      return publicUser(row, row ? directoryStudent(await persistence.directoryForUser(row.id), now()) : null);
    },
    async logout(token) { if (token) await persistence.deleteSession(tokenHash(token)); },
    consumeRateLimit: (key, limit, window, time = now()) => persistence.consumeRateLimit(tokenHash(key), limit, window, time),
    close() { return persistence.close(); },
  };
}
