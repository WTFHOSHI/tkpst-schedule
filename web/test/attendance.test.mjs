import test from 'node:test';
import assert from 'node:assert/strict';

// Synthetic marks only: these tests never contact a student's account.
test('attendance uses Tyumen month and bounded calendar navigation', async () => {
  const { currentMonth, shiftMonth, validMonth } = await import('../js/attendance.js');
  assert.equal(currentMonth(new Date('2026-10-31T20:00:00Z')), '2026-11');
  assert.equal(shiftMonth('2026-12', 1), '2027-01');
  assert.equal(shiftMonth('2026-01', -1), '2025-12');
  assert.equal(shiftMonth('2000-01', -1), '2000-01');
  for (const month of ['2026-00', '2026-13', '2026-1', '1999-12', '<script>']) assert.equal(validMonth(month), false);
});

test('only marked valid pairs count; blanks are never absences', async () => {
  const { attendanceModel } = await import('../js/attendance.js');
  const model = attendanceModel({ linked: true, syncedAt: '2026-10-27T10:00:00Z', records: [
    ...['P', 'N', 'B', 'U', 'R', 'Z', ''].map((status, i) => ({ date: '2026-10-26', pair: i + 1, status })),
    { date: '2026-10-25', pair: 2, status: 'P' },
    { date: '2026-09-30', pair: 1, status: 'N' }, { date: '2026-10-32', pair: 1, status: 'N' },
    { date: '2026-10-27', pair: 1, status: '<img src=x>' },
  ] }, '2026-10');
  assert.equal(model.counts.marked, 7);
  assert.equal(model.counts.attended, 2);
  assert.equal(model.counts.missed, 5);
  assert.equal(model.counts.unexcused, 1);
  assert.deepEqual(model.days.map(day => day.date), ['2026-10-26', '2026-10-25']);
  assert.deepEqual(model.days[0].records.map(row => row.pair), [1, 2, 3, 4, 5, 6]);
});

test('server millisecond timestamp renders correctly; pairs outside source range are excluded', async () => {
  const { attendanceModel } = await import('../js/attendance.js');
  const model = attendanceModel({ linked: true, syncedAt: Date.parse('2026-10-27T10:00:00Z'), records: [
    { date: '2026-10-26', pair: 8, status: 'P' },
    { date: '2026-10-26', pair: 9, status: 'N' },
  ] }, '2026-10');
  assert.equal(model.syncedAt, '2026-10-27T10:00:00.000Z');
  assert.equal(model.counts.marked, 1);
  const { attendanceMarkup } = await import('../js/attendance-view.js');
  const html = attendanceMarkup({ month: '2026-10', kind: 'ready', data: { linked: true, syncedAt: Date.parse('2026-10-27T10:00:00Z'), records: [] } });
  assert.match(html, /Последняя передача/);
  assert.doesNotMatch(html, /ещё не переданы|Invalid Date/);
});

test('attendance view distinguishes unsynced, unmarked, unlinked, loading and errors', async () => {
  const { attendanceMarkup } = await import('../js/attendance-view.js');
  const render = data => attendanceMarkup({ month: '2026-10', kind: 'ready', data });
  assert.match(render({ linked: true, syncedAt: null, records: [] }), /ещё не переданы/);
  assert.match(render({ linked: true, syncedAt: '2026-10-27T10:00:00Z', records: [] }), /Пока нет отметок/);
  assert.match(render({ linked: false, records: [{ date: '2026-10-26', pair: 1, status: 'P' }] }), /Подтвердите связь/);
  assert.doesNotMatch(render({ linked: false }), /attendance-summary/);
  assert.match(attendanceMarkup({ month: '2026-10', kind: 'loading' }), /Загружаем посещаемость/);
  const error = attendanceMarkup({ month: '2026-10', kind: 'error', error: '<img src=x onerror=bad>' });
  assert.match(error, /data-attendance-retry/);
  assert.match(error, /&lt;img/);
  assert.doesNotMatch(error, /<img/);
});

test('journal lists only absences and separates grades into another tab', async () => {
  const { attendanceMarkup } = await import('../js/attendance-view.js');
  const html = attendanceMarkup({ month: '2026-10', kind: 'ready', data: {
    linked: true, syncedAt: '2026-10-27T10:00:00Z',
    records: ['P', 'N', 'B', 'U', 'R', 'Z'].map((status, i) => ({ date: '2026-10-26', pair: i + 1, status })),
  } });
  for (const label of ['Прогул', 'Болезнь', 'Уважительная', 'Работа', 'Заявление']) assert.match(html, new RegExp(label));
  assert.doesNotMatch(html, /1-я пара|>Был</);
  assert.match(html, /6-я пара/);
  assert.match(html, /5 пропусков/);
  assert.equal((html.match(/<time datetime="2026-10-26">/g) || []).length, 1);
  assert.match(html, /type="month"/);
  assert.match(html, /Предыдущий месяц/);
  assert.match(html, /Следующий месяц/);
  assert.match(html, /Последняя передача/);
  assert.match(html, /Обновляется автоматически/);
  assert.doesNotMatch(html, /data-attendance-retry/);
  assert.match(html, /Пустые ячейки/);
  assert.match(html, /data-progress-tab="grades"/);
  assert.doesNotMatch(html, /Оценки ещё не подключены/);
  const grades = attendanceMarkup({ month: '2026-10', tab: 'grades', kind: 'ready', data: null });
  assert.match(grades, /Оценки ещё не подключены/);
  assert.doesNotMatch(grades, /data-attendance-month|Журнал пропусков/);
  assert.doesNotMatch(html, /%|NaN|Invalid Date/);
  assert.match(attendanceMarkup({ month: '2026-10', kind: 'ready', refreshError: true, data: {
    linked: true, syncedAt: '2026-10-27T10:00:00Z', records: [{ date: '2026-10-26', pair: 1, status: 'N' }],
  } }), /Повторим автоматически/);
});

test('month with only present marks shows a clear no absences state', async () => {
  const { attendanceMarkup } = await import('../js/attendance-view.js');
  const html = attendanceMarkup({ month: '2026-10', kind: 'ready', data: {
    linked: true, syncedAt: '2026-10-27T10:00:00Z',
    records: [{ date: '2026-10-26', pair: 1, status: 'P' }],
  } });
  assert.match(html, /Пропусков нет/);
  assert.doesNotMatch(html, /1-я пара/);
});
