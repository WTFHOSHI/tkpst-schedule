import { createHash, randomBytes, pbkdf2, createDecipheriv } from 'node:crypto';
import { promisify } from 'node:util';
import { HttpError } from './accounts.mjs';
import { directoryStudent } from './directory-store.mjs';
import { attendanceWeek, validateAttendance } from './attendance-store.mjs';

const derive = promisify(pbkdf2);
const hash = value => createHash('sha256').update(value).digest('hex');
const vaultURL = 'https://wtfhoshi.github.io/tkpst-admin/vault.json';
const ttl = 24 * 3600_000; // Same maximum lifetime as the existing admin-panel session.
const unauthorized = () => new HttpError(401, 'Нужен пароль администратора. Войдите заново.');
function decrypt(key, box, aad) {
  if (box?.v !== 1 || typeof box.iv !== 'string' || typeof box.ct !== 'string') throw new Error('Invalid encrypted object');
  const iv = Buffer.from(box.iv, 'base64'), ct = Buffer.from(box.ct, 'base64');
  if (iv.length !== 12 || ct.length < 17) throw new Error('Invalid cipher');
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAAD(Buffer.from(aad)); decipher.setAuthTag(ct.subarray(-16));
  return JSON.parse(Buffer.concat([decipher.update(ct.subarray(0, -16)), decipher.final()]).toString('utf8'));
}
async function boundedJson(fetchImpl, url, headers = {}) {
  const response = await fetchImpl(url, { headers, cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(10_000) });
  if (!response.ok) throw new Error('Source unavailable');
  const reader = response.body.getReader(); const chunks = []; let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read(); if (done) break;
      size += value.length; if (size > 2 * 1024 * 1024) { await reader.cancel(); throw new Error('Source too large'); }
      chunks.push(value);
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } finally { reader.releaseLock(); }
}
export function validateRoster(config) {
  const students = [], seen = new Set();
  const validDate = value => value === undefined || typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
  for (const course of ['1', '2', '3']) {
    const c = config?.courses?.[course];
    if (!c || !Array.isArray(c.students) || c.students.length > 500 || typeof c.groupName !== 'string' || c.groupName.length > 80) throw new Error('Invalid directory');
    for (const s of c.students) {
      if (!s || typeof s.id !== 'string' || !/^[A-Za-z0-9_-]{1,80}$/.test(s.id) || typeof s.name !== 'string' || s.name.trim().length < 2 || s.name.length > 120 || /[\u0000-\u001f\u007f]/.test(s.name) || !validDate(s.from) || !validDate(s.to) || seen.has(course + ':' + s.id)) throw new Error('Invalid student');
      seen.add(course + ':' + s.id);
      if (s.deleted === true) continue;
      students.push({ course, id: s.id, name: s.name.trim(), groupName: c.groupName, ...(s.from ? { from: s.from } : {}), ...(s.to ? { to: s.to } : {}) });
    }
  }
  return students;
}

