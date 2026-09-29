// Интерфейс сайта: главный экран, расписание, автобусы, адрес, настройки.
import {
  T, fmt, formatLeft, buildTimeline, COLLEGE, COLLEGE_LABEL, ACCESS_RADIUS,
  findPlans, schedulePlan, rankJourneys, arriveBy, distM, walkM, walkMin,
} from './core.js';
import {
  store, cachedDay, loadDay, weeksToSync, prefetch, clearScheduleCache,
  getNetwork, liveAt, invalidateLive, departureSource, geoSearch, geoReverse, netHealth, usage, prefetchTimetables,
} from './data.js';

const $app = document.getElementById('app');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const WD = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'];

// Иконки (SVG, как в приложениях)
const svg = (d, size = 24) => `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
const I = {
  back: svg('<path d="M15 18l-6-6 6-6"/>'),
  next: svg('<path d="M9 18l6-6-6-6"/>'),
  refresh: svg('<path d="M21 12a9 9 0 1 1-3-6.7"/><path d="M21 3v6h-6"/>'),
  gear: svg('<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>'),
  home: svg('<path d="M3 11l9-8 9 8"/><path d="M5 10v10h14V10"/>'),
  calendar: svg('<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 10h18"/><path d="M9 15l2 2 4-4"/>', 32),
  bus: svg('<rect x="4" y="3" width="16" height="15" rx="3"/><path d="M4 11h16M8 18v3M16 18v3"/><circle cx="8" cy="14.5" r="1"/><circle cx="16" cy="14.5" r="1"/>', 32),
  pin: svg('<path d="M12 21s-7-6.2-7-11a7 7 0 0 1 14 0c0 4.8-7 11-7 11z"/><circle cx="12" cy="10" r="2.5"/>', 18),
};


// ---------------- Тема ----------------

function applyTheme() {
  const theme = store.get('theme', 'system');
  document.documentElement.dataset.theme = theme;
  const dark = theme === 'dark' || (theme === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
  document.querySelector('meta[name=theme-color]').content = dark ? '#121410' : '#F6F8F1';
}
matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', applyTheme);
applyTheme();

// ---------------- Навигация ----------------

let tick = null;        // функция, вызываемая каждую секунду на текущем экране
let cleanup = null;     // остановка таймеров экрана
const routes = { '': home, schedule, buses, address, settings };

function go(path) { location.hash = '#/' + path; }
window.addEventListener('hashchange', render);

function render() {
  if (cleanup) { cleanup(); cleanup = null; }
  tick = null;
  const path = location.hash.replace(/^#\/?/, '');
  (routes[path] || home)();
  window.scrollTo(0, 0);
}

setInterval(() => { if (tick && !document.hidden) tick(); }, 1000);

function topBar(title, subtitle, { back = true, actions = '' } = {}) {
  return `<header class="bar">
    ${back ? `<button class="icon" data-back aria-label="Назад">${I.back}</button>` : '<span class="icon-space"></span>'}
    <div class="bar-title"><div class="t">${esc(title)}</div>${subtitle != null ? `<div class="s" data-sub>${esc(subtitle)}</div>` : ''}</div>
    <div class="bar-actions">${actions}</div>
  </header>`;
}

document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-back]');
  if (b) { e.preventDefault(); if (history.length > 1) history.back(); else go(''); }
});

function toast(text) {
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = text;
  document.body.appendChild(el);
  setTimeout(() => el.classList.add('show'), 10);
  setTimeout(() => { el.classList.remove('show'); setTimeout(() => el.remove(), 400); }, 6000);
}

function notifyChanges(changes) {
  if (!changes || !changes.length) return;
  const pub = changes.filter((c) => c[1] === 'published').map((c) => c[0]).sort((a, b) => a - b);
  const chg = changes.filter((c) => c[1] === 'changed').map((c) => c[0]).sort((a, b) => a - b);
  const d = (t) => `${fmt.wdShort(t).toLowerCase()} ${fmt.dMon(t)}`;
  if (pub.length) toast(`Вышло новое расписание: ${pub.length === 1 ? d(pub[0]) : d(pub[0]) + ' – ' + d(pub[pub.length - 1])}`);
  if (chg.length) toast(`Изменения в расписании: ${chg.map(d).join(', ')}`);
}

// ---------------- Главный ----------------

function home() {
  const now = T.now();
  $app.innerHTML = `
    ${topBar('ТКПСТ', `Тюмень · ${fmt.wdLong(now)}, ${fmt.dMonth(now)} · ${T.hm(now)}`, {
      back: false, actions: `<button class="icon" data-go="settings" aria-label="Настройки">${I.gear}</button>` })}
    <main class="home">
      <a class="big primary" href="#/schedule">
        <span class="big-icon">${I.calendar}</span>
        <span><span class="big-t">Расписание</span><span class="big-s">Пары группы ИС-25-3С</span></span>
      </a>
      <a class="big secondary" href="#/buses">
        <span class="big-icon">${I.bus}</span>
        <span><span class="big-t">Автобусы</span><span class="big-s">Дом ↔ Луначарского, 19 · онлайн</span></span>
      </a>
    </main>`;
  $app.querySelector('[data-go=settings]').onclick = () => go('settings');
  tick = () => {
    const n = T.now();
    $app.querySelector('[data-sub]').textContent = `Тюмень · ${fmt.wdLong(n)}, ${fmt.dMonth(n)} · ${T.hm(n)}`;
  };
  // Тихо обновляем расписание на две недели и сообщаем об изменениях.
  prefetch(weeksToSync(now), now).then(notifyChanges);
}

// ---------------- Расписание ----------------

const sched = {
  selected: T.dayStart(T.now()),
  weekStart: T.monday(T.now()),
  state: { kind: 'loading' },
  refreshing: false,
  seq: 0,
};

function schedule() {
  $app.innerHTML = `
    ${topBar('Расписание', '', { actions: `<button class="icon" data-refresh aria-label="Обновить">${I.refresh}</button>` })}
    <div class="week">
      <div class="week-head">
        <button class="icon" data-prev aria-label="Прошлая неделя">${I.back}</button>
        <div class="week-range" data-range></div>
        <button class="icon" data-next aria-label="Следующая неделя">${I.next}</button>
      </div>
      <div class="chips" data-chips></div>
      <div class="today-row" data-todayrow></div>
    </div>
    <main class="list" data-list></main>`;
  $app.querySelector('[data-prev]').onclick = () => shiftWeek(-1);
  $app.querySelector('[data-next]').onclick = () => shiftWeek(1);
  $app.querySelector('[data-refresh]').onclick = () => loadSelected(true);

  let lastToday = T.dayStart(T.now());
  tick = () => {
    const now = T.now();
    // В полночь сами переезжаем на новый день.
    if (T.dayStart(now) !== lastToday) {
      if (sched.selected === lastToday) selectDay(T.dayStart(now));
      lastToday = T.dayStart(now);
    }
    $app.querySelector('[data-sub]').textContent = `ИС-25-3С · сейчас ${T.hm(now)}`;
    renderWeek();
    renderList(false);
  };
  const onVis = () => { if (!document.hidden) loadSelected(); };
  document.addEventListener('visibilitychange', onVis);
  cleanup = () => document.removeEventListener('visibilitychange', onVis);

  tick();
  loadSelected();
  const now = T.now();
  prefetch(weeksToSync(now).filter((d) => d !== sched.selected), now).then(notifyChanges);
}

function selectDay(d) {
  sched.selected = T.dayStart(d);
  sched.weekStart = T.monday(sched.selected);
  loadSelected();
  renderWeek();
}

function shiftWeek(n) {
  const newStart = T.addDays(sched.weekStart, 7 * n);
  const today = T.dayStart(T.now());
  const wd = T.weekday(sched.selected);
  if (T.monday(today) === newStart && T.weekday(today) !== 7) selectDay(today);
  else selectDay(T.addDays(newStart, wd === 7 ? 0 : wd - 1));
}

function loadSelected(user = false) {
  const day = sched.selected;
  const seq = ++sched.seq;
  if (T.weekday(day) === 7) { sched.state = { kind: 'sunday' }; renderList(true); return; }
  const c = cachedDay(day);
  sched.state = c ? { kind: 'loaded', data: c } : { kind: 'loading' };
  sched.refreshing = !!c || user;
  renderList(true);
  loadDay(day).then((d) => {
    if (seq !== sched.seq) return;
    sched.state = { kind: 'loaded', data: d };
  }).catch(() => {
    if (seq !== sched.seq) return;
    const c2 = cachedDay(day);
    sched.state = c2 ? { kind: 'loaded', data: c2 } : { kind: 'error' };
  }).finally(() => {
    if (seq !== sched.seq) return;
    sched.refreshing = false;
    renderList(true);
  });
}

function renderWeek() {
  const today = T.dayStart(T.now());
  const range = $app.querySelector('[data-range]');
  if (!range) return;
  range.textContent = `${fmt.dMon(sched.weekStart)} – ${fmt.dMon(T.addDays(sched.weekStart, 5))}`;
  const chips = $app.querySelector('[data-chips]');
  const html = WD.map((name, i) => {
    const d = T.addDays(sched.weekStart, i);
    const cls = ['chip', d === sched.selected ? 'sel' : '', d === today ? 'today' : ''].join(' ');
    return `<button class="${cls}" data-day="${d}"><span>${name}</span><b>${T.dayNum(d)}</b><i></i></button>`;
  }).join('');
  if (chips.dataset.html !== html) {
    chips.innerHTML = html;
    chips.dataset.html = html;
    chips.querySelectorAll('[data-day]').forEach((b) => { b.onclick = () => selectDay(+b.dataset.day); });
  }
  const row = $app.querySelector('[data-todayrow]');
  const want = sched.selected !== today
    ? `<button class="link" data-today>${T.weekday(today) === 7 ? 'К сегодня (воскресенье)' : 'К сегодняшнему дню'}</button>` : '';
  if (row.dataset.html !== want) {
    row.innerHTML = want;
    row.dataset.html = want;
    const b = row.querySelector('[data-today]');
    if (b) b.onclick = () => selectDay(today);
  }
  const r = $app.querySelector('[data-refresh]');
  if (r) r.classList.toggle('spin', sched.refreshing);
}

function msg(title, text, action) {
  return `<div class="msg"><h2>${esc(title)}</h2><p>${esc(text)}</p>${action || ''}</div>`;
}

function phaseOf(e, isToday, nowMin) {
  if (!isToday) return 'other';
  if (nowMin >= e.end) return 'past';
  if (nowMin >= e.start) return 'now';
  return 'future';
}

const secsTo = (targetMin, nowMin) => Math.ceil((targetMin - nowMin) * 60);
const pct = (e, nowMin) => Math.max(0, Math.min(100, ((nowMin - e.start) / (e.end - e.start)) * 100));

function timerLine(e, phase, nowMin) {
  if (phase === 'future') return `<div class="timer">Начнётся через ${formatLeft(secsTo(e.start, nowMin))}</div>`;
  if (phase === 'now') return `<div class="timer strong">Закончится через ${formatLeft(secsTo(e.end, nowMin))}</div>
    <div class="progress"><div style="width:${pct(e, nowMin).toFixed(1)}%"></div></div>`;
  if (phase === 'past') return '<div class="timer past">Прошла</div>';
  return '';
}

function lessonHtml(l) {
  return `<div class="lesson">
    ${l.replaced ? '<span class="tag">Замена</span>' : ''}
    ${l.replaced && l.oldTitle ? `<div class="old">${esc(l.oldTitle)}</div>` : ''}
    <div class="subject">${esc(l.title || 'Без названия')}</div>
    <div class="line">${l.oldCabinet ? `<s class="muted">каб. ${esc(l.oldCabinet)}</s> ` : ''}${l.cabinet ? 'Кабинет ' + esc(l.cabinet) : 'Кабинет не указан'}</div>
    ${l.oldTeacher ? `<div class="line"><s class="muted">${esc(l.oldTeacher)}</s></div>` : ''}
    ${l.teacher ? `<div class="line muted">${esc(l.teacher)}</div>` : ''}
  </div>`;
}

function entryHtml(e, phase, nowMin) {
  const cls = `phase-${phase}`;
  if (e.type === 'pair') {
    return `<article class="card pair ${cls}" id="e${e.start}">
      <div class="num"><b>${e.number}</b><span>пара</span></div>
      <div class="body">
        <div class="time">${T.hmMin(e.start)} – ${T.hmMin(e.end)}</div>
        ${e.lessons.map(lessonHtml).join('')}
        ${timerLine(e, phase, nowMin)}
      </div>
    </article>`;
  }
  if (e.type === 'ch') {
    return `<article class="card ch ${cls}" id="e${e.start}">
      <div class="time">Классный час · ${T.hmMin(e.start)} – ${T.hmMin(e.end)}</div>
      <div class="subject">${esc(e.title)}</div>
      ${e.cabinet ? `<div class="line">Кабинет ${esc(e.cabinet)}</div>` : ''}
      ${timerLine(e, phase, nowMin)}
    </article>`;
  }
  const mins = e.end - e.start;
  const label = e.kind === 'short' ? `Перерыв ${mins} мин` : e.kind === 'big' ? `Большой перерыв ${mins} мин` : `Окно · ${formatLeft(mins * 60)}`;
  return `<div class="brk ${cls}" id="e${e.start}">
    <div class="brk-row"><span>${label}</span><span class="muted">${T.hmMin(e.start)}–${T.hmMin(e.end)}</span></div>
    ${phase === 'now' ? `<div class="timer strong">Закончится через ${formatLeft(secsTo(e.end, nowMin))}</div>
      <div class="progress thin"><div style="width:${pct(e, nowMin).toFixed(1)}%"></div></div>` : ''}
  </div>`;
}

function renderList(scroll) {
  const list = $app.querySelector('[data-list]');
  if (!list) return;
  const now = T.now();
  const today = T.dayStart(now);
  const isToday = sched.selected === today;
  const nowMin = T.minuteOfDay(now);
  const s = sched.state;
  let html;
  if (s.kind === 'sunday') html = msg('Выходной', 'В воскресенье пар нет. Отдыхай 🙂');
  else if (s.kind === 'loading') html = '<div class="msg"><div class="spinner"></div></div>';
  else if (s.kind === 'error') html = msg('Не удалось загрузить', 'Нет соединения с сервером расписания', '<button class="btn" data-retry>Повторить</button>');
  else {
    const entries = buildTimeline(T.weekday(sched.selected), s.data.lessons);
    if (!entries.length) {
      html = s.data.notPublished
        ? msg('Расписания ещё нет', 'Колледж пока не опубликовал пары на этот день.')
        : msg('Пар нет', 'На этот день занятий не найдено.');
    } else {
      const parts = [];
      if (s.data.offline) {
        const at = s.data.savedAt ? T.fromReal(s.data.savedAt) : null;
        parts.push(`<div class="note">Нет сети — показано сохранённое расписание${at ? ` (${fmt.dMon(at)}, ${T.hm(at)})` : ''}</div>`);
      }
      if (isToday) {
        const first = entries[0].start, last = entries[entries.length - 1].end;
        const t = nowMin < first ? `До начала занятий ${formatLeft(secsTo(first, nowMin))}`
          : nowMin >= last ? 'Занятия на сегодня закончились'
            : `Занятия закончатся через ${formatLeft(secsTo(last, nowMin))} (в ${T.hmMin(last)})`;
        parts.push(`<div class="summary">${t}</div>`);
      }
      entries.forEach((e) => parts.push(entryHtml(e, phaseOf(e, isToday, nowMin), nowMin)));
      html = parts.join('');
    }
  }
  if (list.dataset.html === html) return;
  list.innerHTML = html;
  list.dataset.html = html;
  const retry = list.querySelector('[data-retry]');
  if (retry) retry.onclick = () => loadSelected(true);
  if (scroll && isToday && s.kind === 'loaded') {
    const entries = buildTimeline(T.weekday(sched.selected), s.data.lessons);
    const cur = entries.find((x) => nowMin < x.end);
    const el = cur && list.querySelector('#e' + cur.start);
    if (el && cur !== entries[0]) el.scrollIntoView({ block: 'start' });
  }
  renderWeek();
}

// ---------------- Автобусы ----------------

const bus = {
  direction: null,
  sort: 'duration',
  // Когда ехать: сейчас / выехать в / приехать к (как в 2ГИС)
  when: { mode: 'now', day: 0, time: '08:00' },
  state: { kind: 'searching' },
  plans: [],
  plansKey: null,
  seq: 0,
  refreshing: false,
};

function autoDirection() {
  const now = T.now();
  const c = cachedDay(now);
  const entries = buildTimeline(T.weekday(now), c ? c.lessons : []);
  const end = entries.length ? entries[entries.length - 1].end : 14 * 60;
  return T.minuteOfDay(now) < end ? 'toCollege' : 'toHome';
}

const toMin = (hhmm) => { const [h, m] = hhmm.split(':').map(Number); return h * 60 + m; };

/** Выбранный момент (тюменское время, мс) для режимов «выехать в» / «приехать к». */
function whenTarget() {
  return T.dayStart(T.now()) + bus.when.day * 864e5 + toMin(bus.when.time) * 60e3;
}

/** Подсказка: к первой паре (в колледж) или после последней пары (домой). */
function quickWhen() {
  const now = T.now();
  for (let add = 0; add < 7; add++) {
    const day = T.addDays(T.dayStart(now), add);
    if (T.weekday(day) === 7 || add > 1) continue; // только сегодня/завтра
    const c = cachedDay(day);
    const entries = buildTimeline(T.weekday(day), c ? c.lessons : []);
    if (!entries.length) continue;
    if (bus.direction === 'toCollege') {
      const start = entries[0].start;
      if (day + start * 60e3 < now + 20 * 60e3) continue; // уже не успеть — смотрим завтра
      const title = entries[0].type === 'ch' ? 'К классному часу' : `К ${entries[0].number}-й паре`;
      return { mode: 'arrive', day: add, time: T.hmMin(start - 5), label: `${title} · ${T.hmMin(start)}${add ? ' завтра' : ''}` };
    }
    const end = entries[entries.length - 1].end;
    if (day + end * 60e3 < now) continue;
    return { mode: 'depart', day: add, time: T.hmMin(end + 5), label: `После пар · ${T.hmMin(end)}${add ? ' завтра' : ''}` };
  }
  return null;
}

function buses() {
  if (!bus.direction) bus.direction = autoDirection();
  const home = store.get('home');
  $app.innerHTML = `
    ${topBar('Автобусы', '', { actions: `<button class="icon" data-refresh aria-label="Обновить">${I.refresh}</button><button class="icon" data-addr aria-label="Домашний адрес">${I.home}</button>` })}
    <div data-bushead></div>
    <main class="list" data-buslist></main>`;
  $app.querySelector('[data-addr]').onclick = () => go('address');
  $app.querySelector('[data-refresh]').onclick = () => refreshBus(true);

  if (!home) {
    $app.querySelector('[data-buslist]').innerHTML = msg('Укажи домашний адрес',
      'Нужен, чтобы найти остановки рядом с домом и автобусы до колледжа и обратно. Адрес хранится только на телефоне.',
      '<button class="btn" data-setaddr>Указать адрес</button>');
    $app.querySelector('[data-setaddr]').onclick = () => go('address');
    tick = () => { $app.querySelector('[data-sub]').textContent = `Тюмень · сейчас ${T.hm(T.now())}`; };
    tick();
    return;
  }
  renderBusHead(home);
  tick = () => {
    $app.querySelector('[data-sub]').textContent = `Тюмень · сейчас ${T.hm(T.now())}`;
    renderBusList();
  };
  tick();
  refreshBus(true, true);
  // «Сейчас» — каждые 30 с (онлайн), для «выехать в / приехать к» хватит раз в 2 минуты
  let lastAuto = Date.now();
  const timer = setInterval(() => {
    if (document.hidden) return;
    const every = bus.when.mode === 'now' ? 30000 : 120000;
    if (Date.now() - lastAuto >= every) { lastAuto = Date.now(); refreshBus(true); }
  }, 5000);
  const onVis = () => { if (!document.hidden) refreshBus(true); };
  document.addEventListener('visibilitychange', onVis);
  cleanup = () => { clearInterval(timer); document.removeEventListener('visibilitychange', onVis); };
}

/** Если выбранное время сегодня уже прошло — значит, имеется в виду завтра. */
function normalizeWhen() {
  const w = bus.when;
  if (w.mode !== 'now' && w.day === 0 && whenTarget() < T.now()) w.day = 1;
}

function renderBusHead(home) {
  normalizeWhen();
  const head = $app.querySelector('[data-bushead]');
  const from = bus.direction === 'toCollege' ? home.label : COLLEGE_LABEL;
  const to = bus.direction === 'toCollege' ? COLLEGE_LABEL : home.label;
  const w = bus.when;
  const quick = quickWhen();
  const on = (c) => (c ? 'on' : '');
  head.innerHTML = `<div class="bushead">
    <div class="seg">
      <button class="${on(bus.direction === 'toCollege')}" data-dir="toCollege">В колледж</button>
      <button class="${on(bus.direction === 'toHome')}" data-dir="toHome">Домой</button>
    </div>
    <div class="fromto">${esc(from)} → ${esc(to)}</div>
    <div class="seg three">
      <button class="${on(w.mode === 'now')}" data-mode="now">Сейчас</button>
      <button class="${on(w.mode === 'depart')}" data-mode="depart">Выехать в</button>
      <button class="${on(w.mode === 'arrive')}" data-mode="arrive">Приехать к</button>
    </div>
    ${w.mode !== 'now' ? `<div class="whenrow">
      <div class="seg mini">
        <button class="${on(w.day === 0)}" data-wday="0">Сегодня</button>
        <button class="${on(w.day === 1)}" data-wday="1">Завтра</button>
      </div>
      <input class="timein" type="time" data-time value="${w.time}" step="300">
    </div>` : ''}
    <div class="sorts">
      ${quick ? `<button class="pill quick" data-quick>${esc(quick.label)}</button>` : ''}
      ${w.mode !== 'arrive' ? `
      <button class="pill ${on(bus.sort === 'duration')}" data-sort="duration">Меньше в пути</button>
      <button class="pill ${on(bus.sort === 'arrival')}" data-sort="arrival">Раньше приеду</button>` : ''}
    </div>
  </div>`;
  const redo = (spinner = true) => { renderBusHead(home); refreshBus(false, spinner); };
  head.querySelectorAll('[data-dir]').forEach((b) => {
    b.onclick = () => { if (bus.direction !== b.dataset.dir) { bus.direction = b.dataset.dir; redo(); } };
  });
  head.querySelectorAll('[data-sort]').forEach((b) => {
    b.onclick = () => { if (bus.sort !== b.dataset.sort) { bus.sort = b.dataset.sort; redo(false); } };
  });
  head.querySelectorAll('[data-mode]').forEach((b) => {
    b.onclick = () => {
      const mode = b.dataset.mode;
      if (w.mode === mode) return;
      if (mode !== 'now' && w.mode === 'now') {
        // Разумное время по умолчанию: подсказка по расписанию или через час
        const q = quickWhen();
        if (q && q.mode === mode) { w.day = q.day; w.time = q.time; }
        else {
          const t = T.now() + 3600e3;
          w.day = T.dayStart(t) > T.dayStart(T.now()) ? 1 : 0;
          w.time = T.hmMin(Math.floor(T.minuteOfDay(t) / 5) * 5);
        }
      }
      w.mode = mode;
      redo();
    };
  });
  head.querySelectorAll('[data-wday]').forEach((b) => {
    b.onclick = () => { if (w.day !== +b.dataset.wday) { w.day = +b.dataset.wday; redo(); } };
  });
  const ti = head.querySelector('[data-time]');
  if (ti) ti.onchange = () => { if (ti.value) { w.time = ti.value; redo(); } };
  const qb = head.querySelector('[data-quick]');
  if (qb) qb.onclick = () => { Object.assign(w, { mode: quick.mode, day: quick.day, time: quick.time }); redo(); };
}

async function refreshBus(force = false, spinner = false) {
  const home = store.get('home');
  if (!home) return;
  const seq = ++bus.seq;
  if (force) invalidateLive();
  if (spinner || bus.state.kind !== 'ready') bus.state = { kind: 'searching' };
  bus.refreshing = true;
  renderBusList();
  const dir = bus.direction, sort = bus.sort;
  try {
    const net = await getNetwork((done, total) => {
      if (seq === bus.seq && bus.state.kind !== 'ready') { bus.state = { kind: 'network', done, total }; renderBusList(); }
    });
    if (seq !== bus.seq) return;
    const [from, to] = dir === 'toCollege' ? [home.point, COLLEGE] : [COLLEGE, home.point];
    const key = `${net.data.date}|${dir}|${home.point.lat},${home.point.lon}`;
    if (key !== bus.plansKey) {
      if (bus.state.kind !== 'ready') { bus.state = { kind: 'searching' }; renderBusList(); }
      await new Promise((r) => setTimeout(r, 30)); // дать интерфейсу отрисоваться
      bus.plans = findPlans(net, from, to);
      bus.plansKey = key;
    }
    const now = T.now();
    netHealth.errors = false;
    usage.saved = false;
    const w = { ...bus.when };
    const target = w.mode === 'now' ? now : whenTarget();
    if (w.mode === 'arrive' && target <= now + 5 * 60e3) {
      bus.state = { kind: 'ready', journeys: [], boards: [], updatedAt: now, noStops: false, past: true, when: w, target };
    } else {
      await Promise.all([...new Set(bus.plans.flatMap((p) => p.legs.map((l) => l.from.id)))].map(liveAt));
      let js;
      if (w.mode === 'arrive') {
        js = await Promise.all(bus.plans.map((p) => arriveBy(p, target, now, departureSource).catch(() => null)));
      } else {
        const base = Math.max(now, target);
        js = await Promise.all(bus.plans.map((p) => schedulePlan(p, base, departureSource).catch(() => null)));
      }
      const base = w.mode === 'depart' ? Math.max(now, target) : now;
      const ranked = rankJourneys(js.filter(Boolean), w.mode === 'arrive' ? 'latest' : sort, base, 5);
      // «Ближайшие автобусы» имеют смысл только для «сейчас»
      const boards = w.mode === 'now' ? await stopBoards(net, from, ranked, now) : [];
      if (seq !== bus.seq) return;
      if (!ranked.length && netHealth.errors) throw new Error('unreachable');
      // Докачиваем и сохраняем график нужных остановок — чтобы поиск работал и без сервера
      const archiveStops = bus.plans.flatMap((p) => p.legs.map((l) => l.from.id));
      setTimeout(() => {
        prefetchTimetables(archiveStops, now).then(() => prefetchTimetables(archiveStops, T.addDays(now, 1))).catch(() => {});
      }, 3000);
      bus.state = { kind: 'ready', journeys: ranked, boards, updatedAt: now, when: w, target, usedSaved: usage.saved,
        noStops: !bus.plans.length && !net.near(from, ACCESS_RADIUS).length };
    }
  } catch {
    if (seq !== bus.seq) return;
    bus.state = { kind: 'error' };
  }
  bus.refreshing = false;
  renderBusList();
}

async function stopBoards(net, from, journeys, now) {
  const useful = new Set();
  for (const j of journeys) {
    useful.add(j.legs[0].leg.routeName);
    if (j.legs.length === 1) j.alternatives.forEach((a) => useful.add(a));
  }
  const chosen = [];
  for (const j of journeys) {
    const s = j.legs[0].leg.from;
    if (chosen.length < 3 && !chosen.some((c) => c.id === s.id)) chosen.push(s);
  }
  const covered = new Set(chosen.flatMap((s) => [...net.routesAt(s.id)]));
  for (const [s] of net.near(from, ACCESS_RADIUS)) {
    if (chosen.length >= 3) break;
    if (chosen.some((c) => c.id === s.id)) continue;
    const r = net.routesAt(s.id);
    if (chosen.length < 2 || [...r].some((x) => !covered.has(x))) { chosen.push(s); r.forEach((x) => covered.add(x)); }
  }
  return Promise.all(chosen.map(async (s) => {
    const items = await liveAt(s.id);
    const byRoute = new Map();
    for (const a of items) {
      if (a.time < now - 60e3) continue;
      const name = net.routeNames.get(a.routeId) || '?';
      if (!byRoute.has(name)) byRoute.set(name, []);
      byRoute.get(name).push(a.time);
    }
    const arrivals = [...byRoute].map(([name, times]) => ({ name, times: times.slice(0, 3), useful: useful.has(name) }))
      .sort((a, b) => (b.useful - a.useful) || (a.times[0] - b.times[0]));
    const d = distM(from.lat, from.lon, s.lat, s.lon);
    return { stop: s, walkMin: walkMin(d), walkM: walkM(d), arrivals };
  }));
}

const until = (now, t) => { const s = Math.round((t - now) / 1000); return s <= 30 ? 'сейчас' : 'через ' + formatLeft(s); };
const short = (now, t) => { const s = Math.round((t - now) / 1000); return s < 60 ? 'сейчас' : Math.ceil(s / 60) + ' мин'; };
const mins = (m) => Math.max(1, Math.floor(m));
const badge = (name, on = true) => `<span class="route ${on ? '' : 'off'}">${esc(name)}</span>`;

function journeyHtml(j, now, dir, st = {}) {
  const target = dir === 'toCollege' ? 'колледжа' : 'дома';
  const leaveS = Math.round((j.leaveAt - now) / 1000);
  const step = (t, sub) => `<div class="step"><i></i><div><div>${t}</div>${sub ? `<div class="muted small">${esc(sub)}</div>` : ''}</div></div>`;
  const legsHtml = j.legs.map((tl, i) => {
    let s = '';
    if (i > 0) {
      const tw = j.plan.transferWalk;
      s += tw && tw.meters >= 30
        ? step(`Пересадка: пешком ${mins(tw.minutes)} мин · ${tw.meters} м до «${esc(tl.leg.from.name)}»`, tl.leg.from.desc)
        : step(`Пересадка на той же остановке «${esc(tl.leg.from.name)}»`);
    }
    const ride = Math.max(1, Math.round((tl.alight - tl.board) / 60e3));
    s += `<div class="busstep">${badge(tl.leg.routeName)}<div>
      <div><b class="accent">${tl.board - now > 3 * 3600e3 ? `в ${T.hm(tl.board)}${T.dayStart(tl.board) > T.dayStart(now) ? ' завтра' : ''}` : `${until(now, tl.board)} · ${T.hm(tl.board)}`}</b> <span class="tag ${tl.live ? 'live' : ''}">${tl.live ? 'онлайн' : tl.saved ? 'по сохр. графику' : 'по графику'}</span></div>
      <div class="muted small">Проезд ~${ride} мин, ${tl.leg.stopsCount} ост. до «${esc(tl.leg.to.name)}»</div>
    </div></div>`;
    return s;
  }).join('');
  return `<article class="card journey">
    <div class="jhead">
      <div><div class="big-num">${j.durationMin} мин</div><div class="muted small">в пути · ${j.legs.length === 1 ? 'без пересадок' : '1 пересадка'}</div></div>
      <div class="right"><div class="muted small">прибытие</div><div class="arr">${T.hm(j.arrive)}</div>
        ${st.when && st.when.mode === 'arrive' ? `<div class="muted small">запас ${Math.max(0, Math.floor((st.target - j.arrive) / 60e3))} мин</div>` : ''}</div>
    </div>
    <div class="routes">${j.legs.map((l, i) => (i ? '<span class="muted">→</span>' : '') + badge(l.leg.routeName)).join('')}
      ${j.alternatives.length ? `<span class="muted small">или ${j.alternatives.slice(0, 5).map((a) => '№' + esc(a)).join(', ')}</span>` : ''}</div>
    <div class="leave">${leaveS <= 30 ? 'Выходи сейчас' : leaveS > 3 * 3600
      ? `Выходи в ${T.hm(j.leaveAt)}${T.dayStart(j.leaveAt) > T.dayStart(now) ? ' завтра' : ''}`
      : `Выходи через ${formatLeft(leaveS)} (в ${T.hm(j.leaveAt)})`}</div>
    ${step(`Пешком ${mins(j.plan.walkStart.minutes)} мин · ${j.plan.walkStart.meters} м до «${esc(j.legs[0].leg.from.name)}»`, j.legs[0].leg.from.desc)}
    ${legsHtml}
    ${step(`Пешком ${mins(j.plan.walkEnd.minutes)} мин · ${j.plan.walkEnd.meters} м до ${target}`)}
  </article>`;
}

function boardHtml(b, now) {
  return `<article class="card board">
    <div class="jhead"><div><div class="subject">${esc(b.stop.name)}</div>${b.stop.desc ? `<div class="muted small">${esc(b.stop.desc)}</div>` : ''}</div>
      <div class="muted small nowrap">${mins(b.walkMin)} мин пешком</div></div>
    ${b.arrivals.length ? b.arrivals.map((a) => `<div class="arrow-row">${badge(a.name, a.useful)}<span class="${a.useful ? 'strong' : ''}">${a.times.map((t) => short(now, t)).join(' · ')}</span></div>`).join('')
      : '<div class="muted small">Нет онлайн-данных по этой остановке</div>'}
    ${b.arrivals.some((a) => a.useful) ? '<div class="muted tiny">Выделены номера, которые идут в нужную сторону</div>' : ''}
  </article>`;
}

function renderBusList() {
  const list = $app.querySelector('[data-buslist]');
  if (!list || !store.get('home')) return;
  const r = $app.querySelector('[data-refresh]');
  if (r) r.classList.toggle('spin', bus.refreshing);
  const s = bus.state, now = T.now();
  let html;
  if (s.kind === 'network') {
    html = `<div class="msg"><h3>Загружаю маршруты города</h3>
      <div class="progress"><div style="width:${s.total ? (s.done / s.total * 100).toFixed(0) : 0}%"></div></div>
      <p>${s.done} из ${s.total} · это делается один раз в день</p></div>`;
  } else if (s.kind === 'searching') {
    html = '<div class="msg"><div class="spinner"></div><p>Ищу маршруты…</p></div>';
  } else if (s.kind === 'error') {
    html = msg('Сервер Тюменьгортранса не отвечает',
      'А сохранённого графика для этих остановок пока нет. Попробуй позже — после первого удачного поиска график сохранится и будет работать даже без сервера.',
      '<button class="btn" data-retry>Повторить</button>');
  } else {
    const parts = [];
    if (s.past) {
      parts.push('<div class="note">Это время уже прошло или слишком близко. Выбери время позже или «Завтра».</div>');
    } else if (!s.journeys.length) {
      parts.push(`<div class="note">${s.noStops ? 'В радиусе километра нет остановок.'
        : s.when && s.when.mode !== 'now' ? 'К этому времени подходящих рейсов не нашлось. Попробуй другое время.'
          : 'Сейчас не нашлось автобусов по этому направлению (возможно, уже ночь). Посмотри ближайшие автобусы ниже.'}</div>`);
    } else {
      const title = s.when && s.when.mode === 'arrive' ? `Чтобы успеть к ${T.hm(s.target)}${T.dayStart(s.target) > T.dayStart(now) ? ' завтра' : ''}`
        : s.when && s.when.mode === 'depart' ? `Выезд в ${T.hm(s.target)}${T.dayStart(s.target) > T.dayStart(now) ? ' завтра' : ''}` : 'Лучшие маршруты';
      parts.push(`<h3 class="section">${title}</h3>`);
      s.journeys.forEach((j) => parts.push(journeyHtml(j, now, bus.direction, s)));
    }
    if (s.boards.length) {
      parts.push('<h3 class="section">Ближайшие автобусы</h3>');
      s.boards.forEach((b) => parts.push(boardHtml(b, now)));
    }
    if (s.usedSaved) parts.push('<div class="note">Сервер Тюменьгортранса сейчас не отвечает — время показано по сохранённому графику, без онлайн-прогноза.</div>');
    parts.push(`<p class="muted tiny foot">Обновлено в ${T.hm(s.updatedAt)} · онлайн-данные Тюменьгортранса, обновление каждые 30 с. Время в пути — примерное.</p>`);
    html = parts.join('');
  }
  if (list.dataset.html === html) return;
  list.innerHTML = html;
  list.dataset.html = html;
  const retry = list.querySelector('[data-retry]');
  if (retry) retry.onclick = () => refreshBus(true, true);
}

// ---------------- Домашний адрес ----------------

function address() {
  const home = store.get('home');
  $app.innerHTML = `
    ${topBar('Домашний адрес', null)}
    <main class="list form">
      ${home ? `<p class="muted">Сейчас: ${esc(home.label)}</p>` : ''}
      <label class="field"><input data-q type="search" placeholder="Улица и дом, например «Широтная 100»" autocomplete="off" enterkeyhint="search"><span class="spinner small" data-qspin hidden></span></label>
      <button class="btn outline" data-gps>${I.pin} Я сейчас дома — определить по GPS</button>
      <div data-gpsres></div>
      <div class="error" data-err></div>
      <div class="results" data-res></div>
      <p class="muted tiny">Адрес хранится только на телефоне. Поиск адресов — OpenStreetMap.</p>
    </main>`;
  const q = $app.querySelector('[data-q]');
  const res = $app.querySelector('[data-res]');
  const err = $app.querySelector('[data-err]');
  const spin = $app.querySelector('[data-qspin]');
  let timer = null, seq = 0;

  const save = (p) => {
    const label = p.title === 'Точка по GPS' ? `${p.title} (${p.subtitle})` : p.title;
    store.set('home', { label, point: p.point });
    bus.plansKey = null;
    toast('Домашний адрес сохранён');
    if (history.length > 1) history.back(); else go('buses');
  };

  q.oninput = () => {
    clearTimeout(timer);
    err.textContent = '';
    const text = q.value;
    if (text.trim().length < 3) { res.innerHTML = ''; return; }
    timer = setTimeout(async () => {
      const my = ++seq;
      spin.hidden = false;
      try {
        const list = await geoSearch(text);
        if (my !== seq) return;
        res.innerHTML = list.map((p, i) => `<button class="result" data-i="${i}"><b>${esc(p.title)}</b>${p.subtitle ? `<span>${esc(p.subtitle)}</span>` : ''}</button>`).join('');
        res.querySelectorAll('[data-i]').forEach((b) => { b.onclick = () => save(list[+b.dataset.i]); });
        if (!list.length) err.textContent = 'Ничего не нашлось. Попробуй «улица, дом».';
      } catch {
        if (my === seq) err.textContent = 'Не удалось найти адрес. Проверь интернет.';
      } finally {
        if (my === seq) spin.hidden = true;
      }
    }, 700);
  };

  const gps = $app.querySelector('[data-gps]');
  gps.onclick = () => {
    if (!navigator.geolocation) { err.textContent = 'Геолокация недоступна в этом браузере.'; return; }
    gps.disabled = true;
    gps.textContent = 'Определяю…';
    err.textContent = '';
    navigator.geolocation.getCurrentPosition(async (pos) => {
      const point = { lat: pos.coords.latitude, lon: pos.coords.longitude };
      const p = (await geoReverse(point)) || { title: 'Точка по GPS', subtitle: `${point.lat.toFixed(5)}, ${point.lon.toFixed(5)}`, point };
      const box = $app.querySelector('[data-gpsres]');
      box.innerHTML = `<div class="card found"><div class="muted small">Найдено по GPS</div><div class="subject">${esc(p.title)}</div>
        ${p.subtitle ? `<div class="muted small">${esc(p.subtitle)}</div>` : ''}
        <div class="row"><button class="btn" data-yes>Это мой дом</button><button class="link" data-no>Отмена</button></div></div>`;
      box.querySelector('[data-yes]').onclick = () => save(p);
      box.querySelector('[data-no]').onclick = () => { box.innerHTML = ''; };
      gps.disabled = false;
      gps.innerHTML = `${I.pin} Я сейчас дома — определить по GPS`;
    }, (e) => {
      err.textContent = e.code === 1
        ? 'Нет доступа к геолокации. Разреши его для Safari в Настройках iPhone или введи адрес вручную.'
        : 'Не удалось определить местоположение. Попробуй на улице или у окна.';
      gps.disabled = false;
      gps.innerHTML = `${I.pin} Я сейчас дома — определить по GPS`;
    }, { enableHighAccuracy: true, timeout: 20000, maximumAge: 60000 });
  };
}

// ---------------- Настройки ----------------

function settings() {
  const theme = store.get('theme', 'system');
  const home = store.get('home');
  const opt = (v, l) => `<label class="radio"><input type="radio" name="theme" value="${v}" ${theme === v ? 'checked' : ''}><span>${l}</span></label>`;
  $app.innerHTML = `
    ${topBar('Настройки', null)}
    <main class="list form">
      <h3 class="section">Тема</h3>
      <div class="card">${opt('system', 'Как в системе')}${opt('light', 'Светлая')}${opt('dark', 'Тёмная')}</div>
      <h3 class="section">Расписание</h3>
      <div class="card">
        <div>Группа: ИС-25-3С (ТКПСТ, Луначарского)</div>
        <p class="muted small">Время везде считается по Тюмени (UTC+5). Звонки — по официальному расписанию звонков, предметы, кабинеты и преподаватели — из OpenScheduleApi. Об изменениях расписание сообщит при открытии сайта.</p>
        <button class="btn outline" data-clear>Очистить сохранённое расписание</button>
      </div>
      <h3 class="section">Автобусы</h3>
      <div class="card">
        <div>Домашний адрес: ${esc(home ? home.label : 'не указан')}</div>
        <p class="muted small">Колледж: Луначарского, 19. Данные об автобусах — Тюменьгортранс (онлайн по GPS).</p>
        <button class="btn outline" data-addr>${home ? 'Изменить' : 'Указать'} домашний адрес</button>
      </div>
    </main>`;
  $app.querySelectorAll('input[name=theme]').forEach((r) => { r.onchange = () => { store.set('theme', r.value); applyTheme(); }; });
  $app.querySelector('[data-clear]').onclick = (e) => { clearScheduleCache(); e.target.textContent = 'Очищено'; e.target.disabled = true; };
  $app.querySelector('[data-addr]').onclick = () => go('address');
}

// ---------------- Запуск ----------------

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js').catch(() => {});
}
render();
