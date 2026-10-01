// Вкладка «Посещаемость» админ-панели. Данные — на закрытом сервере (Netlify), не в репозитории:
// сайт расписания и приложения Android/iOS их не видят.
import { T, buildTimeline, setOverrides, parseLessons } from '../js/core.js';
import {
  MARKS, MARK, ABSENT, addDays, weekday, mondayOf, weekDays, ym, ddmm, dMon, dMonth, monthTitle, WD,
  weeksOfMonth, monthOfWeek, activeStudents, dayPairs, studentTotals, attendanceWorkbook, buildXlsx, parseOldXlsx,
} from './att-core.js';

const LOCAL = /^(localhost|127\.0\.0\.1)$/.test(location.hostname); // локальная проверка
const API = LOCAL ? '/api' : 'https://tkpst-poseshchaemost.netlify.app/api';
const SCHED = LOCAL ? '/sched' : 'https://api.thisishyum.ru/schedule_api/tyumen';
const OWN_GROUP = 196; // группа сайта: к ней применяются изменения из вкладки «Изменение расписания»
const TOKEN_KEY = 'att_token';
const PREF_KEY = 'att_prefs';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const svg = (d) => `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
const I = {
  back: svg('<path d="M15 18l-6-6 6-6"/>'), next: svg('<path d="M9 18l6-6-6-6"/>'),
  out: svg('<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="M16 17l5-5-5-5M21 12H9"/>'),
  erase: svg('<path d="M20 20H8l-5-5a2 2 0 0 1 0-2.8l9.2-9.2a2 2 0 0 1 2.8 0l5 5a2 2 0 0 1 0 2.8L13 18"/><path d="M6 11l7 7"/>'),
  dl: svg('<path d="M12 3v12M7 10l5 5 5-5"/><path d="M5 21h14"/>'),
};
const store = {
  get: (k) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k, v) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch { /* приватный режим */ } },
};
const todayIso = () => T.iso(T.dayStart(T.now()));

let $app = null;
const st = {
  token: store.get(TOKEN_KEY) || '', role: '', title: '',
  config: null, course: '2', month: '', monday: '', day: '', view: '', brush: 'N',
  week: null, weekKey: '',
  pending: new Map(),   // 'course|monday|sid|iso|pair' → код | null
  inflight: false, saveErr: '', saveTimer: null, pollTimer: null,
  schedule: new Map(),  // 'gid|iso' → {pairs, titles} | {error}
  overridesLoaded: false,
  panel: '',            // '', 'students', 'export', 'settings'
};
try { Object.assign(st, JSON.parse(store.get(PREF_KEY) || '{}')); } catch { /* ignore */ }
const savePrefs = () => store.set(PREF_KEY, JSON.stringify({ course: st.course, view: st.view, brush: st.brush }));
const can = (what) => ({ students: ['admin', 'kurator'], settings: ['admin'], import: ['admin'] }[what] || []).includes(st.role);
const course = () => st.config.courses[st.course];
const courseTitle = (c = st.course) => `${c} курс${st.config.courses[c].groupName ? ' · ' + st.config.courses[c].groupName : ''}`;
const isWide = () => window.matchMedia('(min-width: 860px)').matches;
const viewMode = () => st.view || (isWide() ? 'week' : 'day');

// ---------------- Сеть ----------------

async function api(path, body) {
  let r;
  try {
    r = await fetch(API + '/' + path, {
      method: body ? 'POST' : 'GET', cache: 'no-store',
      headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(st.token ? { Authorization: 'Bearer ' + st.token } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch { const e = new Error('Нет связи с сервером посещаемости'); e.offline = true; throw e; }
  let data = null;
  try { data = await r.json(); } catch { /* пусто */ }
  if (!r.ok) {
    const e = new Error((data && data.error) || `Сервер ответил ${r.status}`);
    e.status = r.status;
    if (r.status === 401 && path !== 'login') { st.token = ''; store.set(TOKEN_KEY, null); setTimeout(() => login('Вход истёк — введи пароль ещё раз.'), 0); }
    throw e;
  }
  return data;
}

/** Пары дня по реальному расписанию группы курса: {pairs: [n], titles: {n: предмет}} */
async function scheduleDay(iso) {
  const gid = course().groupId;
  if (!gid) return { pairs: [], titles: {}, none: true };
  const key = gid + '|' + iso;
  if (st.schedule.has(key)) return st.schedule.get(key);
  try {
    if (gid === OWN_GROUP && !st.overridesLoaded) {
      try { const r = await fetch('../overrides.json', { cache: 'no-store' }); if (r.ok) setOverrides(await r.json()); } catch { /* без изменений */ }
      st.overridesLoaded = true;
    }
    const r = await fetch(`${SCHED}/groups/${gid}/schedules?date=${iso}`, { cache: 'no-store' });
    if (!r.ok) throw new Error('сервер расписания ответил ' + r.status);
    const text = await r.text();
    const lessons = parseLessons(text.trim() ? JSON.parse(text) : null);
    const tl = buildTimeline(weekday(iso), lessons, gid === OWN_GROUP ? iso : null)
      .filter((e) => e.type === 'pair' && !e.cancelled);
    const v = { pairs: tl.map((e) => e.number), titles: Object.fromEntries(tl.map((e) => [e.number, e.lessons.map((l) => l.title).join(' / ') + (e.remote ? ' (дистант)' : '')])) };
    st.schedule.set(key, v);
    return v;
  } catch (e) {
    return { pairs: [], titles: {}, error: e.message };
  }
}

// ---------------- Отметки: локально сразу, на сервер — пачкой ----------------

const pKey = (sid, iso, p, mon = st.monday, c = st.course) => `${c}|${mon}|${sid}|${iso}|${p}`;
function cell(sid, iso, p) {
  const k = pKey(sid, iso, p);
  if (st.pending.has(k)) return st.pending.get(k);
  const w = st.week;
  return (w && w.m[sid] && w.m[sid][iso] && w.m[sid][iso][p]) || null;
}
/** Неделя с учётом ещё не сохранённых отметок (для итогов и выгрузки). */
function weekView() {
  const w = JSON.parse(JSON.stringify(st.week || { m: {}, pairs: {} }));
  for (const [k, v] of st.pending) {
    const [c, mon, sid, iso, p] = k.split('|');
    if (c !== st.course || mon !== st.monday) continue;
    if (v) ((w.m[sid] ||= {})[iso] ||= {})[p] = v;
    else if (w.m[sid] && w.m[sid][iso]) delete w.m[sid][iso][p];
  }
  return w;
}

function setMarks(list) { // [{sid, iso, p, v}]
  for (const x of list) st.pending.set(pKey(x.sid, x.iso, x.p), x.v);
  st.saveErr = '';
  scheduleSave(500);
  renderContent();
  renderStatus();
}
function scheduleSave(ms) { clearTimeout(st.saveTimer); st.saveTimer = setTimeout(flush, ms); }

async function flush() {
  if (st.inflight || !st.pending.size) return;
  st.inflight = true; renderStatus();
  const sent = new Map(st.pending);
  const groups = new Map();
  for (const [k, v] of sent) {
    const [c, mon, s, d, p] = k.split('|');
    const g = c + '|' + mon;
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g).push({ s, d, p: Number(p), v });
  }
  try {
    for (const [g, changes] of groups) {
      const [c, w] = g.split('|');
      const week = await api('marks', { course: c, w, changes });
      for (const [k, v] of sent) if (k.startsWith(g + '|') && st.pending.get(k) === v) st.pending.delete(k);
      if (c === st.course && w === st.monday) { st.week = week; renderContent(); }
    }
    st.saveErr = '';
  } catch (e) {
    st.saveErr = e.offline ? 'Нет связи — отметки сохранятся, когда появится интернет' : 'Не сохранилось: ' + e.message;
    if (e.status !== 401) scheduleSave(5000);
  } finally {
    st.inflight = false;
    renderStatus();
    if (st.pending.size && !st.saveErr) scheduleSave(300);
  }
}

async function addPair(iso, n) {
  const w = st.week || { pairs: {} };
  const list = [...new Set([...(w.pairs[iso] || []), n])];
  try { st.week = await api('marks', { course: st.course, w: st.monday, changes: [], pairs: { [iso]: list } }); renderContent(); }
  catch (e) { alert('Не получилось: ' + e.message); }
}
async function removePair(iso, n) {
  const w = st.week || { pairs: {} };
  try { st.week = await api('marks', { course: st.course, w: st.monday, changes: [], pairs: { [iso]: (w.pairs[iso] || []).filter((x) => x !== n) } }); renderContent(); }
  catch (e) { alert('Не получилось: ' + e.message); }
}

async function loadWeek(silent = false) {
  const key = st.course + '|' + st.monday;
  if (!silent) { st.week = null; st.weekKey = key; renderContent(); }
  try {
    const w = await api(`week?course=${st.course}&w=${st.monday}`);
    if (st.course + '|' + st.monday !== key) return;
    st.week = w; st.weekKey = key;
    renderContent();
  } catch (e) {
    if (!silent && st.course + '|' + st.monday === key) { st.week = { m: {}, pairs: {}, error: e.message }; renderContent(); }
  }
}

// ---------------- Вход ----------------

function login(error = '') {
  stopPoll();
  $app.innerHTML = `
    <header class="bar"><span class="icon-space"></span>
      <div class="bar-title"><div class="t">Посещаемость</div><div class="s">только для старосты, куратора и администратора</div></div>
      <span class="icon-space"></span></header>
    <main class="admin">
      <div class="card">
        <b>Вход по паролю</b>
        <p class="college">Пароль выдаёт администратор. Отметки видны только здесь — на сайт и в приложения они не попадают.</p>
        <label class="lbl" for="attpw">Пароль</label>
        <input id="attpw" type="password" autocomplete="current-password" placeholder="Пароль">
        ${error ? `<p class="warn" style="margin-top:10px">${esc(error)}</p>` : ''}
        <button class="btn" data-login style="margin-top:12px;width:100%">Войти</button>
      </div>
    </main>`;
  const input = $app.querySelector('#attpw');
  const go = async () => {
    const pw = input.value.trim();
    if (!pw) return;
    const btn = $app.querySelector('[data-login]');
    btn.disabled = true; btn.textContent = 'Проверяю…';
    try {
      const r = await api('login', { password: pw });
      st.token = r.token; store.set(TOKEN_KEY, r.token);
      boot();
    } catch (e) { login(e.status === 401 ? 'Неверный пароль' : e.message); }
  };
  $app.querySelector('[data-login]').onclick = go;
  input.onkeydown = (e) => { if (e.key === 'Enter') go(); };
  input.focus();
}

async function boot() {
  if (!st.token) return login();
  $app.innerHTML = `<main class="admin"><div class="card">Загружаю…</div></main>`;
  try {
    const [me, config] = await Promise.all([api('me'), api('config')]);
    st.role = me.role; st.title = me.title; st.config = config;
    if (!st.config.courses[st.course]) st.course = '2';
    const t = todayIso();
    goWeek(mondayOf(weekday(t) === 7 ? addDays(t, 1) : t), weekday(t) === 7 ? addDays(t, 1) : t, true);
    shell();
    loadWeek();
    startPoll();
  } catch (e) {
    if (e.status === 401) return;
    $app.innerHTML = `<main class="admin"><div class="card warn">Не удалось загрузить: ${esc(e.message)}</div><button class="btn" data-retry>Ещё раз</button></main>`;
    $app.querySelector('[data-retry]').onclick = boot;
  }
}

function startPoll() {
  stopPoll();
  st.pollTimer = setInterval(() => {
    if (document.visibilityState === 'visible' && !st.inflight && !st.pending.size && $app.querySelector('[data-att]')) loadWeek(true);
  }, 25000);
}
function stopPoll() { clearInterval(st.pollTimer); }

// ---------------- Навигация ----------------

function goWeek(monday, day, quiet = false) {
  st.monday = monday;
  st.day = day && day >= monday && day <= addDays(monday, 5) ? day : monday;
  st.month = monthOfWeek(monday);
  if (!quiet) { renderNav(); loadWeek(); }
}
function goMonth(delta) {
  const [y, m] = st.month.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  const ymStr = d.toISOString().slice(0, 7);
  const weeks = weeksOfMonth(ymStr);
  const cur = mondayOf(todayIso());
  goWeek(weeks.includes(cur) ? cur : weeks.find((w) => monthOfWeek(w) === ymStr) || weeks[0]);
  st.month = ymStr; renderNav();
}

// ---------------- Экран ----------------

function shell() {
  $app.innerHTML = `
    <header class="bar"><span class="icon-space"></span>
      <div class="bar-title"><div class="t">Посещаемость</div><div class="s" data-sub></div></div>
      <div class="bar-actions"><button class="icon" data-logout aria-label="Выйти">${I.out}</button></div></header>
    <main class="admin att" data-att>
      <div class="seg three" data-courses>${['1', '2', '3'].map((c) => `<button data-c="${c}">${c} курс</button>`).join('')}</div>
      <div class="att-nav">
        <div class="week-head">
          <button class="icon" data-mprev aria-label="Прошлый месяц">${I.back}</button>
          <div class="week-range" data-month></div>
          <button class="icon" data-mnext aria-label="Следующий месяц">${I.next}</button>
        </div>
        <div class="att-weeks" data-weeks></div>
      </div>
      <div class="att-toolbar">
        <div class="seg att-view"><button data-v="day">День</button><button data-v="week">Неделя</button></div>
        <button class="small-btn" data-panel="export">${I.dl}<span>Excel</span></button>
        ${can('students') ? '<button class="small-btn" data-panel="students">Студенты</button>' : ''}
        ${can('settings') ? '<button class="small-btn" data-panel="settings">Настройки</button>' : ''}
      </div>
      <div data-panelbox></div>
      <div data-content></div>
    </main>
    <div class="savebar att-bar">
      <div class="brushes" data-brushes>
        ${MARKS.map((m) => `<button class="brush m-${m.code}" data-b="${m.code}" title="${esc(m.title)}"><b>${m.label}</b><span>${m.short}</span></button>`).join('')}
        <button class="brush erase" data-b="" title="Стереть отметку">${I.erase}<span>стереть</span></button>
      </div>
      <div class="status-text" data-status></div>
    </div>`;
  $app.querySelector('[data-logout]').onclick = () => {
    if (st.pending.size && !confirm('Не все отметки сохранены. Выйти всё равно?')) return;
    st.token = ''; store.set(TOKEN_KEY, null); st.pending.clear(); login();
  };
  $app.querySelectorAll('[data-c]').forEach((b) => { b.onclick = () => { st.course = b.dataset.c; savePrefs(); st.panel = st.panel === 'settings' ? st.panel : ''; renderNav(); renderPanel(); loadWeek(); }; });
  $app.querySelector('[data-mprev]').onclick = () => goMonth(-1);
  $app.querySelector('[data-mnext]').onclick = () => goMonth(1);
  $app.querySelectorAll('[data-v]').forEach((b) => { b.onclick = () => { st.view = b.dataset.v; savePrefs(); renderNav(); renderContent(); }; });
  $app.querySelectorAll('[data-panel]').forEach((b) => { b.onclick = () => { st.panel = st.panel === b.dataset.panel ? '' : b.dataset.panel; renderPanel(); }; });
  $app.querySelectorAll('[data-b]').forEach((b) => { b.onclick = () => { st.brush = b.dataset.b; savePrefs(); renderBrushes(); }; });
  renderNav(); renderBrushes(); renderStatus(); renderPanel();
}

function renderNav() {
  const q = (s) => $app.querySelector(s);
  if (!q('[data-att]')) return;
  q('[data-sub]').textContent = `${courseTitle()} · ${st.title}`;
  $app.querySelectorAll('[data-c]').forEach((b) => b.classList.toggle('on', b.dataset.c === st.course));
  $app.querySelectorAll('[data-v]').forEach((b) => b.classList.toggle('on', b.dataset.v === viewMode()));
  q('[data-month]').textContent = monthTitle(st.month);
  const cur = mondayOf(todayIso());
  q('[data-weeks]').innerHTML = weeksOfMonth(st.month).map((m) =>
    `<button class="wchip${m === st.monday ? ' sel' : ''}${m === cur ? ' today' : ''}" data-w="${m}">${ddmm(m)} – ${ddmm(addDays(m, 5))}</button>`).join('');
  $app.querySelectorAll('[data-w]').forEach((b) => { b.onclick = () => { if (b.dataset.w !== st.monday) goWeek(b.dataset.w, addDays(b.dataset.w, weekday(st.day) - 1)); }; });
}

function renderBrushes() {
  $app.querySelectorAll('[data-b]').forEach((b) => b.classList.toggle('on', b.dataset.b === st.brush));
}

function renderStatus() {
  const el = $app && $app.querySelector('[data-status]');
  if (!el) return;
  const w = st.week;
  const m = MARK[st.brush];
  const hint = `Кисть: <b>${m ? esc(m.label + ' — ' + m.title) : 'стереть'}</b>. Нажимай на клетки.`;
  el.innerHTML = st.saveErr ? `<span class="att-err">${esc(st.saveErr)}</span>`
    : st.inflight || st.pending.size ? 'Сохраняю…'
      : w && w.at ? `${hint} <span class="muted">Сохранено · ${esc(w.by)}, ${new Date(w.at).toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Yekaterinburg' })}</span>`
        : hint;
}

