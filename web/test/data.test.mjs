import test from 'node:test';
import assert from 'node:assert/strict';

const proxy = 'https://tkpst-account.telling-math.workers.dev/schedule_api/tyumen';
const direct = 'https://api.thisishyum.ru/schedule_api/tyumen';
const day = '/groups/196/schedules?date=2026-10-15';

function setup(t, fetcher) {
  const oldLocation = globalThis.location;
  const oldStorage = globalThis.localStorage;
  const oldFetch = globalThis.fetch;
  const values = new Map([['group_id', '196']]);
  globalThis.location = { hostname: 'wtfhoshi.github.io' };
  globalThis.localStorage = {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: key => values.delete(key),
    key: index => [...values.keys()][index] ?? null,
    get length() { return values.size; },
  };
  globalThis.fetch = fetcher;
  t.after(() => { globalThis.location = oldLocation; globalThis.localStorage = oldStorage; globalThis.fetch = oldFetch; });
}

test('Pages loads a dated timetable through the VPN-independent Worker', async t => {
  setup(t, async url => {
    assert.equal(url, proxy + day);
    return Response.json({ lessons: [{ title: 'История', order: 2 }] });
  });
  const { loadDay } = await import('../js/data.js');
  const { T } = await import('../js/core.js');
  const { subjectTitlesForDay } = await import('../js/attendance.js');
  const result = await loadDay(T.parseIso('2026-10-15'));
  assert.equal(result.lessons[0].title, 'История');
  assert.equal(subjectTitlesForDay('2026-10-15', result.lessons)['2026-10-15/2'], 'История');
});

test('schedule loads directly if the Worker proxy is temporarily unavailable', async t => {
  const visited = [];
  setup(t, async url => {
    visited.push(url);
    if (url.startsWith(proxy)) throw new Error('proxy unavailable');
    assert.equal(url, direct + day);
    return Response.json({ lessons: [{ title: 'История', order: 2 }] });
  });
  const { loadDay } = await import('../js/data.js');
  const { T } = await import('../js/core.js');
  const result = await loadDay(T.parseIso('2026-10-15'));
  assert.equal(result.lessons[0].title, 'История');
  assert.deepEqual(visited, [proxy + day, direct + day]);
});
