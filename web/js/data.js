// Данные: расписание (OpenScheduleApi) и автобусы (Тюменьгортранс), кэш в localStorage.
import { T, parseLessons, Network } from './core.js';

// ---------------- Хранилище ----------------

export const store = {
  get(k, def = null) {
    try { const v = localStorage.getItem(k); return v == null ? def : JSON.parse(v); } catch { return def; }
  },
  set(k, v) {
    try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch { return false; }
  },
  del(k) { try { localStorage.removeItem(k); } catch { /* ignore */ } },
  keys() { try { return Object.keys(localStorage); } catch { return []; } },
};

async function getJson(url, timeoutMs = 15000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(url, { signal: ctrl.signal, headers: { Accept: 'application/json' }, cache: 'no-store' });
    if (!r.ok) throw new Error('Сервер ответил ' + r.status);
    const text = await r.text();
    return text.trim() === '' ? null : JSON.parse(text);
  } finally {
    clearTimeout(timer);
  }
}

// ---------------- Расписание пар ----------------

const SCHED = 'https://api.thisishyum.ru/schedule_api/tyumen';
const GROUP_NAME = 'ИС-25-3С';
const FALLBACK_GROUP = 196; // проверено 28.09.2026: ИС-25-3С, «Луначарского 2 курс»
const KEEP_DAYS = 14;
const norm = (s) => s.replace(/\s/g, '').toUpperCase();

async function groupId() {
  const saved = store.get('group_id');
  if (saved) return saved;
  let id = FALLBACK_GROUP;
  try {
    const groups = await getJson(`${SCHED}/colleges/1/groups`);
    const g = groups.find((x) => norm(x.name) === norm(GROUP_NAME));
    if (g) id = g.studentGroupId;
  } catch { /* fallback */ }
  store.set('group_id', id);
  return id;
}

export function cachedDay(day) {
  const c = store.get('day_' + T.iso(day));
  if (!c) return null;
  try { return { lessons: parseLessons(c.body), offline: true, savedAt: c.at, notPublished: false }; } catch { return null; }
}

/** Загрузка дня; при ошибке сети — сохранённая версия. change: 'published' | 'changed' | null */
export async function loadDay(day) {
  try {
    const gid = await groupId();
    const body = await getJson(`${SCHED}/groups/${gid}/schedules?date=${T.iso(day)}`);
    const lessons = parseLessons(body);
    let notPublished = false;
    if (!lessons.length) {
      try {
        const last = await getJson(`${SCHED}/groups/${gid}/schedules/last`);
        if (last && last.date) notPublished = T.dayStart(day) > T.parseIso(last.date);
      } catch { /* ignore */ }
    }
    let change = null;
    if (!notPublished) {
      const old = cachedDay(day);
      if (store.get('baseline', false)) {
        if (!old) change = lessons.length ? 'published' : null;
        else if (JSON.stringify(old.lessons) !== JSON.stringify(lessons)) change = 'changed';
      }
      store.set('day_' + T.iso(day), { body, at: Date.now() });
      store.set('baseline', true);
    }
    return { lessons, offline: false, savedAt: Date.now(), notPublished, change };
  } catch (e) {
    const c = cachedDay(day);
    if (c) return c;
    throw e;
  }
}

/** Пн–Сб текущей и следующей недели. */
export function weeksToSync(today) {
  const mon = T.monday(today);
  const out = [];
  for (let w = 0; w < 2; w++) for (let d = 0; d < 6; d++) out.push(T.addDays(mon, w * 7 + d));
  return out;
}

/** Тихо докачивает дни; возвращает изменения (сегодня и дальше). */
export async function prefetch(days, today) {
  const changes = [];
  for (const d of days) {
    try {
      const r = await loadDay(d);
      if (r.change && T.dayStart(d) >= T.dayStart(today)) changes.push([d, r.change]);
    } catch { /* нет сети */ }
  }
  // Удаляем дни старше двух недель — хранилище не растёт.
  const limit = T.addDays(T.dayStart(today), -KEEP_DAYS);
  for (const k of store.keys()) {
    if (k.startsWith('day_') && T.parseIso(k.slice(4)) < limit) store.del(k);
  }
  return changes;
}