/** Нажатие на клетку: та же отметка — стереть, иначе поставить кисть. */
function tap(sid, iso, p) {
  const cur = cell(sid, iso, p);
  const v = st.brush && cur !== st.brush ? st.brush : null;
  setMarks([{ sid, iso, p, v }]);
}

const markHtml = (v) => v ? `<b>${MARK[v].label}</b>` : '';

async function renderContent() {
  const box = $app && $app.querySelector('[data-content]');
  if (!box) return;
  renderStatus();
  const key = st.course + '|' + st.monday;
  if (!st.week || st.weekKey !== key) { box.innerHTML = '<div class="card">Загружаю отметки…</div>'; return; }
  const days = weekDays(st.monday);
  const studs = activeStudents(course().students, days[0], days[5]);
  if (!studs.length) {
    box.innerHTML = `<div class="card"><b>В списке ${st.course} курса пока нет студентов.</b>
      <p class="college">${can('students') ? 'Добавь их кнопкой «Студенты» выше' + (can('import') ? ' или загрузи старую таблицу в «Настройках»' : '') + '.' : 'Список заполняет куратор или администратор.'}</p></div>`;
    return;
  }
  const sched = {};
  await Promise.all(days.map(async (d) => { sched[d] = await scheduleDay(d); }));
  if (st.course + '|' + st.monday !== key || !st.week) return;
  if (viewMode() === 'week') renderWeekTable(box, days, studs, sched);
  else renderDayView(box, days, studs, sched);
}

