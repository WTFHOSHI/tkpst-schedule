// API посещаемости для админ-панели ТКПСТ. Данные лежат в Netlify Blobs — закрыто, в репозиторий не попадают.
// Пароли и секрет — в переменных окружения Netlify:
//   ATT_PASSWORD_ADMIN, ATT_PASSWORD_KURATOR, ATT_PASSWORD_STAROSTA, ATT_SECRET
import { getStore, getDeployStore } from '@netlify/blobs';
import {
  ROLES, COURSES, isIso, isMonday, roleForPassword, signToken, verifyToken, defaultConfig,
  studentOp, courseOp, emptyWeek, applyMarks, prepareImport,
} from './logic.mjs';

const ORIGINS = ['https://wtfhoshi.github.io'];

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

const json = (req: Request, body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...cors(req) },
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

export default async (req: Request, _context: unknown) => {
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
    const role = roleForPassword(body.password, {
      admin: Netlify.env.get('ATT_PASSWORD_ADMIN'),
      kurator: Netlify.env.get('ATT_PASSWORD_KURATOR'),
      starosta: Netlify.env.get('ATT_PASSWORD_STAROSTA'),
    });
    if (!role) { await new Promise((r) => setTimeout(r, 600)); return fail(req, 'Неверный пароль', 401); }
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
