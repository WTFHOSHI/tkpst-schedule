// API посещаемости для админ-панели ТКПСТ. Данные лежат в Netlify Blobs — закрыто, в репозиторий не попадают.
// Пароли и секрет — в переменных окружения Netlify:
//   ATT_PASSWORD_ADMIN, ATT_PASSWORD_KURATOR, ATT_PASSWORD_STAROSTA, ATT_SECRET
import { getStore, getDeployStore } from '@netlify/blobs';
import {
  ROLES, COURSES, isIso, isMonday, roleForPassword, signToken, verifyToken, defaultConfig,
  studentOp, courseOp, emptyWeek, applyMarks, prepareImport,
} from './logic.mjs';

const ORIGINS = ['https://wtfhoshi.github.io'];
// Изменения расписания: сервер правит web/overrides.json в репозитории ключом GitHub владельца, который хранится здесь (закрыто).
const GH_FILE = 'https://api.github.com/repos/WTFHOSHI/tkpst-schedule/contents/web/overrides.json';
const GH_KEY = 'secret/github';

async function gh(token: string, url: string, init: RequestInit = {}) {
  const r = await fetch(url, { ...init, headers: {
    Accept: 'application/vnd.github+json', Authorization: `Bearer ${token}`, 'User-Agent': 'tkpst-admin',
    'X-GitHub-Api-Version': '2022-11-28', ...(init.body ? { 'Content-Type': 'application/json' } : {}),
  } });
  let body: any = null;
  try { body = await r.json(); } catch { /* пусто */ }
  return { status: r.status, ok: r.ok, body };
}

function store() {
  const opts = { name: 'attendance', consistency: 'strong' as const };
  return Netlify.context?.deploy?.context === 'production' ? getStore(opts) : getDeployStore(opts);
}

function cors(req: Request): Record<string, string> {
  const origin = req.headers.get('origin') || '';
  const extra = (Netlify.env.get('ATT_ORIGINS') || '').split(',').map((s) => s.trim()).filter(Boolean);
  const ok = ORIGINS.includes(origin) || extra.includes(origin) || /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
  return ok ? {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  } : { Vary: 'Origin' };
}

const SECURITY = { 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'X-Robots-Tag': 'noindex, nofollow', 'X-Frame-Options': 'DENY' };
const json = (req: Request, body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...SECURITY, ...cors(req) },
});
const fail = (req: Request, error: string, status = 400) => json(req, { error }, status);

async function loadConfig(s: ReturnType<typeof store>) {
  const c = await s.get('config', { type: 'json' });
  const def = defaultConfig();
  if (!c || !c.courses) return def;
  for (const k of COURSES) c.courses[k] = { ...def.courses[k], ...(c.courses[k] || {}) };
  return c;
}
const weekKey = (course: string, monday: string) => `w/${course}/${monday}`;