function dayDot(d, studs) {
  return studs.some((s) => [1, 2, 3, 4, 5, 6, 7, 8].some((p) => cell(s.id, d, p)));
}

function renderDayView(box, days, studs, sched) {
  const d = st.day, sc = sched[d];
  const pairs = dayPairs(weekView(), d, sc.pairs);
  const manual = new Set((st.week.pairs && st.week.pairs[d]) || []);
  const today = todayIso();
  const absentToday = {};
  for (const s of studs) for (const p of pairs) { const v = cell(s.id, d, p); if (v && v !== 'P') absentToday[v] = (absentToday[v] || 0) + 1; }
  const filled = studs.reduce((a, s) => a + pairs.filter((p) => cell(s.id, d, p)).length, 0);

  box.innerHTML = `
    <div class="chips att-days">${days.map((x, i) => `<button class="chip${x === d ? ' sel' : ''}${x === today ? ' today' : ''}${dayDot(x, studs) ? ' has' : ''}" data-d="${x}"><span>${WD[i]}</span><b>${Number(x.slice(8))}</b><i></i></button>`).join('')}</div>
    <div class="card att-day">
      <div class="prow-head"><h2 style="margin:0">${WD[weekday(d) - 1]}, ${dMonth(d)}</h2>
        <span class="college">${filled} из ${studs.length * pairs.length} отмечено</span></div>
      ${sc.error ? `<p class="warn">Расписание не загрузилось (${esc(sc.error)}). Пары можно добавить вручную.</p>` : ''}
      ${sc.none ? `<p class="college">Для ${st.course} курса не выбрана группа — расписание не подтягивается${can('settings') ? ' (выбери в «Настройках»)' : ''}. Пары можно добавить вручную.</p>` : ''}
      ${!pairs.length ? `<p class="college">По расписанию пар нет.</p>` : ''}
      ${pairs.length ? `<div class="att-grid" style="--n:${pairs.length}">
        <div class="att-h name"><button class="small-btn" data-allday title="Всем без отметки поставить ✓">Остальные ✓ на весь день</button></div>
        ${pairs.map((p) => `<div class="att-h"><b>${p} пара</b><span class="subj" title="${esc(sc.titles[p] || '')}">${esc(sc.titles[p] || (manual.has(p) ? 'добавлена' : ''))}</span>
          <button class="small-btn" data-rest="${p}" title="Всем без отметки поставить ✓">ост. ✓</button>
          ${manual.has(p) && !sc.pairs.includes(p) && !studs.some((s) => cell(s.id, d, p)) ? `<button class="small-btn" data-rmpair="${p}">убрать</button>` : ''}</div>`).join('')}
        ${studs.map((s, i) => `
          <button class="att-name" data-sday="${s.id}" title="Поставить кисть на все пары дня"><span class="no">${i + 1}</span><span class="nm">${esc(s.name)}</span></button>
          ${pairs.map((p) => { const v = cell(s.id, d, p); return `<button class="att-cell${v ? ' m-' + v : ''}" data-s="${s.id}" data-p="${p}" aria-label="${esc(s.name)}, ${p} пара">${markHtml(v)}</button>`; }).join('')}`).join('')}
      </div>` : ''}
      <div class="att-day-foot">
        <button class="small-btn" data-addpair>+ Добавить пару</button>
        <span class="college">${Object.keys(absentToday).length ? 'Пропусков за день: ' + MARKS.filter((m) => absentToday[m.code]).map((m) => `${m.label} ${absentToday[m.code]}`).join(', ') : ''}</span>
      </div>
    </div>`;

  box.querySelectorAll('[data-d]').forEach((b) => { b.onclick = () => { st.day = b.dataset.d; renderContent(); }; });
  box.querySelectorAll('.att-cell').forEach((b) => { b.onclick = () => tap(b.dataset.s, d, Number(b.dataset.p)); });
  box.querySelectorAll('[data-sday]').forEach((b) => {
    b.onclick = () => {
      const sid = b.dataset.sday;
      const all = pairs.every((p) => cell(sid, d, p) === (st.brush || null));
      setMarks(pairs.map((p) => ({ sid, iso: d, p, v: all ? null : st.brush || null })));
    };
  });
  const rest = (ps) => setMarks(studs.flatMap((s) => ps.filter((p) => !cell(s.id, d, p)).map((p) => ({ sid: s.id, iso: d, p, v: 'P' }))));
  box.querySelectorAll('[data-rest]').forEach((b) => { b.onclick = () => rest([Number(b.dataset.rest)]); });
  const ad = box.querySelector('[data-allday]'); if (ad) ad.onclick = () => rest(pairs);
  box.querySelectorAll('[data-rmpair]').forEach((b) => { b.onclick = () => removePair(d, Number(b.dataset.rmpair)); });
  box.querySelector('[data-addpair]').onclick = () => {
    const def = (pairs.length ? Math.max(...pairs) : 0) + 1;
    const n = Number(prompt('Номер пары (1–8):', String(Math.min(8, def))));
    if (Number.isInteger(n) && n >= 1 && n <= 8) addPair(d, n);
  };
}