export function clearScheduleCache() {
  for (const k of store.keys()) if (k.startsWith('day_') || k === 'baseline') store.del(k);
}

// ---------------- Автобусы ----------------

const TGT = 'https://api.tgt72.ru/api/v5';
const ymd = (t) => T.iso(t).replace(/-/g, '');

let network = null;
let loadingNet = null;

/** Сеть маршрутов на сегодня: память → localStorage → загрузка (~130 запросов, раз в день). */
export async function getNetwork(onProgress = () => {}) {
  const today = T.iso(T.now());
  if (network && network.data.date === today) return network;
  const saved = store.get('network');
  if (saved && saved.date === today) return (network = new Network(saved));
  if (!loadingNet) {
    loadingNet = downloadNetwork(onProgress).finally(() => { loadingNet = null; });
  }
  try {
    const data = await loadingNet;
    if (!store.set('network', data)) store.del('network'); // если не влезло — просто не кэшируем
    return (network = new Network(data));
  } catch (e) {
    if (saved) return (network = new Network(saved)); // вчерашние данные лучше, чем ничего
    throw e;
  }
}

async function downloadNetwork(onProgress) {
  const now = T.now();
  const today = T.iso(now);
  const routes = ((await getJson(`${TGT}/routesforsearch/`, 30000)) || {}).objects
    .filter((r) => !r.outdated && (!r.dates || !r.dates.length || r.dates.includes(today)));
  const cps = ((await getJson(`${TGT}/checkpointsforsearch/`, 60000)) || {}).objects
    .filter((c) => c.coordinate && c.coordinate.length >= 2);
  const byId = new Map(cps.map((c) => [c.id, c]));

  const patterns = [];
  let done = 0, next = 0;
  onProgress(0, routes.length);
  async function worker() {
    while (next < routes.length) {
      const r = routes[next++];
      try {
        const list = ((await getJson(`${TGT}/routecheckpoint/?route_id=${r.id}&date=${ymd(now)}`)) || {}).objects || [];
        for (const fwd of [true, false]) {
          let items = list.filter((o) => (o.forward ?? true) === fwd);
          const prim = items.filter((o) => o.primary ?? true);
          if (prim.length) items = prim;
          const ord = [];
          for (const o of items.sort((a, b) => (a.order ?? 0) - (b.order ?? 0))) {
            if (byId.has(o.checkpoint_id) && ord[ord.length - 1] !== o.checkpoint_id) ord.push(o.checkpoint_id);
          }
          if (ord.length >= 2) patterns.push({ routeId: r.id, routeName: r.name, forward: fwd, stops: ord });
        }
      } catch { /* пропускаем маршрут */ }
      onProgress(++done, routes.length);
    }
  }
  await Promise.all(Array.from({ length: 8 }, worker));
  if (!patterns.length) throw new Error('Сервер не вернул маршруты');
  const used = new Set(patterns.flatMap((p) => p.stops));
  const stops = [...used].map((id) => {
    const c = byId.get(id);
    return { id, name: (c.name || '').trim(), desc: (c.description || '').trim(), lat: c.coordinate[1], lon: c.coordinate[0] };
  });
  return { date: today, stops, patterns };
}

// Были ли сетевые ошибки при последнем обновлении (сервер недоступен, например из-за VPN)
export const netHealth = { errors: false };

// Онлайн-прогнозы (кэш 20 с)
const live = new Map();

function predToT(s, now) {
  const [h, m, sec = 0] = s.split(':').map(Number);
  let t = T.dayStart(now) + (h * 3600 + m * 60 + sec) * 1000;
  if (t < now - 3 * 3600e3) t += 864e5; // «00:10», когда сейчас 23:50
  return t;
}

