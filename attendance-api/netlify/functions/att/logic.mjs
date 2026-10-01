// Чистая логика сервера посещаемости (без Netlify) — чтобы её можно было тестировать в Node.
import { createHmac, timingSafeEqual } from 'node:crypto';

/** P — был, N — нет (прогул), B — болеет, U — уважительная, R — работа, Z — по заявлению. */
export const CODES = ['P', 'N', 'B', 'U', 'R', 'Z'];
export const COURSES = ['1', '2', '3'];
export const ROLES = {
  admin: { title: 'Администратор', students: true, settings: true, import: true },
  kurator: { title: 'Куратор', students: true, settings: false, import: false },
  starosta: { title: 'Староста', students: true, settings: true, import: true },
};
const DAY = 864e5;

export const isIso = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(Date.parse(s + 'T00:00:00Z'));
export const addDays = (iso, n) => new Date(Date.parse(iso + 'T00:00:00Z') + n * DAY).toISOString().slice(0, 10);
export const mondayOf = (iso) => { const d = new Date(iso + 'T00:00:00Z').getUTCDay(); return addDays(iso, -((d + 6) % 7)); };
export const isMonday = (iso) => isIso(iso) && mondayOf(iso) === iso;

// ---------------- Вход ----------------

const b64u = (buf) => Buffer.from(buf).toString('base64url');

/** Какая роль у пароля (сравнение без утечки по времени). env: {admin, kurator, starosta} */
export function roleForPassword(password, env) {
  const p = Buffer.from(String(password || ''));
  let found = null;
  for (const role of Object.keys(ROLES)) {
    const want = env[role];
    if (!want) continue;
    const w = Buffer.from(String(want));
    if (w.length === p.length && timingSafeEqual(w, p)) found = role;
  }
  return found;
}

export function signToken(role, secret, now = Date.now(), days = 30) {
  const payload = b64u(JSON.stringify({ role, exp: now + days * DAY }));
  const sig = b64u(createHmac('sha256', secret).update(payload).digest());
  return `${payload}.${sig}`;
}

export function verifyToken(token, secret, now = Date.now()) {
  if (!token || !secret) return null;
  const [payload, sig] = String(token).split('.');
  if (!payload || !sig) return null;
  const want = Buffer.from(b64u(createHmac('sha256', secret).update(payload).digest()));
  const got = Buffer.from(sig);
  if (want.length !== got.length || !timingSafeEqual(want, got)) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString());
    if (!ROLES[data.role] || !(data.exp > now)) return null;
    return data;
  } catch { return null; }
}

// ---------------- Настройки и студенты ----------------

export function defaultConfig() {
  return {
    courses: {
      1: { groupId: null, groupName: '', students: [] },
      2: { groupId: 196, groupName: 'ИС-25-3С', students: [] },
      3: { groupId: null, groupName: '', students: [] },
    },
  };
}

export const cleanName = (s) => String(s || '').replace(/\s+/g, ' ').trim().toLocaleLowerCase('ru')
  .replace(/(^|[\s-])(\S)/g, (_, a, b) => a + b.toLocaleUpperCase('ru'));
export const nameKey = (s) => cleanName(s).toLocaleLowerCase('ru').replace(/ё/g, 'е');
const newId = () => 's' + Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-3);

export const sortStudents = (list) => list.sort((a, b) => a.name.localeCompare(b.name, 'ru'));

/** Изменить список студентов курса. Возвращает {ok, error?}. Меняет config на месте. */
export function studentOp(config, body) {
  const course = String(body.course);
  const c = config.courses[course];
  if (!c) return { ok: false, error: 'Нет такого курса' };
  const { action } = body;
  if (action === 'add') {
    const name = cleanName(body.name);
    if (name.length < 3 || name.length > 120) return { ok: false, error: 'Введи ФИО' };
    if (c.students.some((s) => nameKey(s.name) === nameKey(name) && !s.to)) return { ok: false, error: 'Такой студент уже есть' };
    const st = { id: newId(), name };
    if (isIso(body.from)) st.from = body.from;
    c.students.push(st);
    sortStudents(c.students);
    return { ok: true, student: st };
  }
  const s = c.students.find((x) => x.id === body.id);
  if (!s) return { ok: false, error: 'Студент не найден' };
  if (action === 'remove') {
    // Не удаляем: отмечаем, с какого дня студента нет в списке. Прошлые отметки остаются.
    s.to = isIso(body.to) ? body.to : addDays(new Date().toISOString().slice(0, 10), -1);
    return { ok: true, student: s };
  }
  if (action === 'restore') { delete s.to; return { ok: true, student: s }; }
  if (action === 'rename') {
    const name = cleanName(body.name);
    if (name.length < 3 || name.length > 120) return { ok: false, error: 'Введи ФИО' };
    s.name = name;
    sortStudents(c.students);
    return { ok: true, student: s };
  }
  return { ok: false, error: 'Неизвестное действие' };
}

