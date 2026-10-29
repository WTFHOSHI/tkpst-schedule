import { HttpError } from './accounts.mjs';

export const attendanceSchema = [
  'CREATE TABLE IF NOT EXISTS attendance_writer_sessions (token_hash TEXT PRIMARY KEY, vault_hash TEXT NOT NULL, role TEXT NOT NULL, expires_at BIGINT NOT NULL)',
  'CREATE INDEX IF NOT EXISTS attendance_writer_expiry ON attendance_writer_sessions(expires_at)',
  'CREATE TABLE IF NOT EXISTS attendance_sync_clock (id INTEGER PRIMARY KEY CHECK (id = 1), tick BIGINT NOT NULL)',
  'CREATE TABLE IF NOT EXISTS attendance_sync_tickets (ticket_hash TEXT PRIMARY KEY, token_hash TEXT NOT NULL, course TEXT NOT NULL, monday TEXT NOT NULL, tick BIGINT NOT NULL, expires_at BIGINT NOT NULL)',
  'CREATE INDEX IF NOT EXISTS attendance_ticket_expiry ON attendance_sync_tickets(expires_at)',
  'CREATE TABLE IF NOT EXISTS attendance_snapshots (course TEXT NOT NULL, monday TEXT NOT NULL, saturday TEXT NOT NULL, tick BIGINT NOT NULL, snapshot TEXT NOT NULL, synced_at BIGINT NOT NULL, PRIMARY KEY(course, monday))',
];
const codes = ['P', 'N', 'B', 'U', 'R', 'Z'];
const forbidden = new Set(['__proto__', 'constructor', 'prototype']);
const object = value => !!value && typeof value === 'object' && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const invalid = () => new HttpError(400, 'Не удалось проверить данные посещаемости.');
export function strictDate(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
}
const dayAfter = (date, days) => new Date(Date.parse(date) + days * 86400000).toISOString().slice(0, 10);
export function attendanceWeek(body) {
  if (!object(body) || !['1', '2', '3'].includes(body.course) || !strictDate(body.monday) || body.monday < '2000-01-01' || body.monday > '2100-12-31' || new Date(body.monday).getUTCDay() !== 1) throw invalid();
  return { course: body.course, monday: body.monday, saturday: dayAfter(body.monday, 5) };
}
export function validateAttendance(body) {
  const scope = attendanceWeek(body), week = body.week;
  // Weeks saved before pair hiding was introduced have no hide field.
  const hide = week?.hide === undefined ? {} : week.hide;
  if (!object(week) || Object.keys(week).some(key => !['m', 'pairs', 'hide', 'at', 'by'].includes(key)) || !object(week.m) || !object(week.pairs) || !object(hide) || typeof week.at !== 'string' || week.at.length > 40 || week.at && !Number.isFinite(Date.parse(week.at))) throw invalid();
  const validDay = date => strictDate(date) && date >= scope.monday && date <= scope.saturday;
  for (const map of [week.pairs, hide]) {
    if (Object.keys(map).length > 6) throw invalid();
    for (const [date, pairs] of Object.entries(map)) if (!validDay(date) || !Array.isArray(pairs) || pairs.length > 8 || pairs.some(pair => !Number.isInteger(pair) || pair < 1 || pair > 8) || new Set(pairs).size !== pairs.length) throw invalid();
  }
  if (Object.keys(week.m).length > 500) throw invalid();
  const snapshot = Object.create(null);
  for (const [student, days] of Object.entries(week.m)) {
    if (!/^[A-Za-z0-9_-]{1,80}$/.test(student) || forbidden.has(student) || !object(days) || Object.keys(days).length > 6) throw invalid();
    const records = [];
    for (const [date, pairs] of Object.entries(days)) {
      if (!validDay(date) || !object(pairs) || Object.keys(pairs).length > 8) throw invalid();
      for (const [pair, status] of Object.entries(pairs)) {
        if (!/^[1-8]$/.test(pair) || !codes.includes(status) && status !== '' && status !== null) throw invalid();
        if (status && !hide[date]?.includes(Number(pair))) records.push({ date, pair: Number(pair), status });
      }
    }
    if (records.length) snapshot[student] = records.sort((a, b) => a.date.localeCompare(b.date) || a.pair - b.pair);
  }
  return { ...scope, snapshot: JSON.stringify(snapshot) };
}
export function attendanceMonth(body, now) {
  if (!object(body) || Object.keys(body).some(key => key !== 'month')) throw invalid();
  const parts = body.month === undefined ? new Intl.DateTimeFormat('en', { timeZone: 'Asia/Yekaterinburg', year: 'numeric', month: '2-digit' }).formatToParts(new Date(now)) : null;
  const selected = parts ? `${parts.find(x => x.type === 'year').value}-${parts.find(x => x.type === 'month').value}` : body.month;
  if (typeof selected !== 'string' || !/^\d{4}-(0[1-9]|1[0-2])$/.test(selected) || selected < '2000-01' || selected > '2100-12') throw invalid();
  return { month: selected, start: selected + '-01', end: dayAfter(selected + '-01', 32).slice(0, 7) + '-01' };
}
export function attendanceProjection(rows, month, start, end) {
  const counts = { P: 0, N: 0, B: 0, U: 0, R: 0, Z: 0, marked: 0, attended: 0, missed: 0, unexcused: 0 };
  const records = []; let syncedAt = null;
  for (const row of rows) {
    if (row.synced_at === null) continue;
    syncedAt = Math.max(syncedAt ?? 0, Number(row.synced_at));
    const snapshot = JSON.parse(row.snapshot);
    for (const record of Object.hasOwn(snapshot, row.student_id) ? snapshot[row.student_id] : []) {
      if (record.date < start || record.date >= end || row.from_date && record.date < row.from_date || row.to_date && record.date > row.to_date) continue;
      records.push(record); counts[record.status]++; counts.marked++;
    }
  }
  records.sort((a, b) => a.date.localeCompare(b.date) || a.pair - b.pair);
  counts.attended = counts.P; counts.missed = counts.marked - counts.P; counts.unexcused = counts.N;
  return { linked: rows.length > 0, month, syncedAt, records, counts };
}
export function createAttendanceStore(driver) {
  return {
    createAttendanceWriterSession: (hash, vaultHash, role, expiresAt, now) => driver.transaction([
      { text: 'DELETE FROM attendance_writer_sessions WHERE expires_at > 0 AND expires_at <= $1', params: [now] },
      { text: 'INSERT INTO attendance_writer_sessions (token_hash, vault_hash, role, expires_at) VALUES ($1,$2,$3,$4)', params: [hash, vaultHash, role, expiresAt] },
    ]),
    attendanceWriterSession: async (hash, now) => (await driver.query('SELECT vault_hash, role FROM attendance_writer_sessions WHERE token_hash = $1 AND (expires_at = 0 OR expires_at > $2)', [hash, now]))[0] || null,
    deleteAttendanceWriterSession: hash => driver.transaction([
      { text: 'DELETE FROM attendance_writer_sessions WHERE token_hash = $1', params: [hash] },
      { text: 'DELETE FROM attendance_sync_tickets WHERE token_hash = $1', params: [hash] },
    ]),
    reserveAttendanceTicket: (ticketHash, tokenHash, course, monday, now) => driver.transaction([
      { text: 'DELETE FROM attendance_sync_tickets WHERE expires_at <= $1', params: [now] },
      { text: 'INSERT INTO attendance_sync_clock (id, tick) VALUES (1,$1) ON CONFLICT(id) DO UPDATE SET tick = CASE WHEN attendance_sync_clock.tick >= excluded.tick THEN attendance_sync_clock.tick + 1 ELSE excluded.tick END', params: [now] },
      { text: 'INSERT INTO attendance_sync_tickets (ticket_hash, token_hash, course, monday, tick, expires_at) SELECT $1,$2,$3,$4,tick,$5 FROM attendance_sync_clock WHERE id = 1', params: [ticketHash, tokenHash, course, monday, now + 300000] },
    ]),
    async replaceAttendance(ticketHash, tokenHash, scope, now) {
      const results = await driver.transaction([
        { text: `INSERT INTO attendance_snapshots (course, monday, saturday, tick, snapshot, synced_at)
          SELECT course, monday, $5, tick, $6, $7 FROM attendance_sync_tickets WHERE ticket_hash = $1 AND token_hash = $2 AND course = $3 AND monday = $4 AND expires_at > $7
          ON CONFLICT(course, monday) DO UPDATE SET saturday = excluded.saturday, tick = excluded.tick, snapshot = excluded.snapshot, synced_at = excluded.synced_at
          WHERE attendance_snapshots.tick < excluded.tick RETURNING tick`, params: [ticketHash, tokenHash, scope.course, scope.monday, scope.saturday, scope.snapshot, now] },
        { text: 'DELETE FROM attendance_sync_tickets WHERE ticket_hash = $1 AND token_hash = $2 AND course = $3 AND monday = $4', params: [ticketHash, tokenHash, scope.course, scope.monday] },
      ]);
      return results[0].length === 1;
    },
    attendanceForUser: (id, today, start, end) => driver.query(`SELECT r.student_id, r.from_date, r.to_date, a.snapshot, a.synced_at
      FROM user_student_links l JOIN student_roster r ON r.course = l.course AND r.student_id = l.student_id
      LEFT JOIN attendance_snapshots a ON a.course = r.course AND a.monday < $4 AND a.saturday >= $3
      WHERE l.user_id = $1 AND (r.from_date IS NULL OR r.from_date <= $2) AND (r.to_date IS NULL OR r.to_date >= $2)`, [id, today, start, end]),
  };
}
