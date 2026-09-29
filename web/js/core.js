// Логика расписания и маршрутов — порт с Android/iOS версий.
// Всё время — по Тюмени (UTC+5, без перехода на летнее время).
// «Тюменское время» храним как число мс, которое читаем UTC-геттерами.

export const OFFSET = 5 * 3600e3;
const DAY = 864e5;

export const T = {
  now: () => Date.now() + OFFSET,
  fromReal: (ms) => ms + OFFSET,
  toReal: (t) => t - OFFSET,
  dayStart: (t) => Math.floor(t / DAY) * DAY,
  /** 1 = понедельник … 7 = воскресенье */
  weekday: (t) => { const d = new Date(t).getUTCDay(); return d === 0 ? 7 : d; },
  monday: (t) => { const s = T.dayStart(t); return s - (T.weekday(s) - 1) * DAY; },
  addDays: (t, n) => t + n * DAY,
  iso: (t) => new Date(t).toISOString().slice(0, 10),
  parseIso: (s) => Date.parse(s.slice(0, 10) + 'T00:00:00Z'),
  minuteOfDay: (t) => (t - T.dayStart(t)) / 60000,
  hm: (t) => { const d = new Date(t); return pad(d.getUTCHours()) + ':' + pad(d.getUTCMinutes()); },
  hmMin: (m) => pad(Math.floor(m / 60)) + ':' + pad(m % 60),
  dayNum: (t) => new Date(t).getUTCDate(),
};

function pad(n) { return String(n).padStart(2, '0'); }

const MONTHS_GEN = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
const MONTHS_SHORT = ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
const WD_LONG = ['понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота', 'воскресенье'];
const WD_SHORT = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];

export const fmt = {
  dMonth: (t) => `${T.dayNum(t)} ${MONTHS_GEN[new Date(t).getUTCMonth()]}`,
  dMon: (t) => `${T.dayNum(t)} ${MONTHS_SHORT[new Date(t).getUTCMonth()]}`,
  wdLong: (t) => WD_LONG[T.weekday(t) - 1],
  wdShort: (t) => WD_SHORT[T.weekday(t) - 1],
};

/** «1 ч 20 мин», «45 мин», «меньше минуты». Минуты округляются вверх. */
export function formatLeft(seconds) {
  if (seconds < 60) return 'меньше минуты';
  const total = Math.floor((seconds + 59) / 60);
  const h = Math.floor(total / 60), m = total % 60;
  if (h > 0 && m > 0) return `${h} ч ${m} мин`;
  if (h > 0) return `${h} ч`;
  return `${m} мин`;
}

// ---------------- Звонки (с фото «Расписание звонков») ----------------

const hm = (s) => { const [h, m] = s.split(':').map(Number); return h * 60 + m; };
const slot = (n, a, b) => ({ number: n, start: hm(a), end: hm(b) });

const MONDAY = [slot(1, '08:30', '10:00'), slot(2, '10:10', '11:40'), slot(3, '12:20', '13:50'),
  slot(4, '14:35', '16:05'), slot(5, '16:15', '17:45'), slot(6, '17:50', '18:50')];
const WEEKDAYS = [slot(1, '08:15', '09:45'), slot(2, '09:55', '11:25'), slot(3, '12:05', '13:35'),
  slot(4, '13:45', '15:15'), slot(5, '15:40', '17:10'), slot(6, '17:20', '18:50')];
const SATURDAY = [slot(1, '08:15', '09:15'), slot(2, '09:25', '10:25'), slot(3, '10:35', '11:35'),
  slot(4, '12:05', '13:05'), slot(5, '13:15', '14:15'), slot(6, '14:25', '15:25')];

export const MORNING_CH = { start: hm('08:00'), end: hm('08:30'), title: 'Поднятие Государственного флага РФ · «Разговоры о важном»' };
export const AFTERNOON_CH = { start: hm('14:00'), end: hm('14:30'), title: 'Классный час «Разговоры о важном»' };

export function pairSlots(wd) { return wd === 1 ? MONDAY : wd === 6 ? SATURDAY : wd === 7 ? [] : WEEKDAYS; }
export function classHourSlots(wd) { return wd === 1 ? [MORNING_CH, AFTERNOON_CH] : []; }