function renderWeekTable(box, days, studs, sched) {
  const wv = weekView();
  const cols = [];
  for (const d of days) {
    const ps = dayPairs(wv, d, sched[d].pairs);
    if (ps.length) ps.forEach((p) => cols.push({ d, p })); else cols.push({ d, p: 0 });
  }
  const today = todayIso();
  const errs = days.filter((d) => sched[d].error);
  box.innerHTML = `
    ${errs.length ? `<div class="warn">Расписание не загрузилось на ${errs.map(dMon).join(', ')}. Пары с отметками всё равно видны; добавить пару — в режиме «День».</div>` : ''}
    ${sched[days[0]].none ? `<div class="college" style="padding:0 4px">Для ${st.course} курса не выбрана группа — расписание не подтягивается.</div>` : ''}
    <div class="card att-wk"><div class="att-scroll"><table class="att-table">
      <thead>
        <tr><th class="sn" rowspan="2">Студент</th>${days.map((d) => { const n = cols.filter((c) => c.d === d).length; return `<th colspan="${n}" class="dh${d === today ? ' today' : ''}"><button data-goday="${d}">${WD[weekday(d) - 1]} ${ddmm(d)}</button></th>`; }).join('')}<th rowspan="2" class="tot">Пропуски</th></tr>
        <tr>${cols.map((c, i) => `<th class="ph${i && cols[i - 1].d !== c.d ? ' sep' : ''}" title="${esc(c.p ? sched[c.d].titles[c.p] || '' : '')}">${c.p ? c.p : '—'}</th>`).join('')}</tr>
      </thead>
      <tbody>${studs.map((s, i) => {
        const t = studentTotals(s.id, { w: wv });
        return `<tr><th class="sn"><span class="no">${i + 1}</span>${esc(s.name)}</th>${cols.map((c, j) => {
          const sep = j && cols[j - 1].d !== c.d ? ' sep' : '';
          if (!c.p) return `<td class="nop${sep}"></td>`;
          const v = cell(s.id, c.d, c.p);
          return `<td class="${sep}"><button class="att-cell sm${v ? ' m-' + v : ''}" data-s="${s.id}" data-d="${c.d}" data-p="${c.p}">${markHtml(v)}</button></td>`;
        }).join('')}<td class="tot">${t.absent ? `<b>${t.absent}</b>${t.N ? ` <span class="bad">(Н ${t.N})</span>` : ''}` : '<span class="muted">0</span>'}</td></tr>`;
      }).join('')}</tbody>
    </table></div>
    <p class="college" style="margin:10px 2px 0">Клик по клетке ставит выбранную внизу отметку, повторный клик — стирает. Клавиши: 1 ✓, 2 Н, 3 Б, 4 У, 5 Р, 6 З, 0 — стереть.</p></div>`;
  box.querySelectorAll('.att-cell').forEach((b) => { b.onclick = () => tap(b.dataset.s, b.dataset.d, Number(b.dataset.p)); });
  box.querySelectorAll('[data-goday]').forEach((b) => { b.onclick = () => { st.day = b.dataset.goday; st.view = 'day'; savePrefs(); renderNav(); renderContent(); }; });
}

