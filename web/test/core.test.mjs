// Тесты логики сайта: node --test web/test
import test from 'node:test';
import assert from 'node:assert/strict';
import { T, buildTimeline, formatLeft, parseLessons, Network, findPlans, schedulePlan, rankJourneys, arriveBy } from '../js/core.js';

const L = (order, s, e, title = `Предмет ${order}`, replace) =>
  ({ title, cabinet: '101', teacher: 'Иванов И.И.', order, startTime: s + ':00', endTime: e + ':00', replace });
const m = (s) => { const [h, mm] = s.split(':').map(Number); return h * 60 + mm; };

test('понедельник: классный час не пара, пары по звонкам', () => {
  const e = buildTimeline(1, [
    { title: 'Классный час "Разговоры о важном"', cabinet: '302-1', teacher: '', order: 1, startTime: '08:00:00', endTime: '08:30:00' },
    { title: 'Иностранный - 1 п/г', cabinet: '302-1', teacher: 'Зыкова Е.И.', order: 2, startTime: '08:30:00', endTime: '10:00:00' },
    { title: 'История', cabinet: '306', teacher: 'Ильина  Т.В.', order: 3, startTime: '10:10:00', endTime: '11:40:00' },
    { title: 'Иностранный - 2 п/г', cabinet: '310', teacher: 'Моргунова А.Ю.', order: 4, startTime: '12:20:00', endTime: '13:50:00' },
  ]);
  assert.equal(e[0].type, 'ch');
  assert.deepEqual(e.filter((x) => x.type === 'pair').map((x) => x.number), [1, 2, 3]);
  assert.equal(e.find((x) => x.number === 2).lessons[0].teacher, 'Ильина Т.В.');
  assert.deepEqual(e.filter((x) => x.type === 'break').map((x) => x.end - x.start), [10, 40]);
  assert.equal(e.filter((x) => x.type === 'ch').length, 1);
});

test('понедельник: дневной классный час для второй смены', () => {
  const e = buildTimeline(1, [L(4, '14:35', '16:05'), L(5, '16:15', '17:45')]);
  assert.deepEqual(e.filter((x) => x.type === 'ch').map((x) => x.start), [m('14:00')]);
  assert.equal(e[1].end - e[1].start, 5);
});

test('вторник: перерыв, окно, большой перерыв', () => {
  const e = buildTimeline(2, [L(1, '08:15', '09:45'), L(2, '09:55', '11:25'), L(4, '13:45', '15:15'), L(5, '15:40', '17:10')]);
  assert.deepEqual(e.filter((x) => x.type === 'break').map((x) => x.kind), ['short', 'window', 'big']);
});

test('время пар — из звонков, а не из API', () => {
  const e = buildTimeline(3, [{ title: 'X', order: 3, startTime: '12:00:00', endTime: '13:30:00' }]);
  assert.equal(e[0].start, m('12:05'));
  assert.equal(e[0].end, m('13:35'));
});

test('воскресенье, замены, формат', () => {
  assert.equal(buildTimeline(7, [L(1, '08:15', '09:45')]).length, 0);
  const p = buildTimeline(2, [L(1, '08:15', '09:45', 'Старый', { title: 'Новый', cabinet: null, teacher: 'Петров' })])[0];
  assert.equal(p.lessons[0].title, 'Новый');
  assert.equal(p.lessons[0].oldTitle, 'Старый');
  assert.equal(p.lessons[0].cabinet, '101');
  assert.equal(formatLeft(30), 'меньше минуты');
  assert.equal(formatLeft(61), '2 мин');
  assert.equal(formatLeft(80 * 60), '1 ч 20 мин');
  assert.equal(formatLeft(7200), '2 ч');
  assert.equal(parseLessons(null).length, 0);
  assert.throws(() => parseLessons({ statusCode: 400, error: 'invalid groupId' }));
});

test('тюменское время', () => {
  const mon = T.parseIso('2026-09-28');
  assert.equal(T.weekday(mon), 1);
  assert.equal(T.weekday(T.parseIso('2026-10-04')), 7);
  assert.equal(T.iso(T.monday(T.parseIso('2026-10-04'))), '2026-09-28');
  // 2026-09-28 18:30 UTC = 23:30 в Тюмени
  const t = T.fromReal(Date.parse('2026-09-28T18:30:00Z'));
  assert.equal(T.hm(t), '23:30');
  assert.equal(T.iso(t), '2026-09-28');
});