// ---------------- Лента дня ----------------

function parseTime(s) {
  if (!s) return null;
  const p = String(s).trim().split(':').map(Number);
  return p.length >= 2 && !isNaN(p[0]) ? p[0] * 60 + p[1] : null;
}
const clean = (s) => (s ?? '').replace(/\s+/g, ' ').trim();
const isCH = (t) => /классный час/i.test(t || '');

function info(l) {
  const title = clean(l.title), cabinet = clean(l.cabinet), teacher = clean(l.teacher);
  const r = l.replace;
  if (!r) return { title, cabinet, teacher, replaced: false };
  const nt = clean(r.title) || title, nc = clean(r.cabinet) || cabinet, nte = clean(r.teacher) || teacher;
  return {
    title: nt, cabinet: nc, teacher: nte, replaced: true,
    oldTitle: title !== nt ? title : null, oldCabinet: cabinet !== nc ? cabinet : null, oldTeacher: teacher !== nte ? teacher : null,
  };
}

/**
 * Лента дня: пары (время по звонкам с фото), классные часы понедельника, перерывы/окна.
 * Элементы: {type:'pair'|'ch'|'break', start, end, ...} (минуты от начала суток).
 */
export function buildTimeline(wd, lessons) {
  if (wd === 7 || !lessons || lessons.length === 0) return [];
  const slots = pairSlots(wd), chs = classHourSlots(wd);
  const classHours = new Map();
  const pairs = new Map();
  const custom = new Map();
  const mondayShift = wd === 1 && lessons.some((l) => l.order === 1 && (isCH(l.title) || parseTime(l.startTime) === MORNING_CH.start));

  for (const l of lessons) {
    const st = parseTime(l.startTime);
    const chSlot = chs.find((s) => s.start === st);
    if (chSlot || isCH(l.title)) {
      const s = chSlot || (st == null ? chs[0] : [...chs].sort((a, b) => Math.abs(a.start - st) - Math.abs(b.start - st))[0]);
      const start = s ? s.start : st;
      if (start == null) continue;
      const end = s ? s.end : (parseTime(l.endTime) ?? start + 30);
      classHours.set(start, { type: 'ch', start, end, title: clean(l.title) || (s ? s.title : 'Классный час'), cabinet: clean(l.cabinet) });
      continue;
    }
    const byTime = slots.find((s) => s.start === st);
    const number = byTime ? byTime.number : (mondayShift ? l.order - 1 : l.order);
    if (!(number > 0)) continue;
    if (!slots.some((s) => s.number === number)) {
      if (st == null) continue;
      custom.set(number, [st, parseTime(l.endTime) ?? st + 90]);
    }
    if (!pairs.has(number)) pairs.set(number, []);
    pairs.get(number).push(info(l));
  }

  if (wd === 1 && pairs.size > 0) {
    const nums = [...pairs.keys()];
    if (!classHours.has(MORNING_CH.start) && nums.some((n) => n <= 3)) {
      classHours.set(MORNING_CH.start, { type: 'ch', start: MORNING_CH.start, end: MORNING_CH.end, title: MORNING_CH.title, cabinet: '' });
    }
    if (!classHours.has(AFTERNOON_CH.start) && nums.some((n) => n >= 4)) {
      classHours.set(AFTERNOON_CH.start, { type: 'ch', start: AFTERNOON_CH.start, end: AFTERNOON_CH.end, title: AFTERNOON_CH.title, cabinet: '' });
    }
  }

  const main = [...classHours.values()];
  for (const [n, lessonsInfo] of pairs) {
    const s = slots.find((x) => x.number === n);
    const [a, b] = s ? [s.start, s.end] : custom.get(n);
    main.push({ type: 'pair', number: n, start: a, end: b, lessons: lessonsInfo });
  }
  main.sort((a, b) => a.start - b.start);

  const out = [];
  main.forEach((e, i) => {
    if (i > 0) {
      const prev = main[i - 1];
      const gap = e.start - prev.end;
      if (gap > 0) {
        const skipped = slots.some((s) => s.start >= prev.end && s.end <= e.start);
        out.push({ type: 'break', start: prev.end, end: e.start, kind: skipped ? 'window' : gap >= 25 ? 'big' : 'short' });
      }
    }
    out.push(e);
  });
  return out;
}