// ---------------- Панели: Excel, студенты, настройки ----------------

function renderPanel() {
  const box = $app.querySelector('[data-panelbox]');
  if (!box) return;
  $app.querySelectorAll('[data-panel]').forEach((b) => b.classList.toggle('on', b.dataset.panel === st.panel));
  if (st.panel === 'export') return exportPanel(box);
  if (st.panel === 'students') return studentsPanel(box);
  if (st.panel === 'settings') return settingsPanel(box);
  box.innerHTML = '';
}

function exportPanel(box) {
  const range = `${ddmm(st.monday)} – ${ddmm(addDays(st.monday, 5))}`;
  box.innerHTML = `<div class="card att-panel">
    <b>Скачать в Excel · ${esc(courseTitle())}</b>
    <div class="att-export">
      <button class="btn outline" data-x="week">Неделя ${range}</button>
      <button class="btn outline" data-x="month">${monthTitle(st.month)} целиком</button>
      <button class="btn outline" data-x="course">Весь курс</button>
    </div>
    <p class="college" data-xmsg>В файле: цветные отметки (зелёный — был, красный — прогул, жёлтый — болеет, синий — уважительная, фиолетовый — работа, бирюзовый — по заявлению), легенда и итоги по каждому студенту.
    Открыть в Google Таблицах: Google Диск → «Создать» → «Загрузить файл», затем «Открыть в Google Таблицах» (или в таблице: Файл → Импорт → Загрузка).</p>
  </div>`;
  box.querySelectorAll('[data-x]').forEach((b) => { b.onclick = () => doExport(b.dataset.x, b); });
}