export default async (req: Request, context: any) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors(req) });
  const url = new URL(req.url);
  const route = url.pathname.replace(/^\/api\/?/, '').replace(/\/$/, '');
  const secret = Netlify.env.get('ATT_SECRET') || '';
  if (!secret) return fail(req, 'Сервер не настроен: нет ATT_SECRET', 500);

  let body: any = {};
  if (req.method === 'POST') {
    try { body = await req.json(); } catch { return fail(req, 'Неверный запрос'); }
  }

  if (route === 'login' && req.method === 'POST') {
    // Защита от подбора: после 8 неверных паролей с одного адреса — пауза 15 минут.
    const ip = String((context && context.ip) || req.headers.get('x-nf-client-connection-ip') || 'unknown').slice(0, 64);
    const rlKey = 'rl/' + ip.replace(/[^0-9a-fA-F:.]/g, '_');
    const rs = store();
    const rl = (await rs.get(rlKey, { type: 'json' })) || { n: 0, since: Date.now() };
    if (Date.now() - rl.since > 15 * 60e3) { rl.n = 0; rl.since = Date.now(); }
    if (rl.n >= 8) return fail(req, 'Слишком много попыток. Подожди 15 минут.', 429);
    const role = roleForPassword(body.password, {
      admin: Netlify.env.get('ATT_PASSWORD_ADMIN'),
      kurator: Netlify.env.get('ATT_PASSWORD_KURATOR'),
      starosta: Netlify.env.get('ATT_PASSWORD_STAROSTA'),
    });
    if (!role) {
      rl.n++; await rs.setJSON(rlKey, rl);
      await new Promise((r) => setTimeout(r, 600));
      return fail(req, 'Неверный пароль', 401);
    }
    if (rl.n) await rs.setJSON(rlKey, { n: 0, since: Date.now() });
    return json(req, { token: signToken(role, secret), role, title: ROLES[role as keyof typeof ROLES].title });
  }

  const auth = verifyToken((req.headers.get('authorization') || '').replace(/^Bearer\s+/i, ''), secret);
  if (!auth) return fail(req, 'Нужно войти заново', 401);
  const role = ROLES[auth.role as keyof typeof ROLES];
  const by = role.title;
  const s = store();

  const courseOf = (v: unknown) => { const c = String(v ?? ''); return COURSES.includes(c) ? c : null; };

  if (route === 'me') return json(req, { role: auth.role, title: role.title });

  if (route === 'config' && req.method === 'GET') return json(req, await loadConfig(s));

  if (route === 'students' && req.method === 'POST') {
    if (!role.students) return fail(req, 'Нет права менять список студентов', 403);
    const config = await loadConfig(s);
    const r = studentOp(config, body);
    if (!r.ok) return fail(req, r.error);
    await s.setJSON('config', config);
    return json(req, config);
  }

  if (route === 'course' && req.method === 'POST') {
    if (!role.settings) return fail(req, 'Нет права менять группу курса', 403);
    const config = await loadConfig(s);
    const r = courseOp(config, body);
    if (!r.ok) return fail(req, r.error);
    await s.setJSON('config', config);
    return json(req, config);
  }

  if (route === 'week' && req.method === 'GET') {
    const course = courseOf(url.searchParams.get('course'));
    const w = url.searchParams.get('w') || '';
    if (!course || !isMonday(w)) return fail(req, 'Неверная неделя');
    return json(req, (await s.get(weekKey(course, w), { type: 'json' })) || emptyWeek());
  }

  if (route === 'marks' && req.method === 'POST') {
    const course = courseOf(body.course);
    if (!course) return fail(req, 'Нет такого курса');
    const key = weekKey(course, body.w);
    const week = (await s.get(key, { type: 'json' })) || emptyWeek();
    const r = applyMarks(week, body.w, body.changes || [], body.pairs, body.hide);
    if (!r.ok) return fail(req, r.error);
    if ((body.changes || []).length) { week.at = new Date().toISOString(); week.by = by; }
    await s.setJSON(key, week);
    return json(req, week);
  }

  if (route === 'weeks' && req.method === 'GET') {
    // Все недели курса в диапазоне — для выгрузки в Excel.
    const course = courseOf(url.searchParams.get('course'));
    if (!course) return fail(req, 'Нет такого курса');
    const from = url.searchParams.get('from') || '';
    const to = url.searchParams.get('to') || '';
    const { blobs } = await s.list({ prefix: `w/${course}/` });
    const keys = blobs.map((b) => b.key).filter((k) => {
      const m = k.slice(-10);
      return isIso(m) && (!isIso(from) || m >= from) && (!isIso(to) || m <= to);
    }).sort();
    const weeks: Record<string, unknown> = {};
    await Promise.all(keys.map(async (k) => { weeks[k.slice(-10)] = await s.get(k, { type: 'json' }); }));
    return json(req, { weeks });
  }

  // ---------- Изменения расписания (overrides.json) ----------

  if (route === 'github' && req.method === 'GET') return json(req, { configured: !!(await s.get(GH_KEY)) });

  if (route === 'github' && req.method === 'POST') {
    if (!role.settings) return fail(req, 'Ключ GitHub подключает администратор или староста', 403);
    const token = String(body.token || '').trim();
    if (token.length < 20 || token.length > 300) return fail(req, 'Это не похоже на ключ GitHub');
    const test = await gh(token, GH_FILE + '?ref=main');
    if (!test.ok) return fail(req, 'GitHub не принял ключ: ' + ((test.body && test.body.message) || test.status));
    await s.set(GH_KEY, token);
    return json(req, { ok: true });
  }

  if (route === 'overrides') {
    const token = await s.get(GH_KEY);
    if (!token) return json(req, { error: 'Ключ GitHub ещё не подключён', code: 'no_github' }, 409);
    if (req.method === 'GET') {
      const f = await gh(token, `${GH_FILE}?ref=main&t=${Date.now()}`);
      if (!f.ok) return fail(req, 'GitHub: ' + ((f.body && f.body.message) || f.status), 502);
      return json(req, { text: Buffer.from(f.body.content || '', 'base64').toString('utf8'), sha: f.body.sha });
    }
    if (req.method === 'POST') {
      const text = String(body.text || '');
      if (text.length > 500000) return fail(req, 'Слишком большой файл');
      try { JSON.parse(text); } catch { return fail(req, 'Неверные данные расписания'); }
      const r = await gh(token, GH_FILE, { method: 'PUT', body: JSON.stringify({
        message: `Админ (${by}): изменения расписания`, content: Buffer.from(text, 'utf8').toString('base64'), sha: body.sha, branch: 'main',
      }) });
      if (r.status === 409 || r.status === 422) return json(req, { error: 'Расписание изменили в другом месте — обнови страницу и повтори', code: 'conflict' }, 409);
      if (!r.ok) return fail(req, 'GitHub: ' + ((r.body && r.body.message) || r.status), 502);
      return json(req, { sha: r.body.content.sha });
    }
  }

  if (route === 'import' && req.method === 'POST') {
    if (!role.import) return fail(req, 'Нет права на импорт', 403);
    const course = courseOf(body.course);
    if (!course) return fail(req, 'Нет такого курса');
    const config = await loadConfig(s);
    const r = prepareImport(config, course, body);
    if (!r.ok) return fail(req, r.error);
    let marks = 0;
    for (const [monday, changes] of Object.entries(r.weeks as Record<string, any[]>)) {
      const key = weekKey(course, monday);
      const week = (await s.get(key, { type: 'json' })) || emptyWeek();
      const a = applyMarks(week, monday, changes, null);
      if (!a.ok) return fail(req, a.error);
      week.at = new Date().toISOString(); week.by = by + ' (импорт)';
      await s.setJSON(key, week);
      marks += changes.length;
    }
    await s.setJSON('config', config);
    return json(req, { ok: true, weeks: Object.keys(r.weeks).length, marks, added: r.added, config });
  }

  return fail(req, 'Не найдено', 404);
};

export const config = { path: '/api/*' };