export function courseOp(config, body) {
  const c = config.courses[String(body.course)];
  if (!c) return { ok: false, error: 'Нет такого курса' };
  const id = body.groupId == null || body.groupId === '' ? null : Number(body.groupId);
  if (id !== null && !(Number.isInteger(id) && id > 0)) return { ok: false, error: 'Неверная группа' };
  c.groupId = id;
  c.groupName = id ? String(body.groupName || '').slice(0, 40) : '';
  return { ok: true };
}

// ---------------- Отметки ----------------

export const emptyWeek = () => ({ m: {}, pairs: {}, hide: {}, at: '', by: '' });

/**
 * Применить изменения к неделе. changes: [{s: studentId, d: 'YYYY-MM-DD', p: 1..8, v: код | null}].
 * pairs: {iso: [пары, добавленные вручную]}, hide: {iso: [пары, убранные из дня]}. Возвращает {ok, error?}.
 */
export function applyMarks(week, monday, changes, pairs, hide) {
  week.pairs ||= {}; week.hide ||= {};
  if (!isMonday(monday)) return { ok: false, error: 'Неделя должна начинаться с понедельника' };
  const days = new Set([0, 1, 2, 3, 4, 5].map((i) => addDays(monday, i)));
  if (!Array.isArray(changes) || changes.length > 2000) return { ok: false, error: 'Неверные изменения' };
  for (const ch of changes) {
    if (!ch || typeof ch.s !== 'string' || ch.s.length > 40 || !days.has(ch.d)) return { ok: false, error: 'Неверная отметка' };
    const p = Number(ch.p);
    if (!(Number.isInteger(p) && p >= 1 && p <= 8)) return { ok: false, error: 'Неверный номер пары' };
    if (ch.v !== null && !CODES.includes(ch.v)) return { ok: false, error: 'Неизвестная отметка' };
  }
  for (const ch of changes) {
    const p = String(Number(ch.p));
    if (ch.v === null) {
      const day = week.m[ch.s] && week.m[ch.s][ch.d];
      if (day) {
        delete day[p];
        if (!Object.keys(day).length) delete week.m[ch.s][ch.d];
        if (!Object.keys(week.m[ch.s]).length) delete week.m[ch.s];
      }
    } else {
      ((week.m[ch.s] ||= {})[ch.d] ||= {})[p] = ch.v;
    }
  }
  for (const [field, val] of [['pairs', pairs], ['hide', hide]]) {
    if (!val || typeof val !== 'object') continue;
    for (const [d, list] of Object.entries(val)) {
      if (!days.has(d) || !Array.isArray(list)) continue;
      const nums = [...new Set(list.map(Number).filter((n) => Number.isInteger(n) && n >= 1 && n <= 8))].sort((a, b) => a - b);
      if (nums.length) week[field][d] = nums; else delete week[field][d];
    }
  }
  return { ok: true };
}

/**
 * Импорт старой таблицы. data: {weeks: {monday: {studentName: {iso: {pair: code}}}}}.
 * Недостающих студентов добавляет в курс. Возвращает {ok, weeks: {monday: changes[]}, added}.
 */
export function prepareImport(config, course, data) {
  const c = config.courses[String(course)];
  if (!c) return { ok: false, error: 'Нет такого курса' };
  if (!data || typeof data.weeks !== 'object') return { ok: false, error: 'Пустой импорт' };
  const byKey = new Map(c.students.map((s) => [nameKey(s.name), s]));
  const firstSeen = new Map();
  for (const monday of Object.keys(data.weeks).sort()) {
    for (const name of Object.keys(data.weeks[monday])) if (!firstSeen.has(nameKey(name))) firstSeen.set(nameKey(name), [name, monday]);
  }
  const mondays = Object.keys(data.weeks).sort();
  let added = 0;
  for (const [key, [name, monday]] of firstSeen) {
    if (byKey.has(key)) continue;
    const st = { id: newId(), name: cleanName(name) };
    if (monday !== mondays[0]) st.from = monday; // появился позже — до этого в списке не показываем
    c.students.push(st); byKey.set(key, st); added++;
  }
  sortStudents(c.students);
  const weeks = {};
  for (const monday of mondays) {
    if (!isMonday(monday)) return { ok: false, error: 'Неверная неделя ' + monday };
    const changes = [];
    for (const [name, days] of Object.entries(data.weeks[monday])) {
      const s = byKey.get(nameKey(name));
      for (const [d, pairs] of Object.entries(days || {})) {
        for (const [p, v] of Object.entries(pairs || {})) changes.push({ s: s.id, d, p: Number(p), v });
      }
    }
    weeks[monday] = changes;
  }
  return { ok: true, weeks, added };
}