async function doExport(kind, btn) {
  const msg = $app.querySelector('[data-xmsg]');
  const label = btn.textContent;
  btn.disabled = true; btn.textContent = 'Готовлю файл…';
  try {
    await flush();
    let weeks, key;
    if (kind === 'week') { key = st.monday; weeks = { [st.monday]: weekView() }; }
    else if (kind === 'month') {
      key = st.month;
      const ws = weeksOfMonth(st.month);
      weeks = (await api(`weeks?course=${st.course}&from=${ws[0]}&to=${ws[ws.length - 1]}`)).weeks;
      if (ws.includes(st.monday)) weeks[st.monday] = weekView();
    } else {
      weeks = (await api(`weeks?course=${st.course}`)).weeks;
      if (st.week && (Object.keys(st.week.m).length || st.pending.size)) weeks[st.monday] = weekView();
    }
    if (kind === 'course' && !Object.keys(weeks).length) throw new Error('у курса пока нет отметок');
    const schedule = {};
    const gid = course().groupId;
    for (const [k, v] of st.schedule) { const [g, d] = k.split('|'); if (Number(g) === gid && v.pairs) schedule[d] = v.pairs; }
    const wb = attendanceWorkbook({ kind, key, courseTitle: courseTitle(), students: course().students, weeks, schedule, exportedAt: todayIso() });
    const blob = new Blob([buildXlsx(wb.sheets)], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = wb.file;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 30000);
    if (msg) msg.innerHTML = `Готово: <b>${esc(wb.file)}</b> (${wb.sheets.length} ${wb.sheets.length === 1 ? 'лист' : 'листа/листов'}).`;
  } catch (e) {
    if (msg) msg.innerHTML = `<span class="att-err">Не получилось: ${esc(e.message)}</span>`;
  } finally { btn.disabled = false; btn.textContent = label; }
}