export async function liveAt(stopId) {
  const c = live.get(stopId);
  if (c && Date.now() - c.at < 20000) return c.items;
  const now = T.now();
  let items = c ? c.items : [];
  try {
    const j = await getJson(`${TGT}/prediction/?checkpoint_id=${stopId}`, 8000);
    items = ((j && j.objects) || []).flatMap((p) => (p.order || [])
      .filter((o) => o.prediction && o.prediction.time)
      .map((o) => ({ routeId: p.route_id, time: predToT(o.prediction.time, now), precise: o.prediction.precise !== false })))
      .filter((a) => a.time >= now - 60e3)
      .sort((a, b) => a.time - b.time);
  } catch { netHealth.errors = true; /* оставляем старые */ }
  live.set(stopId, { at: Date.now(), items });
  return items;
}

export function invalidateLive() { live.clear(); }

// Расписание по графику (кэш на день)
const planned = new Map();
const plannedFailed = new Map(); // неудачные запросы не повторяем минуту

async function plannedTimes(stopId, routeId, forward, day) {
  const key = `${stopId}/${routeId}/${forward}/${T.iso(day)}`;
  if (planned.has(key)) return planned.get(key);
  if (Date.now() - (plannedFailed.get(key) || 0) < 60000) { netHealth.errors = true; return []; }
  let list = [];
  try {
    const objs = ((await getJson(`${TGT}/times/?checkpoint_id=${stopId}&route_id=${routeId}&date=${ymd(day)}`, 8000)) || {}).objects || [];
    const match = objs.filter((o) => (o.is_forward ?? true) === forward);
    const base = T.dayStart(day);
    list = (match.length ? match : objs).flatMap((o) => o.times || [])
      .map((s) => { const [h, m] = s.split(':').map(Number); return base + (h * 60 + m) * 60e3; })
      .sort((a, b) => a - b);
    planned.set(key, list);
  } catch { netHealth.errors = true; plannedFailed.set(key, Date.now()); }
  return list;
}

/** Сначала онлайн-прогноз, иначе — по графику. */
export const departureSource = {
  async next(stopId, routeId, forward, after) {
    const lt = (await liveAt(stopId)).filter((a) => a.routeId === routeId);
    const l = lt.find((a) => a.time >= after);
    if (l) return { time: l.time, live: true };
    const lastLive = lt.length ? lt[lt.length - 1].time : null;
    const pick = (list) => list.find((t) => t >= after && (lastLive == null || t > lastLive + 120e3));
    const t = pick(await plannedTimes(stopId, routeId, forward, after))
      ?? pick(await plannedTimes(stopId, routeId, forward, T.addDays(after, 1)));
    return t != null ? { time: t, live: false } : null;
  },
};

// ---------------- Геокодер (OpenStreetMap) ----------------

const NOMI = 'https://nominatim.openstreetmap.org';
const VIEWBOX = '65.25,57.28,65.80,57.02';

function toPlace(n) {
  const a = n.address || {};
  const street = [a.road, a.house_number].filter(Boolean).join(', ');
  const title = street || n.name || (n.display_name || '').split(',')[0];
  const sub = [a.suburb || a.neighbourhood || a.city_district, a.city || a.town || a.village]
    .filter(Boolean).filter((v, i, arr) => arr.indexOf(v) === i).join(', ');
  return { title, subtitle: sub, point: { lat: +n.lat, lon: +n.lon } };
}

export async function geoSearch(q) {
  q = q.trim();
  if (q.length < 3) return [];
  const full = /тюмен/i.test(q) ? q : `${q}, Тюмень`;
  const list = await getJson(`${NOMI}/search?format=jsonv2&addressdetails=1&limit=6&accept-language=ru&countrycodes=ru&viewbox=${VIEWBOX}&bounded=1&q=${encodeURIComponent(full)}`);
  const seen = new Set();
  return (list || []).map(toPlace).filter((p) => !seen.has(p.title + p.subtitle) && seen.add(p.title + p.subtitle));
}

export async function geoReverse(p) {
  try {
    const n = await getJson(`${NOMI}/reverse?format=jsonv2&addressdetails=1&zoom=18&accept-language=ru&lat=${p.lat}&lon=${p.lon}`);
    return n ? { ...toPlace(n), point: p } : null;
  } catch { return null; }
}