// Синтетическая сеть: A — прямой, но с крюком; B→C/D — с пересадкой, быстрее.
function net() {
  const st = (id, lon, lat = 57.15) => ({ id, name: `S${id}`, desc: '', lat, lon });
  const stops = [st(1, 65.401)];
  for (let i = 2; i <= 10; i++) stops.push(st(i, 65.40 + i * 0.01, 57.18));
  stops.push(st(11, 65.499));
  for (let i = 20; i <= 25; i++) stops.push(st(i, 65.402 + (i - 20) * 0.01));
  for (let i = 30; i <= 35; i++) stops.push(st(i, 65.452 + (i - 30) * 0.0095));
  const range = (a, b) => Array.from({ length: b - a + 1 }, (_, i) => a + i);
  return new Network({
    date: '2026-09-29', stops, patterns: [
      { routeId: 1, routeName: 'A', forward: true, stops: range(1, 11) },
      { routeId: 1, routeName: 'A', forward: false, stops: range(1, 11).reverse() },
      { routeId: 2, routeName: 'B', forward: true, stops: range(20, 25) },
      { routeId: 3, routeName: 'C', forward: true, stops: range(30, 35) },
      { routeId: 4, routeName: 'D', forward: true, stops: range(30, 35) },
    ],
  });
}
const home = { lat: 57.15, lon: 65.40 }, college = { lat: 57.15, lon: 65.50 };

test('маршруты: прямой и с пересадкой', () => {
  const plans = findPlans(net(), home, college);
  assert.ok(plans.some((p) => p.legs.length === 1 && p.legs[0].routeName === 'A' && p.legs[0].forward));
  assert.ok(plans.some((p) => p.legs.length === 2 && p.legs[0].routeName === 'B' && p.legs[1].routeName === 'C'));
  assert.ok(!plans.some((p) => p.legs.some((l) => l.routeName === 'A' && !l.forward)));
  assert.ok(plans.find((p) => p.legs.length === 2).staticMin < plans.find((p) => p.legs.length === 1).staticMin);
  assert.equal(findPlans(net(), { lat: 56, lon: 60 }, college).length, 0);
});

test('маршруты: время, сортировка, склейка номеров', async () => {
  const now = T.parseIso('2026-09-29') + 7 * 3600e3;
  const source = { async next(stopId, routeId, fwd, after) {
    let t = now + (routeId === 3 ? 5 * 60e3 : 0);
    while (t < after) t += 10 * 60e3;
    return { time: t, live: routeId !== 2 };
  } };
  const js = (await Promise.all(findPlans(net(), home, college).map((p) => schedulePlan(p, now, source)))).filter(Boolean);
  for (const j of js) {
    assert.ok(j.leaveAt >= now);
    for (let i = 1; i < j.legs.length; i++) assert.ok(j.legs[i].board >= j.legs[i - 1].alight);
  }
  const r = rankJourneys(js, 'duration', now);
  assert.ok(r.length > 0);
  assert.deepEqual(r.map((j) => j.durationMin), [...r.map((j) => j.durationMin)].sort((a, b) => a - b));
  assert.ok(r.find((j) => j.legs.length === 2).alternatives.length > 0);
});

test('приехать к: самый поздний выезд, успеваем к сроку', async () => {
  const day = T.parseIso('2026-09-30');
  const now = day + 22 * 3600e3 - 864e5; // вечер накануне
  const source = { async next(stopId, routeId, fwd, after) {
    // автобусы каждые 10 минут с 06:00 следующего дня
    let t = day + 6 * 3600e3 + (routeId === 3 ? 5 * 60e3 : 0);
    while (t < after) t += 10 * 60e3;
    return { time: t, live: false };
  } };
  const deadline = day + (8 * 60 + 10) * 60e3; // к 08:10
  const plans = findPlans(net(), home, college);
  const js = (await Promise.all(plans.map((p) => arriveBy(p, deadline, now, source)))).filter(Boolean);
  assert.ok(js.length > 0);
  for (const j of js) {
    assert.ok(j.arrive <= deadline, 'успеваем');
    // следующий автобус (на 10 мин позже) уже опоздал бы — значит выезд самый поздний
    assert.ok(j.arrive > deadline - 10 * 60e3 - 60e3, 'не выезжаем слишком рано');
  }
  const r = rankJourneys(js, 'latest', now);
  assert.deepEqual(r.map((j) => j.leaveAt), [...r.map((j) => j.leaveAt)].sort((a, b) => b - a));
});

test('приехать к: нельзя выехать в прошлом', async () => {
  const now = T.parseIso('2026-09-30') + 8 * 3600e3;
  const source = { async next(s, r, f, after) { return { time: after + 60e3, live: true }; } };
  const plans = findPlans(net(), home, college);
  const j = await arriveBy(plans[0], now + 5 * 60e3, now, source);
  assert.equal(j, null); // за 5 минут не доехать
});