function studentsPanel(box) {
  const c = course();
  const active = c.students.filter((s) => !s.to), gone = c.students.filter((s) => s.to);
  box.innerHTML = `<div class="card att-panel">
    <b>Студенты · ${esc(courseTitle())}</b>
    <div class="att-add"><input type="text" data-newname placeholder="Фамилия Имя Отчество"><button class="btn" data-add>Добавить</button></div>
    <p class="college">Новый студент появится в списке с недели ${dMon(st.monday)}. «Убрать» скрывает студента начиная с этой недели — прошлые отметки остаются.</p>
    <div class="att-slist">${active.map((s, i) => `<div class="att-srow"><span class="no">${i + 1}</span><span class="nm">${esc(s.name)}${s.from ? ` <span class="college">с ${dMon(s.from)}</span>` : ''}</span>
      <button class="small-btn" data-ren="${s.id}">Изменить</button><button class="small-btn danger" data-rm="${s.id}">Убрать</button></div>`).join('') || '<p class="college">Пока никого.</p>'}</div>
    ${gone.length ? `<b style="display:block;margin-top:12px">Убраны из списка</b><div class="att-slist">${gone.map((s) => `<div class="att-srow"><span class="nm">${esc(s.name)} <span class="college">до ${dMon(s.to)}</span></span><button class="small-btn" data-back="${s.id}">Вернуть</button></div>`).join('')}</div>` : ''}
    <p class="warn" data-smsg hidden></p>
  </div>`;
  const op = async (body) => {
    try { st.config = await api('students', { course: st.course, ...body }); studentsPanel(box); renderContent(); }
    catch (e) { const m = box.querySelector('[data-smsg]'); m.hidden = false; m.textContent = e.message; }
  };
  const inp = box.querySelector('[data-newname]');
  const add = () => { if (inp.value.trim()) op({ action: 'add', name: inp.value, from: st.monday }); };
  box.querySelector('[data-add]').onclick = add;
  inp.onkeydown = (e) => { if (e.key === 'Enter') add(); };
  box.querySelectorAll('[data-ren]').forEach((b) => { b.onclick = () => { const s = c.students.find((x) => x.id === b.dataset.ren); const n = prompt('ФИО:', s.name); if (n && n.trim() !== s.name) op({ action: 'rename', id: s.id, name: n }); }; });
  box.querySelectorAll('[data-rm]').forEach((b) => { b.onclick = () => { const s = c.students.find((x) => x.id === b.dataset.rm); if (confirm(`Убрать ${s.name} из списка начиная с недели ${dMon(st.monday)}?`)) op({ action: 'remove', id: s.id, to: addDays(st.monday, -1) }); }; });
  box.querySelectorAll('[data-back]').forEach((b) => { b.onclick = () => op({ action: 'restore', id: b.dataset.back }); });
}

