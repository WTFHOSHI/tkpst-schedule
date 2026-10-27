import { T, buildTimeline } from './core.js';

export const MIN_MONTH = '2000-01';
export const MAX_MONTH = '2100-12';
export const ATTENDANCE_STATUSES = Object.freeze({
  P: 'Был', N: 'Прогул', B: 'Болезнь', U: 'Уважительная', R: 'Работа', Z: 'Заявление',
});

export function validMonth(month) {
  return typeof month === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(month) && month >= MIN_MONTH && month <= MAX_MONTH;
}

export function currentMonth(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Yekaterinburg', year: 'numeric', month: '2-digit' }).formatToParts(now);
  return `${parts.find(p => p.type === 'year').value}-${parts.find(p => p.type === 'month').value}`;
}

export function shiftMonth(month, step) {
  if (!validMonth(month) || !Number.isInteger(step)) return month;
  const date = new Date(`${month}-01T12:00:00Z`);
  date.setUTCMonth(date.getUTCMonth() + step);
  const shifted = date.toISOString().slice(0, 7);
  return shifted < MIN_MONTH ? MIN_MONTH : shifted > MAX_MONTH ? MAX_MONTH : shifted;
}

export function monthLabel(month) {
  return validMonth(month) ? new Intl.DateTimeFormat('ru-RU', { month: 'long', year: 'numeric', timeZone: 'Asia/Yekaterinburg' }).format(new Date(`${month}-01T12:00:00Z`)) : '';
}

/** Names for a dated pair, using the same substitutions and Monday numbering as the timetable. */
export function subjectTitlesForDay(iso, lessons) {
  if (typeof iso !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(iso) || !Array.isArray(lessons)) return {};
  const day = T.parseIso(iso);
  if (!Number.isFinite(day) || T.iso(day) !== iso) return {};
  const titles = {};
  for (const entry of buildTimeline(T.weekday(day), lessons, iso)) {
    if (entry.type !== 'pair' || entry.cancelled) continue;
    const title = [...new Set(entry.lessons.map(lesson => String(lesson.title || '').trim()).filter(Boolean))].join(' / ');
    if (title) titles[`${iso}/${entry.number}`] = title;
  }
  return titles;
}

// Count only explicit, valid marks. An empty source cell says nothing about attendance.
export function attendanceModel(data, month) {
  const counts = { P: 0, N: 0, B: 0, U: 0, R: 0, Z: 0, marked: 0, attended: 0, missed: 0, unexcused: 0 };
  const records = new Map();
  if (data?.linked === true && validMonth(month)) {
    for (const record of Array.isArray(data.records) ? data.records : []) {
      if (!record || !Object.hasOwn(ATTENDANCE_STATUSES, record.status) || !Number.isInteger(record.pair) || record.pair < 1 || record.pair > 8) continue;
      if (typeof record.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(record.date) || !record.date.startsWith(month + '-')) continue;
      const date = new Date(record.date + 'T12:00:00Z');
      if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== record.date) continue;
      records.set(`${record.date}/${record.pair}`, { date: record.date, pair: record.pair, status: record.status });
    }
  }
  const days = [];
  for (const record of [...records.values()].sort((a, b) => b.date.localeCompare(a.date) || a.pair - b.pair)) {
    counts[record.status]++;
    if (days.at(-1)?.date !== record.date) days.push({ date: record.date, records: [] });
    days.at(-1).records.push(record);
  }
  counts.marked = records.size;
  counts.attended = counts.P;
  counts.missed = counts.N + counts.B + counts.U + counts.R + counts.Z;
  counts.unexcused = counts.N;
  const syncTime = typeof data?.syncedAt === 'number' ? data.syncedAt : typeof data?.syncedAt === 'string' ? Date.parse(data.syncedAt) : NaN;
  const syncedAt = Number.isFinite(syncTime) && Number.isFinite(new Date(syncTime).getTime()) ? new Date(syncTime).toISOString() : null;
  return { linked: data?.linked === true, month, syncedAt, counts, days };
}