export function createAdminService({ store, fetchImpl = fetch, now = Date.now }) {
  let deriving = 0;
  async function vault() {
    try {
      const value = await boundedJson(fetchImpl, vaultURL + '?t=' + now());
      if (value?.v !== 1 || value.kdf !== 'PBKDF2-SHA256' || !Number.isInteger(value.iter) || value.iter < 100000 || value.iter > 2000000 || Buffer.from(value.salt || '', 'base64').length !== 16 || !value.roles?.admin) throw new Error('Invalid vault');
      return { value, fingerprint: hash(JSON.stringify(value)) };
    } catch { throw new HttpError(502, 'Не удалось проверить сейф админки. Повторите позже.'); }
  }
  async function loginRole(body, attendanceOnly) {
    const role = attendanceOnly ? body?.role : 'admin';
    if (!['admin', 'kurator', 'starosta'].includes(role) || typeof body?.password !== 'string' || !body.password || body.password.length > 256) throw unauthorized();
    const current = await vault();
    if (deriving >= 4) throw new HttpError(429, 'Сервер занят. Повторите позже.');
    deriving++;
    try {
      const key = await derive(body.password, Buffer.from(current.value.salt, 'base64'), current.value.iter, 32, 'sha256');
      let secret;
      try { secret = decrypt(key, current.value.roles[role], 'vault:' + role); } finally { key.fill(0); }
      if (secret.role !== role || typeof secret.gh !== 'string' || typeof secret.dk !== 'string' || Buffer.from(secret.dk, 'base64').length !== 32) throw unauthorized();
    } catch { throw unauthorized(); }
    finally { deriving--; }
    const token = randomBytes(32).toString('base64url'), time = now(), expiresAt = time + ttl;
    if (attendanceOnly) await store.createAttendanceWriterSession(hash(token), current.fingerprint, role, expiresAt, time);
    else await store.createAdminSession(hash(token), current.fingerprint, expiresAt, time);
    return { token, expiresAt };
  }
  async function authorize(token, attendanceOnly = false) {
    if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(token)) throw unauthorized();
    const tokenHash = hash(token);
    const adminSession = await store.adminSession(tokenHash, now());
    const writer = !adminSession && attendanceOnly ? await store.attendanceWriterSession(tokenHash, now()) : null;
    const session = adminSession || writer;
    if (!session) throw unauthorized();
    if (session.vault_hash !== (await vault()).fingerprint) {
      if (writer) await store.deleteAttendanceWriterSession(tokenHash);
      else await store.deleteAdminSession(tokenHash);
      throw unauthorized();
    }
  }
  return {
    login: body => loginRole(body, false),
    loginAttendance: body => loginRole(body, true),
    authorize: token => authorize(token),
    authorizeAttendance: token => authorize(token, true),
    async beginAttendance(body, token) {
      const { course, monday } = attendanceWeek(body), ticket = randomBytes(32).toString('base64url');
      await store.reserveAttendanceTicket(hash(ticket), hash(token), course, monday, now());
      return { ticket };
    },
    async syncAttendance(body, token) {
      const scope = validateAttendance(body);
      if (typeof body?.ticket !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(body.ticket) || !await store.replaceAttendance(hash(body.ticket), hash(token), scope, now())) throw new HttpError(409, 'Обновление устарело. Повторите загрузку посещаемости.');
      return { ok: true, syncedAt: now() };
    },
    logoutAttendance: token => store.deleteAttendanceWriterSession(hash(token)),
    async users(body) {
      const search = typeof body?.search === 'string' ? body.search.trim() : '';
      const offset = body?.offset ?? 0;
      const status = body?.status ?? 'all';
      if (!['all', 'linked', 'pending'].includes(status)) throw new HttpError(400, 'Неизвестный фильтр аккаунтов.');
      if (search.length > 120 || !Number.isInteger(offset) || offset < 0 || offset > 1000000) throw new HttpError(400, 'Неверный поиск или страница.');
      const [result, snapshot] = await Promise.all([store.registeredUsers(search, offset, status, new Date(now()).toISOString().slice(0, 10)), store.directorySnapshot()]);
      return {
        users: result.users.map(row => ({ id: row.id, username: row.username, displayName: row.display_name, createdAt: Number(row.created_at), student: directoryStudent({ ...row, course: row.linked_course, student_id: row.linked_student_id }, now()), ...(row.linked_student_id ? { link: { course: row.linked_course, studentId: row.linked_student_id } } : {}) })),
        total: result.total, nextOffset: offset + result.users.length < result.total ? offset + result.users.length : null,
        students: snapshot.students.map(row => ({ id: row.student_id, course: row.course, displayName: row.name, groupName: row.group_name, active: !!directoryStudent(row, now()) })), syncedAt: snapshot.syncedAt,
      };
    },
    async beginSync(token) {
      const ticket = randomBytes(32).toString('base64url');
      await store.reserveSyncTicket(hash(ticket), hash(token), now());
      return { ticket };
    },
    async sync(body, token) {
      let students;
      try { students = validateRoster(body?.config); }
      catch { throw new HttpError(400, 'Не удалось проверить список студентов. Обновите данные в «Посещаемости» и повторите.'); }
      if (typeof body?.ticket !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(body.ticket)) throw new HttpError(409, 'Обновите список ещё раз.');
      const ticket = await store.consumeSyncTicket(hash(body.ticket), hash(token), now());
      if (!ticket) throw new HttpError(409, 'Обновление устарело. Повторите загрузку списка.');
      const startedAt = Number(ticket.started_at);
      if (!await store.replaceRoster(students, startedAt)) throw new HttpError(409, 'Уже загружен более новый список. Обновите страницу.');
      return { ok: true, studentsCount: students.length, syncedAt: startedAt };
    },
    async link(body) {
      if (typeof body?.userId !== 'string' || body.userId.length > 80 || (body.studentId !== null && (typeof body.studentId !== 'string' || body.studentId.length > 80 || !['1', '2', '3'].includes(body.course)))) throw new HttpError(400, 'Выберите аккаунт и студента.');
      try {
        if (!await store.linkStudent(body.userId, body.course || '', body.studentId, new Date(now()).toISOString().slice(0, 10))) throw new HttpError(400, 'Аккаунт или активный студент не найден. Обновите список.');
      } catch (error) {
        if (error.code === '23505' || error.errcode === 2067 || error.code === 'SQLITE_CONSTRAINT_UNIQUE') throw new HttpError(409, 'Этот студент уже связан с другим аккаунтом. Сначала снимите прежнюю привязку.');
        throw error;
      }
      return { ok: true };
    },
    async deleteUser(body) {
      if (typeof body?.userId !== 'string' || !body.userId || body.userId.length > 80 || typeof body.confirmUsername !== 'string' || !/^[a-z0-9][a-z0-9_.-]{2,31}$/.test(body.confirmUsername)) throw new HttpError(400, 'Введите точный логин аккаунта для подтверждения удаления.');
      if (!await store.deleteRegisteredUser(body.userId, body.confirmUsername)) throw new HttpError(404, 'Аккаунт не найден или логин для подтверждения не совпадает. Обновите список.');
      return { ok: true };
    },
    logout: token => store.deleteAdminSession(hash(token)),
  };
}
