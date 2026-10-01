// Админ-панель: правит web/overrides.json в репозитории через GitHub API.
// Сайт и приложения (Android/iOS) скачивают этот файл сами — обновлять их не нужно.
import { T, fmt, buildTimeline, setOverrides, pairSlots, parseLessons } from '../js/core.js';

const REPO = 'WTFHOSHI/tkpst-schedule';
const FILE = 'web/overrides.json';
const API = `https://api.github.com/repos/${REPO}/contents/${FILE}`;
const SCHED = 'https://api.thisishyum.ru/schedule_api/tyumen/groups/196/schedules';
const WD = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'];
const TOKEN_KEY = 'admin_token';

const $app = document.getElementById('app');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const hm = (m) => `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`;
const svg = (d) => `<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
const I = { back: svg('<path d="M15 18l-6-6 6-6"/>'), next: svg('<path d="M9 18l6-6-6-6"/>'), out: svg('<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="M16 17l5-5-5-5M21 12H9"/>') };

// Тема как на сайте
{
  let theme = 'system';
  try { theme = JSON.parse(localStorage.getItem('theme')) || 'system'; } catch { /* ignore */ }
  document.documentElement.dataset.theme = theme;
}

const tokenGet = () => { try { return localStorage.getItem(TOKEN_KEY) || ''; } catch { return ''; } };
const tokenSet = (t) => { try { t ? localStorage.setItem(TOKEN_KEY, t) : localStorage.removeItem(TOKEN_KEY); } catch { /* ignore */ } };

const b64decode = (s) => new TextDecoder().decode(Uint8Array.from(atob(s.replace(/\s/g, '')), (c) => c.charCodeAt(0)));
const b64encode = (s) => { let bin = ''; for (const b of new TextEncoder().encode(s)) bin += String.fromCharCode(b); return btoa(bin); };

async function gh(url, opts = {}) {
  const r = await fetch(url, {
    ...opts,
    headers: { Accept: 'application/vnd.github+json', Authorization: `Bearer ${tokenGet()}`, ...(opts.body ? { 'Content-Type': 'application/json' } : {}) },
    cache: 'no-store',
  });
  let body = null;
  try { body = await r.json(); } catch { /* пусто */ }
  if (!r.ok) {
    const err = new Error((body && body.message) || `GitHub ответил ${r.status}`);
    err.status = r.status;
    throw err;
  }
  return body;
}

// ---------------- Состояние ----------------

const st = {
  data: null,        // черновик overrides
  saved: '',         // JSON последней сохранённой версии — чтобы видеть несохранённое
  sha: null,
  weekStart: T.monday(T.now()),
  selected: T.dayStart(T.now()),
  college: new Map(), // iso → {lessons} | {error}
  saving: false,
  msg: null,          // {kind:'ok'|'warn', text}
};
if (T.weekday(st.selected) === 7) { st.selected = T.addDays(st.selected, 1); st.weekStart = T.monday(st.selected); }

const iso = () => T.iso(st.selected);
const dirty = () => JSON.stringify(normalize(st.data)) !== st.saved;

/** Чистый вид: без пустых пар/дней и старых дат. */
function normalize(d) {
  const out = { announcement: (d.announcement || '').trim(), updatedAt: d.updatedAt || '', days: {} };
  const keepFrom = T.iso(T.addDays(T.dayStart(T.now()), -2));
  for (const k of Object.keys(d.days || {}).sort()) {
    if (k < keepFrom) continue;
    const day = d.days[k];
    const pairs = (day.pairs || [])
      .map((p) => {
        const q = { number: Number(p.number) };
        if (p.status === 'remote' || p.status === 'cancelled') q.status = p.status;
        for (const f of ['title', 'cabinet', 'teacher']) if ((p[f] || '').trim()) q[f] = p[f].trim();
        return q;
      })
      .filter((p) => Object.keys(p).length > 1)
      .sort((a, b) => a.number - b.number);
    const note = (day.note || '').trim();
    if (!pairs.length && !note && !day.replaceAll) continue;
    out.days[k] = { ...(note ? { note } : {}), ...(day.replaceAll ? { replaceAll: true } : {}), pairs };
  }
  return out;
}

function dayDraft(create = false) {
  const k = iso();
  if (!st.data.days[k] && create) st.data.days[k] = { note: '', replaceAll: false, pairs: [] };
  return st.data.days[k] || { note: '', replaceAll: false, pairs: [] };
}
function pairDraft(n) {
  const d = dayDraft(true);
  let p = d.pairs.find((x) => Number(x.number) === n);
  if (!p) { p = { number: n }; d.pairs.push(p); }
  return p;
}

// ---------------- Вход ----------------

function login(error = '') {
  $app.innerHTML = `
    <header class="bar"><span class="icon-space"></span>
      <div class="bar-title"><div class="t">Админ-панель</div><div class="s">ИС-25-3С · изменения расписания</div></div>
      <span class="icon-space"></span></header>
    <main class="admin">
      <div class="card">
        <b>Вход по ключу GitHub</b>
        <p class="college">Панель сохраняет изменения прямо в репозиторий сайта. Ключ хранится только в этом браузере.</p>
        <label class="lbl" for="tok">Ключ (fine-grained token)</label>
        <input id="tok" type="password" autocomplete="off" placeholder="github_pat_…">
        ${error ? `<p class="warn" style="margin-top:10px">${esc(error)}</p>` : ''}
        <button class="btn" data-login style="margin-top:12px;width:100%">Войти</button>
      </div>
      <div class="card">
        <b>Как получить ключ (один раз)</b>
        <ol class="steps">
          <li>Открой <a href="https://github.com/settings/personal-access-tokens/new" target="_blank" rel="noopener">github.com → Settings → Fine-grained tokens → Generate new token</a>.</li>
          <li>Имя любое, срок — например, 1 год.</li>
          <li>Repository access → <b>Only select repositories</b> → <b>tkpst-schedule</b>.</li>
          <li>Permissions → Repository permissions → <b>Contents: Read and write</b>. Больше ничего не нужно.</li>
          <li>Generate token → скопируй и вставь сюда.</li>
        </ol>
      </div>
    </main>`;
  const input = $app.querySelector('#tok');
  const go = () => { const t = input.value.trim(); if (!t) return; tokenSet(t); boot(); };
  $app.querySelector('[data-login]').onclick = go;
  input.onkeydown = (e) => { if (e.key === 'Enter') go(); };
}

async function boot() {
  if (!tokenGet()) return login();
  $app.innerHTML = `<main class="admin"><div class="card">Загружаю…</div></main>`;
  try {
    await pull();
    editor();
  } catch (e) {
    if (e.status === 401 || e.status === 403 || e.status === 404) { tokenSet(''); return login('Ключ не подошёл: ' + e.message + '. Проверь доступ к tkpst-schedule и право Contents.'); }
    $app.innerHTML = `<main class="admin"><div class="card warn">Не удалось загрузить: ${esc(e.message)}</div><button class="btn" onclick="location.reload()">Ещё раз</button></main>`;
  }
}

async function pull() {
  const f = await gh(`${API}?ref=main&t=${Date.now()}`);
  st.sha = f.sha;
  let json = {};
  try { json = JSON.parse(b64decode(f.content || '')); } catch { json = {}; }
  const n = normalize({ announcement: '', days: {}, ...json });
  st.saved = JSON.stringify(n);
  st.data = JSON.parse(st.saved);
  for (const k of Object.keys(st.data.days)) st.data.days[k] = { note: '', replaceAll: false, ...st.data.days[k] };
}

// ---------------- Редактор ----------------

async function collegeDay(day) {
  const k = T.iso(day);
  if (st.college.has(k)) return st.college.get(k);
  try {
    const r = await fetch(`${SCHED}?date=${k}`, { cache: 'no-store' });
    if (!r.ok) throw new Error('сервер ответил ' + r.status);
    const text = await r.text();
    const v = { lessons: parseLessons(text.trim() ? JSON.parse(text) : null) };
    st.college.set(k, v);
    return v;
  } catch (e) {
    return { lessons: [], error: e.message };
  }
}

function editor() {
  $app.innerHTML = `
    <header class="bar"><span class="icon-space"></span>
      <div class="bar-title"><div class="t">Админ-панель</div><div class="s">ИС-25-3С · изменения видны на сайте и в приложениях</div></div>
      <div class="bar-actions"><button class="icon" data-logout aria-label="Выйти">${I.out}</button></div></header>
    <main class="admin">
      <div class="card">
        <label class="lbl" for="ann">Объявление для всех (на главной и в расписании)</label>
        <textarea id="ann" placeholder="Например: 2 октября пар не будет — день здоровья">${esc(st.data.announcement)}</textarea>
      </div>
      <div class="week">
        <div class="week-head">
          <button class="icon" data-prev aria-label="Прошлая неделя">${I.back}</button>
          <div class="week-range" data-range></div>
          <button class="icon" data-next aria-label="Следующая неделя">${I.next}</button>
        </div>
        <div class="chips" data-chips></div>
      </div>
      <div data-day></div>
      <div class="card" data-changed></div>
    </main>
    <div class="savebar"><span class="status-text" data-status></span><button class="btn" data-save>Сохранить</button></div>`;
  $app.querySelector('[data-logout]').onclick = () => {
    if (dirty() && !confirmLeave()) return;
    tokenSet(''); login();
  };
  $app.querySelector('#ann').oninput = (e) => { st.data.announcement = e.target.value; status(); };
  $app.querySelector('[data-prev]').onclick = () => shiftWeek(-1);
  $app.querySelector('[data-next]').onclick = () => shiftWeek(1);
  $app.querySelector('[data-save]').onclick = save;
  renderWeek();
  renderDay();
  renderChanged();
  status();
}

function confirmLeave() { return window.confirm('Есть несохранённые изменения. Выйти без сохранения?'); }

function shiftWeek(n) {
  st.weekStart = T.addDays(st.weekStart, 7 * n);
  st.selected = st.weekStart;
  renderWeek(); renderDay();
}
function select(day) {
  st.selected = T.dayStart(day);
  st.weekStart = T.monday(st.selected);
  renderWeek(); renderDay();
}

function renderWeek() {
  $app.querySelector('[data-range]').textContent = `${fmt.dMon(st.weekStart)} – ${fmt.dMon(T.addDays(st.weekStart, 5))}`;
  const today = T.dayStart(T.now());
  const chips = $app.querySelector('[data-chips]');
  chips.innerHTML = WD.map((w, i) => {
    const d = T.addDays(st.weekStart, i);
    const has = !!normalize({ days: { [T.iso(d)]: st.data.days[T.iso(d)] || {} } }).days[T.iso(d)];
    const cls = ['chip', d === st.selected ? 'sel' : '', d === today ? 'today' : '', has ? 'has' : ''].join(' ');
    return `<button class="${cls}" data-d="${d}"><span>${w}</span><b>${new Date(d).getUTCDate()}</b><i></i></button>`;
  }).join('');
  chips.querySelectorAll('[data-d]').forEach((b) => { b.onclick = () => select(Number(b.dataset.d)); });
}

async function renderDay() {
  const box = $app.querySelector('[data-day]');
  const day = st.selected, wd = T.weekday(day), k = T.iso(day);
  box.innerHTML = `<div class="card">Загружаю расписание колледжа на ${fmt.dMon(day)}…</div>`;
  const col = await collegeDay(day);
  if (st.selected !== day) return; // успели переключить день
  const base = buildTimeline(wd, col.lessons, null).filter((e) => e.type === 'pair');
  const draft = dayDraft();
  const slots = pairSlots(wd);

  const rows = slots.map((s) => {
    const orig = base.find((e) => e.number === s.number);
    const p = (draft.pairs || []).find((x) => Number(x.number) === s.number) || {};
    const status = p.status === 'remote' || p.status === 'cancelled' ? p.status : 'normal';
    const ol = orig ? orig.lessons : [];
    const origText = ol.length
      ? ol.map((l) => `${esc(l.title)}${l.cabinet ? ' · каб. ' + esc(l.cabinet) : ''}${l.teacher ? ' · ' + esc(l.teacher) : ''}`).join('<br>')
      : 'В колледже пары нет';
    const ph = (f, def) => esc((ol[0] && ol[0][f]) || def);
    return `
      <div class="prow" data-n="${s.number}">
        <div class="prow-head"><b>${s.number} пара</b><span class="college">${hm(s.start)}–${hm(s.end)}</span></div>
        <div class="college">${draft.replaceAll ? '<i>Своё расписание — данные колледжа не используются</i>' : origText}</div>
        <div class="seg status">
          <button data-st="normal" class="${status === 'normal' ? 'on' : ''}">Как есть</button>
          <button data-st="remote" class="${status === 'remote' ? 'on remote' : ''}">Дистант</button>
          <button data-st="cancelled" class="${status === 'cancelled' ? 'on cancelled' : ''}">Отменена</button>
        </div>
        <div class="fields">
          <input type="text" data-f="title" value="${esc(p.title)}" placeholder="${orig && !draft.replaceAll ? 'Замена: ' + ph('title', 'предмет') : 'Предмет'}">
          <input type="text" data-f="cabinet" value="${esc(p.cabinet)}" placeholder="${orig && !draft.replaceAll ? ph('cabinet', 'Кабинет') : 'Кабинет'}">
          <input type="text" data-f="teacher" value="${esc(p.teacher)}" placeholder="${orig && !draft.replaceAll ? ph('teacher', 'Преподаватель') : 'Преподаватель'}">
        </div>
      </div>`;
  }).join('');

  box.innerHTML = wd === 7 ? '<div class="card">Воскресенье — выходной.</div>' : `
    <div class="card">
      <div class="prow-head"><h2 style="margin:0">${WD[wd - 1]}, ${fmt.dMon(day)}</h2>
        <button class="small-btn" data-reset>Сбросить день</button></div>
      ${col.error ? `<p class="warn">Сайт колледжа не ответил (${esc(col.error)}). Можно прописать пары вручную — включи «Своё расписание».</p>` : ''}
      ${!col.error && !base.length ? '<p class="college">Колледж пока ничего не опубликовал на этот день.</p>' : ''}
      <label class="switch" style="margin:10px 0"><input type="checkbox" data-all ${draft.replaceAll ? 'checked' : ''}>
        Своё расписание на день (не брать пары колледжа)</label>
      <label class="lbl" for="note">Заметка к дню</label>
      <textarea id="note" placeholder="Например: 3 пара в актовом зале">${esc(draft.note)}</textarea>
    </div>
    <div class="card">${rows}
      <p class="college" style="margin:10px 0 0">Заполненный предмет/кабинет/преподаватель — это замена. Если в колледже пары нет — она добавится.</p>
    </div>
    <div class="card preview"><b>Так увидят на сайте и в приложениях</b><div data-preview></div></div>`;
  if (wd === 7) return;

  box.querySelector('[data-reset]').onclick = () => { delete st.data.days[k]; changed(true); };
  box.querySelector('[data-all]').onchange = (e) => { dayDraft(true).replaceAll = e.target.checked; changed(true); };
  box.querySelector('#note').oninput = (e) => { dayDraft(true).note = e.target.value; changed(false); };
  box.querySelectorAll('.prow').forEach((row) => {
    const n = Number(row.dataset.n);
    row.querySelectorAll('[data-st]').forEach((b) => { b.onclick = () => { pairDraft(n).status = b.dataset.st; changed(true); }; });
    row.querySelectorAll('[data-f]').forEach((inp) => { inp.oninput = () => { pairDraft(n)[inp.dataset.f] = inp.value; changed(false); }; });
  });
  renderPreview(col.lessons);
}

function renderPreview(lessons) {
  const el = $app.querySelector('[data-preview]');
  if (!el) return;
  setOverrides(normalize(st.data));
  const tl = buildTimeline(T.weekday(st.selected), lessons, iso());
  setOverrides(null);
  const d = normalize(st.data).days[iso()];
  el.innerHTML = (d && d.note ? `<div class="pv"><span class="n">Заметка</span><span>${esc(d.note)}</span></div>` : '') +
    (tl.filter((e) => e.type !== 'break').map((e) => {
      if (e.type === 'ch') return `<div class="pv"><span class="n">${hm(e.start)}</span><span>${esc(e.title)}</span></div>`;
      const l = e.lessons.map((x) => `${x.cancelled || e.cancelled ? '<s>' : ''}${esc(x.title)}${x.cabinet ? ' · ' + esc(x.cabinet) : ''}${e.cancelled ? '</s>' : ''}`).join(' / ');
      const tags = [e.remote ? '<span class="tag remote">Дистант</span>' : '', e.cancelled ? '<span class="tag cancel">Отменена</span>' : '',
        e.lessons.some((x) => x.replaced) ? '<span class="tag">Замена</span>' : '', e.lessons.some((x) => x.added) ? '<span class="tag">Добавлена</span>' : ''].join(' ');
      return `<div class="pv"><span class="n">${e.number} · ${hm(e.start)}</span><span>${l} ${tags}</span></div>`;
    }).join('') || '<p class="college">Пар нет</p>');
}

let previewTimer = null;
function changed(rerender) {
  st.msg = null;
  if (rerender) renderDay();
  else { clearTimeout(previewTimer); previewTimer = setTimeout(() => renderPreview((st.college.get(iso()) || {}).lessons || []), 200); }
  renderWeek();
  renderChanged();
  status();
}

function renderChanged() {
  const el = $app.querySelector('[data-changed]');
  const days = Object.keys(normalize(st.data).days);
  el.innerHTML = `<b>Дни с изменениями</b>` + (days.length
    ? `<div class="changed-days" style="margin-top:8px">${days.map((k) => `<button class="small-btn" data-go="${k}">${fmt.dMon(T.parseIso(k))}</button>`).join('')}</div>`
    : '<p class="college" style="margin:6px 0 0">Пока нет. Прошедшие дни удаляются сами при сохранении.</p>');
  el.querySelectorAll('[data-go]').forEach((b) => { b.onclick = () => select(T.parseIso(b.dataset.go)); });
}

function status() {
  const el = $app.querySelector('[data-status]');
  const btn = $app.querySelector('[data-save]');
  if (!el) return;
  const d = dirty();
  btn.disabled = st.saving || !d;
  btn.textContent = st.saving ? 'Сохраняю…' : 'Сохранить';
  el.textContent = st.msg ? st.msg.text : d ? 'Есть несохранённые изменения' : 'Всё сохранено';
  el.style.color = st.msg && st.msg.kind === 'warn' ? '#b3261e' : '';
}

async function save() {
  if (st.saving || !dirty()) return;
  st.saving = true; st.msg = null; status();
  const out = normalize(st.data);
  out.updatedAt = new Date().toISOString();
  const text = JSON.stringify(out, null, 2) + '\n';
  try {
    const r = await gh(API, {
      method: 'PUT',
      body: JSON.stringify({ message: 'Админ: изменения расписания', content: b64encode(text), sha: st.sha, branch: 'main' }),
    });
    st.sha = r.content.sha;
    st.data = JSON.parse(JSON.stringify(out));
    for (const k of Object.keys(st.data.days)) st.data.days[k] = { note: '', replaceAll: false, ...st.data.days[k] };
    st.saved = JSON.stringify(normalize(st.data));
    st.msg = { kind: 'ok', text: 'Сохранено. У всех появится через 1–3 минуты.' };
  } catch (e) {
    st.msg = e.status === 409 || e.status === 422
      ? { kind: 'warn', text: 'Файл изменился в другом месте — обнови страницу и повтори.' }
      : e.status === 401 || e.status === 403
        ? { kind: 'warn', text: 'Нет права на запись: у ключа должно быть Contents: Read and write.' }
        : { kind: 'warn', text: 'Не сохранилось: ' + e.message };
  } finally {
    st.saving = false;
    renderWeek(); renderChanged(); status();
  }
}

window.addEventListener('beforeunload', (e) => { if (st.data && dirty()) { e.preventDefault(); e.returnValue = ''; } });

// Запуск — из index.html (вкладка «Изменение расписания»).
export const schedule = { start: boot, dirty: () => !!st.data && dirty(), discard: () => { st.data = null; } };