/** Ответ API: null, массив дней или один день. */
export function parseLessons(json) {
  if (json == null) return [];
  if (Array.isArray(json)) return json.flatMap((d) => d.lessons || []);
  if (json.lessons) return json.lessons;
  throw new Error(json.error || 'Неизвестный ответ сервера');
}

// ---------------- Гео ----------------

export const COLLEGE = { lat: 57.1647166, lon: 65.5103316 };
export const COLLEGE_LABEL = 'Колледж, Луначарского, 19';
const WALK_M_PER_MIN = 75, DETOUR = 1.25;
const BUS_M_PER_MIN = 350, RIDE_DETOUR = 1.15, DWELL_MIN = 0.5;

export function distM(aLat, aLon, bLat, bLon) {
  const R = 6371000, rad = Math.PI / 180;
  const dLat = (bLat - aLat) * rad, dLon = (bLon - aLon) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(aLat * rad) * Math.cos(bLat * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}
export const walkM = (d) => d * DETOUR;
export const walkMin = (d) => walkM(d) / WALK_M_PER_MIN;
const walk = (d) => ({ meters: Math.round(walkM(d)), minutes: walkMin(d) });

// ---------------- Сеть маршрутов ----------------

/** data: {date, stops:[{id,name,desc,lat,lon}], patterns:[{routeId,routeName,forward,stops:[id]}]} */
export class Network {
  constructor(data) {
    this.data = data;
    this.stops = new Map(data.stops.map((s) => [s.id, s]));
    this.patterns = data.patterns.filter((p) => p.stops.length >= 2 && p.stops.every((id) => this.stops.has(id)));
    this.cum = this.patterns.map((p) => {
      const a = [0];
      for (let i = 1; i < p.stops.length; i++) {
        const x = this.stops.get(p.stops[i - 1]), y = this.stops.get(p.stops[i]);
        a.push(a[i - 1] + distM(x.lat, x.lon, y.lat, y.lon) * RIDE_DETOUR / BUS_M_PER_MIN + DWELL_MIN);
      }
      return a;
    });
    this.byStop = new Map();
    this.patterns.forEach((p, pi) => p.stops.forEach((s, pos) => {
      if (!this.byStop.has(s)) this.byStop.set(s, []);
      this.byStop.get(s).push([pi, pos]);
    }));
    this.routeNames = new Map(this.patterns.map((p) => [p.routeId, p.routeName]));
    this._nb = new Map();
  }

  near(p, radius) {
    const out = [];
    for (const [id, s] of this.stops) {
      if (!this.byStop.has(id)) continue;
      const d = distM(p.lat, p.lon, s.lat, s.lon);
      if (d <= radius) out.push([s, d]);
    }
    return out.sort((a, b) => a[1] - b[1]);
  }

  neighbors(id, radius) {
    if (this._nb.has(id)) return this._nb.get(id);
    const s = this.stops.get(id);
    const out = this.near({ lat: s.lat, lon: s.lon }, radius);
    this._nb.set(id, out);
    return out;
  }

  routesAt(id) { return new Set((this.byStop.get(id) || []).map(([pi]) => this.patterns[pi].routeName)); }
}

export const ACCESS_RADIUS = 1000, TRANSFER_RADIUS = 500, TRANSFER_PENALTY = 6;

const planKey = (legs) => legs.map((l) => `${l.routeId}${l.forward ? 'f' : 'b'}`).join('>');

/** Прямые варианты и с одной пересадкой (пешком до 500 м). */
export function findPlans(net, origin, dest, limit = 30) {
  const nearO = net.near(origin, ACCESS_RADIUS), nearD = net.near(dest, ACCESS_RADIUS);
  if (!nearO.length || !nearD.length) return [];
  const wO = new Map(nearO.map(([s, d]) => [s.id, walkMin(d)])), dO = new Map(nearO.map(([s, d]) => [s.id, d]));
  const wD = new Map(nearD.map(([s, d]) => [s.id, walkMin(d)])), dD = new Map(nearD.map(([s, d]) => [s.id, d]));

  const eg = net.patterns.map((p, pi) => {
    const c = net.cum[pi], n = p.stops.length;
    const best = new Array(n).fill(Infinity), at = new Array(n).fill(-1);
    let cb = Infinity, ca = -1;
    for (let i = n - 1; i >= 0; i--) {
      best[i] = cb; at[i] = ca;
      const w = wD.get(p.stops[i]);
      if (w !== undefined && c[i] + w < cb) { cb = c[i] + w; ca = i; }
    }
    return [best, at];
  });

  const leg = (pi, from, to) => {
    const p = net.patterns[pi];
    return {
      routeId: p.routeId, routeName: p.routeName, forward: p.forward,
      from: net.stops.get(p.stops[from]), to: net.stops.get(p.stops[to]),
      stopsCount: to - from, rideMin: net.cum[pi][to] - net.cum[pi][from],
    };
  };

  const results = new Map();
  const offer = (plan) => {
    const k = planKey(plan.legs);
    const old = results.get(k);
    if (!old || plan.staticMin < old.staticMin) results.set(k, plan);
  };

  let bestDirect = Infinity;
  for (const [b] of nearO) {
    for (const [pi, i] of net.byStop.get(b.id) || []) {
      const [best, at] = eg[pi];
      if (best[i] === Infinity) continue;
      const j = at[i];
      const total = wO.get(b.id) + best[i] - net.cum[pi][i];
      bestDirect = Math.min(bestDirect, total);
      offer({ walkStart: walk(dO.get(b.id)), legs: [leg(pi, i, j)], transferWalk: null, walkEnd: walk(dD.get(net.patterns[pi].stops[j])), staticMin: total });
    }
  }

  const bound = isFinite(bestDirect) ? bestDirect + 20 : 150;
  const tBest = new Map();
  for (const [b] of nearO) {
    const w0 = wO.get(b.id);
    for (const [pi1, i] of net.byStop.get(b.id) || []) {
      const p1 = net.patterns[pi1], c1 = net.cum[pi1];
      for (let k = i + 1; k < p1.stops.length; k++) {
        const t1 = w0 + c1[k] - c1[i];
        if (t1 > bound) break;
        const x = p1.stops[k];
        if (wD.has(x)) continue;
        for (const [y, dxy] of net.neighbors(x, TRANSFER_RADIUS)) {
          const tw = walkMin(dxy);
          for (const [pi2, m] of net.byStop.get(y.id) || []) {
            const p2 = net.patterns[pi2];
            if (p2.routeId === p1.routeId) continue;
            const e = eg[pi2][0][m];
            if (e === Infinity) continue;
            const total = t1 + tw + TRANSFER_PENALTY + e - net.cum[pi2][m];
            if (total > bound + TRANSFER_PENALTY) continue;
            const key = `${p1.routeId}${p1.forward ? 'f' : 'b'}>${p2.routeId}${p2.forward ? 'f' : 'b'}`;
            const old = tBest.get(key);
            if (old && old.staticMin <= total) continue;
            const j = eg[pi2][1][m];
            tBest.set(key, {
              walkStart: walk(dO.get(b.id)), legs: [leg(pi1, i, k), leg(pi2, m, j)],
              transferWalk: walk(dxy), walkEnd: walk(dD.get(p2.stops[j])), staticMin: total,
            });
          }
        }
      }
    }
  }
  tBest.forEach(offer);

  return [...results.values()]
    .filter((p) => p.legs.length === 1 || p.staticMin <= bound + TRANSFER_PENALTY)
    .sort((a, b) => a.staticMin - b.staticMin)
    .slice(0, limit);
}

/**
 * Привязка ко времени. now — тюменское время (мс).
 * source.next(stopId, routeId, forward, after) → {time, live} | null
 */
export async function schedulePlan(plan, now, source) {
  let t = now + plan.walkStart.minutes * 60e3;
  const legs = [];
  for (let idx = 0; idx < plan.legs.length; idx++) {
    const l = plan.legs[idx];
    if (idx > 0) t += (plan.transferWalk ? plan.transferWalk.minutes : 0) * 60e3;
    const dep = await source.next(l.from.id, l.routeId, l.forward, t);
    if (!dep) return null;
    const alight = dep.time + l.rideMin * 60e3;
    legs.push({ leg: l, board: dep.time, live: dep.live, saved: !!dep.saved, alight });
    t = alight;
  }
  const arrive = t + plan.walkEnd.minutes * 60e3;
  const leave = legs[0].board - (plan.walkStart.minutes + 1) * 60e3;
  const leaveAt = Math.max(leave, now);
  return { plan, leaveAt, legs, arrive, alternatives: [], durationMin: Math.floor((arrive - leaveAt) / 60e3) };
}

/**
 * «Приехать к»: самый поздний выезд, при котором успеваешь к deadline.
 * earliest — раньше этого выйти нельзя (обычно «сейчас»).
 */
export async function arriveBy(plan, deadline, earliest, source) {
  let start = Math.max(earliest, deadline - (plan.staticMin + 20) * 60e3);
  let j = await schedulePlan(plan, start, source);
  // Не успеваем — сдвигаем выезд раньше.
  for (let i = 0; i < 8 && j && j.arrive > deadline; i++) {
    const next = start - (j.arrive - deadline) - 2 * 60e3;
    if (next < earliest) {
      if (start === earliest) return null;
      start = earliest;
    } else start = next;
    j = await schedulePlan(plan, start, source);
  }
  if (!j || j.arrive > deadline) return null;
  // Успеваем — пробуем выехать ещё позже (следующим автобусом).
  for (let i = 0; i < 12; i++) {
    const later = j.legs[0].board - plan.walkStart.minutes * 60e3 + 60e3;
    const j2 = await schedulePlan(plan, later, source);
    if (!j2 || j2.arrive > deadline || j2.legs[0].board <= j.legs[0].board) break;
    j = j2;
  }
  return j;
}

const groupKey = (j) => j.legs.length === 1
  ? `D:${j.legs[0].leg.from.id}>${j.legs[0].leg.to.id}`
  : `T:${j.legs[0].leg.routeName}:${j.legs[0].leg.from.id}>${j.legs[0].leg.to.id}>${j.legs[1].leg.from.id}>${j.legs[1].leg.to.id}`;

function ordered(list, sort) {
  const cmp = {
    arrival: (a, b) => a.arrive - b.arrive || a.durationMin - b.durationMin,
    // «Приехать к»: сначала самый поздний выезд (меньше ждать), потом короче в пути
    latest: (a, b) => b.leaveAt - a.leaveAt || a.durationMin - b.durationMin,
    duration: (a, b) => a.durationMin - b.durationMin || a.arrive - b.arrive,
  }[sort] || ((a, b) => a.durationMin - b.durationMin || a.arrive - b.arrive);
  return [...list].sort(cmp);
}

/**
 * Лучшие варианты; одинаковые пути с разными номерами склеены («или №54, 85»).
 * sort: 'duration' | 'arrival' | 'latest'. now — момент, от которого считаем «ближайшие».
 */
export function rankJourneys(journeys, sort, now, take = 5) {
  let soon = sort === 'latest' ? journeys : journeys.filter((j) => j.leaveAt - now <= 3600e3);
  if (!soon.length) soon = journeys;
  const groups = new Map();
  for (const j of ordered(soon, sort)) {
    const k = groupKey(j);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(j);
  }
  const grouped = [...groups.values()].map((g) => {
    const best = g[0];
    const bestName = best.legs[best.legs.length - 1].leg.routeName;
    const alts = [];
    for (const o of g.slice(1)) {
      const n = o.legs[o.legs.length - 1].leg.routeName;
      if (n !== bestName && !alts.includes(n)) alts.push(n);
    }
    return { ...best, alternatives: alts };
  });
  const seen = new Set(), out = [];
  for (const j of ordered(grouped, sort)) {
    const k = j.legs.map((l) => l.leg.routeName).join('>');
    if (seen.has(k)) continue;
    seen.add(k); out.push(j);
    if (out.length >= take) break;
  }
  return out;
}
