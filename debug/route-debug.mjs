// Диагностика поиска маршрутов на живых данных (запускается в GitHub Actions)
import { T, findPlans, schedulePlan, arriveBy, rankJourneys, COLLEGE, distM } from '../web/js/core.js';
import { getNetwork, departureSource, geoSearch } from '../web/js/data.js';

let requests = 0, reqMs = 0;
const origFetch = globalThis.fetch;
globalThis.fetch = async (url, opts = {}) => {
  requests++; const t = Date.now();
  opts.headers = { ...(opts.headers || {}), 'User-Agent': 'TkpstSchedule/1.0 (github.com/WTFHOSHI/tkpst-schedule)' };
  try { return await origFetch(url, opts); } finally { reqMs += Date.now() - t; }
};
const out = [];
const log = (m) => { out.push(m); console.log(m); };

const places = await geoSearch('Краснооктябрьская 6');
log('geo: ' + JSON.stringify(places.slice(0, 3)));
const home = places[0].point;
log('dist home→college: ' + Math.round(distM(home.lat, home.lon, COLLEGE.lat, COLLEGE.lon)) + ' m');

let t0 = Date.now();
const net = await getNetwork();
log(`network: ${Date.now() - t0} ms, patterns ${net.patterns.length}, stops ${net.stops.size}, requests ${requests}`);
log(`near home: ${net.near(home, 1000).length}, near college: ${net.near(COLLEGE, 1000).length}`);

t0 = Date.now();
const plans = findPlans(net, home, COLLEGE);
log(`plans: ${plans.length} in ${Date.now() - t0} ms`);
plans.slice(0, 10).forEach((p) => log(`  ${p.staticMin.toFixed(0)} мин · ` + p.legs.map((l) => `№${l.routeName}(${l.forward ? 'f' : 'b'}) ${l.from.name}→${l.to.name} [${l.stopsCount}]`).join(' | ')));

const now = T.now();
log('now (Тюмень): ' + T.iso(now) + ' ' + T.hm(now));

requests = 0; reqMs = 0; t0 = Date.now();
const js = (await Promise.all(plans.map((p) => schedulePlan(p, now, departureSource).catch((e) => { log('ERR ' + e); return null; })))).filter(Boolean);
const r = rankJourneys(js, 'duration', now);
log(`NOW: ${js.length} journeys, ${Date.now() - t0} ms, ${requests} requests`);
r.forEach((j) => log(`  ${j.durationMin} мин, выход ${T.hm(j.leaveAt)}, приезд ${T.hm(j.arrive)} · ` + j.legs.map((l) => `№${l.leg.routeName} ${T.hm(l.board)}${l.live ? ' live' : ' plan'}`).join(' → ')));

for (const hhmm of ['08:10', '09:50', '12:00']) {
  const [h, m] = hhmm.split(':').map(Number);
  let deadline = T.dayStart(now) + (h * 60 + m) * 60e3;
  if (deadline < now) deadline += 864e5;
  requests = 0; t0 = Date.now();
  const a = (await Promise.all(plans.map((p) => arriveBy(p, deadline, now, departureSource).catch((e) => { log('ERR ' + e); return null; })))).filter(Boolean);
  const ra = rankJourneys(a, 'latest', now);
  log(`ARRIVE ${hhmm}: ${a.length} journeys, ${Date.now() - t0} ms, ${requests} requests`);
  ra.forEach((j) => log(`  выход ${T.hm(j.leaveAt)}, приезд ${T.hm(j.arrive)} (${j.durationMin} мин) · ` + j.legs.map((l) => `№${l.leg.routeName} ${T.hm(l.board)}${l.live ? ' live' : ' plan'}`).join(' → ')));
  // Почему не нашлось: пробуем первый план подробно
  if (!a.length && plans[0]) {
    const p = plans[0];
    const j0 = await schedulePlan(p, deadline - (p.staticMin + 20) * 60e3, departureSource);
    log('  debug plan0 from ' + T.hm(deadline - (p.staticMin + 20) * 60e3) + ': ' + (j0 ? `arrive ${T.hm(j0.arrive)} board ${T.hm(j0.legs[0].board)}` : 'null'));
  }
}
// Итог в аннотации (по 20 строк)
for (let i = 0; i < out.length; i += 20) console.log('::notice title=debug ' + i + '::' + out.slice(i, i + 20).join('%0A'));
