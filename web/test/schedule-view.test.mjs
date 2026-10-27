import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

// Exercise the existing DOM renderer in isolation; do not contact live schedule APIs.
const source = readFileSync(new URL('../js/app.js', import.meta.url), 'utf8');
const renderer = source.slice(source.indexOf('function renderList(scroll)'), source.indexOf('// ---------------- Автобусы'));
test('объявление видно при ошибке, загрузке, выходном и отсутствии пар', () => {
  for (const state of [{ kind: 'error' }, { kind: 'loading' }, { kind: 'sunday' }, { kind: 'loaded', data: { lessons: [], notPublished: true } }]) {
    const list = { dataset: {}, innerHTML: '', querySelector: () => null };
    const context = {
      $app: { querySelector: () => list }, sched: { selected: 0, state },
      T: { now: () => 0, dayStart: () => 0, minuteOfDay: () => 0, weekday: () => 2, iso: () => '2026-10-27' },
      msg: title => `<p>${title}</p>`, buildTimeline: () => [], renderWeek: () => {},
      announcementHtml: () => '<div class="announce">Важное объявление</div>',
    };
    vm.runInNewContext(renderer + '\nrenderList(false);', context);
    assert.match(list.innerHTML, /Важное объявление/, state.kind);
  }
});