let groupsCache = null;
async function settingsPanel(box) {
  box.innerHTML = `<div class="card att-panel">
    <b>Группы курсов</b>
    <p class="college">По группе подтягивается реальное расписание: в отметках показываются только те пары, что есть в этот день.</p>
    <div class="att-groups">${['1', '2', '3'].map((c) => `<label class="lbl">${c} курс <select data-g="${c}"><option value="">— не выбрана —</option></select></label>`).join('')}</div>
    <p class="college" data-gmsg>Загружаю список групп…</p>
    ${can('import') ? `<b style="display:block;margin-top:14px">Загрузить старую таблицу (.xlsx)</b>
    <p class="college">Формат как в твоей таблице: на листе строка «№ | ФИО», над ней даты, под каждой датой 4 колонки (пары 1–4). Отметки «+», «н», «нб», «нр», «нз» станут ✓, Н, Б, Р, З. Отметки попадут в <b>${esc(courseTitle())}</b>; новых студентов добавлю сам.</p>
    <input type="file" accept=".xlsx" data-file>
    <div data-imp></div>` : ''}
  </div>`;
  const msg = box.querySelector('[data-gmsg]');
  try {
    if (!groupsCache) {
      const r = await fetch(`${SCHED}/colleges/1/groups`, { cache: 'no-store' });
      if (!r.ok) throw new Error('сервер ответил ' + r.status);
      groupsCache = (await r.json()).map((g) => ({ id: g.studentGroupId, name: g.name })).sort((a, b) => a.name.localeCompare(b.name, 'ru'));
    }
    box.querySelectorAll('[data-g]').forEach((sel) => {
      const cur = st.config.courses[sel.dataset.g].groupId;
      sel.innerHTML = '<option value="">— не выбрана —</option>' + groupsCache.map((g) => `<option value="${g.id}"${g.id === cur ? ' selected' : ''}>${esc(g.name)}</option>`).join('');
      sel.onchange = async () => {
        const g = groupsCache.find((x) => String(x.id) === sel.value);
        try {
          st.config = await api('course', { course: sel.dataset.g, groupId: g ? g.id : null, groupName: g ? g.name : '' });
          msg.textContent = `Сохранено: ${sel.dataset.g} курс — ${g ? g.name : 'без группы'}.`;
          renderNav(); renderContent();
        } catch (e) { msg.textContent = 'Не сохранилось: ' + e.message; }
      };
    });
    msg.textContent = '';
  } catch (e) { msg.textContent = 'Список групп не загрузился: ' + e.message; }

  const file = box.querySelector('[data-file]');
  if (file) file.onchange = async () => {
    const out = box.querySelector('[data-imp]');
    const f = file.files[0];
    if (!f) return;
    out.innerHTML = '<p class="college">Читаю файл…</p>';
    try {
      const r = await parseOldXlsx(await f.arrayBuffer());
      const mons = Object.keys(r.weeks).sort();
      if (!r.marks) throw new Error('не нашёл отметок — проверь, что это та таблица');
      out.innerHTML = `<p class="ok">Нашёл ${r.marks} отметок, ${r.students.length} студентов, ${mons.length} недель (${dMon(mons[0])} ${mons[0].slice(0, 4)} – ${dMon(addDays(mons[mons.length - 1], 5))} ${mons[mons.length - 1].slice(0, 4)}).</p>
        <button class="btn" data-doimp>Загрузить в ${esc(courseTitle())}</button>`;
      out.querySelector('[data-doimp]').onclick = async (e) => {
        e.target.disabled = true; e.target.textContent = 'Загружаю…';
        try {
          const res = await api('import', { course: st.course, weeks: r.weeks });
          st.config = res.config;
          out.innerHTML = `<p class="ok">Готово: ${res.marks} отметок за ${res.weeks} недель, новых студентов: ${res.added}.</p>`;
          loadWeek();
        } catch (err) { out.innerHTML = `<p class="warn">Не загрузилось: ${esc(err.message)}</p>`; }
      };
    } catch (e) { out.innerHTML = `<p class="warn">Не получилось прочитать: ${esc(e.message)}</p>`; }
  };
}

// ---------------- Подключение к админ-панели ----------------

function onKey(e) {
  if (!$app || !$app.querySelector('[data-att]') || /input|textarea|select/i.test(e.target.tagName)) return;
  const map = { 1: 'P', 2: 'N', 3: 'B', 4: 'U', 5: 'R', 6: 'Z', 0: '' };
  if (e.key in map) { st.brush = map[e.key]; savePrefs(); renderBrushes(); renderStatus(); }
}
let wasWide = null, listening = false;
function onResize() {
  const w = isWide();
  if (wasWide !== null && w !== wasWide && !st.view && $app && $app.querySelector('[data-att]')) { renderNav(); renderContent(); }
  wasWide = w;
}

export const attendance = {
  start(el) {
    $app = el;
    if (!listening) {
      listening = true;
      document.addEventListener('keydown', onKey);
      window.addEventListener('resize', onResize);
      document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flush(); });
      window.addEventListener('beforeunload', (e) => { if (st.pending.size) { flush(); e.preventDefault(); e.returnValue = ''; } });
    }
    boot();
  },
  stop() { stopPoll(); flush(); },
  dirty: () => st.pending.size > 0,
};
