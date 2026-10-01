// Посещаемость: даты, итоги, выгрузка в Excel и чтение старой таблицы (на выдуманных данных).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as A from '../admin/att-core.js';

test('недели и месяцы', () => {
  assert.equal(A.mondayOf('2026-10-02'), '2026-09-28');
  assert.equal(A.mondayOf('2026-10-04'), '2026-09-28'); // воскресенье → та же неделя
  assert.deepEqual(A.weeksOfMonth('2026-10'), ['2026-09-28', '2026-10-05', '2026-10-12', '2026-10-19', '2026-10-26']);
  assert.equal(A.monthOfWeek('2026-09-28'), '2026-10');
  assert.equal(A.studyYear('2026-10-02'), 2026);
  assert.equal(A.studyYear('2027-03-01'), 2026);
  assert.deepEqual(A.studyMonths(2026).slice(0, 2), ['2026-09', '2026-10']);
});

test('пары дня и итоги', () => {
  const week = { m: { a: { '2026-09-29': { 2: 'N', 5: 'P' } } }, pairs: { '2026-09-29': [6] } };
  assert.deepEqual(A.dayPairs(week, '2026-09-29', [1, 2, 3]), [1, 2, 3, 5, 6]);
  assert.deepEqual(A.dayPairs(null, '2026-09-29', null), []);
  assert.deepEqual(A.dayPairs({ m: {}, pairs: {}, hide: { '2026-09-29': [2] } }, '2026-09-29', [1, 2, 3]), [1, 3]);
  const t = A.studentTotals('a', { w: week });
  assert.equal(t.N, 1); assert.equal(t.P, 1); assert.equal(t.absent, 1); assert.equal(t.rate, 0.5);
  assert.equal(A.studentTotals('a', { w: week }, () => false).total, 0);
  const studs = [{ id: 'a', name: 'А' }, { id: 'b', name: 'Б', from: '2026-10-05' }, { id: 'c', name: 'В', to: '2026-09-20' }];
  assert.deepEqual(A.activeStudents(studs, '2026-09-28', '2026-10-03').map((s) => s.id), ['a']);
});

test('старая таблица → отметки', async () => {
  // Лист как в старой таблице: даты (числа Excel), дни недели, «№ | ФИО», по 4 колонки на день.
  const serial = (iso) => (Date.parse(iso + 'T00:00:00Z') - Date.UTC(1899, 11, 30)) / 864e5;
  const row1 = [null, null], row2 = [null, null];
  for (const d of ['2025-11-10', '2025-11-11']) { row1.push(serial(d), null, null, null); row2.push('день', null, null, null); }
  const old = A.buildXlsx([{ name: '10.11-15.11', rows: [
    row1, row2, ['№', 'ФИО'],
    [1, 'Петров Пётр Петрович', '"+', '"+', 'н', null, 'нб', 'нр', 'нз', '"+"'],
    [2, 'сидорова анна ивановна', null, null, null, null, '+', 'xx', null, null],
  ] }]);
  const r = await A.parseOldXlsx(old);
  assert.equal(r.marks, 8);
  assert.deepEqual(r.weeks['2025-11-10']['Петров Пётр Петрович'], { '2025-11-10': { 1: 'P', 2: 'P', 3: 'N' }, '2025-11-11': { 1: 'B', 2: 'R', 3: 'Z', 4: 'P' } });
  assert.deepEqual(r.weeks['2025-11-10']['сидорова анна ивановна'], { '2025-11-11': { 1: 'P' } });
  await assert.rejects(A.parseOldXlsx(new Uint8Array([1, 2, 3])));
});

test('выгрузка в Excel', async () => {
  const students = [{ id: 'a', name: 'Петров Пётр' }, { id: 'b', name: 'Сидорова Анна', to: '2026-10-01' }];
  const weeks = { '2026-09-28': { m: { a: { '2026-09-28': { 1: 'P', 2: 'N' } }, b: { '2026-09-29': { 1: 'B' } } }, pairs: {} } };
  for (const [kind, key] of [['week', '2026-09-28'], ['month', '2026-10'], ['month', '2026-09'], ['course', null]]) {
    const wb = A.attendanceWorkbook({ kind, key, courseTitle: '2 курс', students, weeks, schedule: { '2026-09-28': [1, 2, 3] }, exportedAt: '2026-10-02' });
    assert.ok(wb.sheets.length >= 1, kind);
    const bytes = A.buildXlsx(wb.sheets);
    const files = await A.unzip(bytes);
    assert.ok(files.has('xl/workbook.xml') && files.has('xl/styles.xml'));
    const xml = new TextDecoder().decode(files.get('xl/sharedStrings.xml'));
    assert.ok(xml.includes('Петров Пётр'));
    assert.ok(xml.includes('Обозначения'));
  }
  const wk = A.weekSheet({ title: 't', monday: '2026-09-28', week: weeks['2026-09-28'], students, schedule: { '2026-09-28': [1, 2, 3] } });
  // Пн: 3 пары по расписанию, Вт: пара с отметкой, Ср–Сб: «нет пар»
  assert.deepEqual(wk.rows[4].slice(2, 10).map((c) => c.v), ['1 п.', '2 п.', '3 п.', '1 п.', 'нет пар', 'нет пар', 'нет пар', 'нет пар']);
  const petrov = wk.rows[5];
  assert.equal(petrov[1].v, 'Петров Пётр');
  assert.deepEqual([petrov[2].v, petrov[3].v, petrov[4].v], ['✓', 'Н', '']);
  assert.equal(petrov[2].s, 'mP');
  assert.equal(A.colName(0), 'A'); assert.equal(A.colName(25), 'Z'); assert.equal(A.colName(26), 'AA');
});
