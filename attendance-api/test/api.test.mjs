// Проверка сервера: логика + обработчик запросов на подменённом хранилище (без Netlify).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';

register('data:text/javascript,' + encodeURIComponent(`
export async function resolve(spec, ctx, next) {
  if (spec === '@netlify/blobs') return { url: 'data:text/javascript,' + encodeURIComponent(\`
    const mem = globalThis.__blobs ||= new Map();
    const mk = () => ({
      get: async (k, o) => mem.has(k) ? (o && o.type === 'json' ? JSON.parse(mem.get(k)) : mem.get(k)) : null,
      setJSON: async (k, v) => { mem.set(k, JSON.stringify(v)); },
      list: async ({ prefix = '' } = {}) => ({ blobs: [...mem.keys()].filter((k) => k.startsWith(prefix)).map((key) => ({ key, etag: '' })) }),
    });
    export const getStore = mk; export const getDeployStore = mk;\`), shortCircuit: true };
  return next(spec, ctx);
}`));

const L = await import('../netlify/functions/att/logic.mjs');

test('пароли и токены', () => {
  const env = { admin: 'a-secret-1', kurator: 'k-secret-2', starosta: 's-secret-3' };
  assert.equal(L.roleForPassword('k-secret-2', env), 'kurator');
  assert.equal(L.roleForPassword('nope', env), null);
  assert.equal(L.roleForPassword('', { admin: '' }), null);
  const t = L.signToken('starosta', 'xyz', 1000);
  assert.equal(L.verifyToken(t, 'xyz', 2000).role, 'starosta');
  assert.equal(L.verifyToken(t, 'other', 2000), null);
  assert.equal(L.verifyToken(t, 'xyz', 1000 + 61 * 864e5), null);
  assert.equal(L.verifyToken(t.replace(/.$/, 'A') === t ? t.replace(/.$/, 'B') : t.replace(/.$/, 'A'), 'xyz', 2000), null);
});

test('имена и студенты', () => {
  assert.equal(L.cleanName('  новиков   олег петрович '), 'Новиков Олег Петрович');
  assert.equal(L.cleanName('мамин-сибиряк дмитрий'), 'Мамин-Сибиряк Дмитрий');
  assert.equal(L.nameKey('Лихачёв Виктор'), L.nameKey('лихачев виктор'));
  const c = L.defaultConfig();
  const r = L.studentOp(c, { course: 2, action: 'add', name: 'Яковлев Иван' });
  assert.ok(r.ok);
  assert.equal(L.studentOp(c, { course: 2, action: 'add', name: 'яковлев иван' }).ok, false);
  L.studentOp(c, { course: 2, action: 'add', name: 'Аверин Пётр' });
  assert.deepEqual(c.courses[2].students.map((s) => s.name), ['Аверин Пётр', 'Яковлев Иван']);
  assert.ok(L.studentOp(c, { course: 2, action: 'remove', id: r.student.id, to: '2026-10-04' }).ok);
  assert.equal(c.courses[2].students[1].to, '2026-10-04');
  L.studentOp(c, { course: 2, action: 'restore', id: r.student.id });
  assert.equal(c.courses[2].students[1].to, undefined);
  assert.equal(L.studentOp(c, { course: 9, action: 'add', name: 'Кто-то Там' }).ok, false);
  assert.ok(L.courseOp(c, { course: 3, groupId: 232, groupName: 'ИС-24-3С' }).ok);
  assert.equal(c.courses[3].groupId, 232);
});

test('отметки', () => {
  const w = L.emptyWeek();
  assert.equal(L.applyMarks(w, '2026-09-28', [], null).ok, true);
  assert.equal(L.applyMarks(w, '2026-09-30', [], null).ok, false); // не понедельник
  assert.equal(L.applyMarks(w, '2026-09-28', [{ s: 'a', d: '2026-10-05', p: 1, v: 'N' }]).ok, false); // воскресенье/чужая неделя
  assert.equal(L.applyMarks(w, '2026-09-28', [{ s: 'a', d: '2026-09-28', p: 1, v: 'X' }]).ok, false);
  assert.ok(L.applyMarks(w, '2026-09-28', [
    { s: 'a', d: '2026-09-28', p: 1, v: 'N' }, { s: 'a', d: '2026-09-28', p: 2, v: 'B' }, { s: 'b', d: '2026-10-03', p: 3, v: 'P' },
  ], { '2026-09-28': [2, 1, 1], '2026-10-03': [], '2026-11-01': [1] }).ok);
  assert.deepEqual(w.m, { a: { '2026-09-28': { 1: 'N', 2: 'B' } }, b: { '2026-10-03': { 3: 'P' } } });
  assert.deepEqual(w.pairs, { '2026-09-28': [1, 2] });
  L.applyMarks(w, '2026-09-28', [{ s: 'b', d: '2026-10-03', p: 3, v: null }, { s: 'a', d: '2026-09-28', p: 1, v: null }]);
  assert.deepEqual(w.m, { a: { '2026-09-28': { 2: 'B' } } });
});

test('импорт', () => {
  const c = L.defaultConfig();
  L.studentOp(c, { course: 2, action: 'add', name: 'Тестова Мария Ивановна' });
  const r = L.prepareImport(c, 2, { weeks: {
    '2025-10-06': { 'Тестова Мария Ивановна': { '2025-10-06': { 1: 'P' } } },
    '2025-11-10': { 'новиков олег петрович': { '2025-11-12': { 2: 'Z' } }, 'ТЕСТОВА мария ивановна': { '2025-11-10': { 1: 'N' } } },
  } });
  assert.ok(r.ok);
  assert.equal(r.added, 1);
  const nik = c.courses[2].students.find((s) => s.name === 'Новиков Олег Петрович');
  assert.equal(nik.from, '2025-11-10');
  assert.equal(r.weeks['2025-11-10'].length, 2);
});

test('обработчик запросов', async () => {
  const env = { ATT_SECRET: 'test-secret', ATT_PASSWORD_ADMIN: 'adm-pass', ATT_PASSWORD_STAROSTA: 'st-pass' };
  globalThis.Netlify = { env: { get: (k) => env[k] }, context: { deploy: { context: 'production' } } };
  const { default: handler } = await import('../netlify/functions/att/att.mts');
  const O = 'https://wtfhoshi.github.io';
  const call = async (method, path, body, token) => {
    const r = await handler(new Request('https://x.netlify.app/api/' + path, {
      method, headers: { origin: O, 'content-type': 'application/json', ...(token ? { authorization: 'Bearer ' + token } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    }));
    return { status: r.status, cors: r.headers.get('access-control-allow-origin'), body: r.status === 204 ? null : await r.json() };
  };
  assert.equal((await call('OPTIONS', 'week')).cors, O);
  assert.equal((await call('GET', 'config')).status, 401);
  assert.equal((await call('POST', 'login', { password: 'bad' })).status, 401);
  const st = (await call('POST', 'login', { password: 'st-pass' })).body.token;
  const ad = (await call('POST', 'login', { password: 'adm-pass' })).body.token;
  const cfg = (await call('GET', 'config', null, st)).body;
  assert.equal(cfg.courses[2].groupName, 'ИС-25-3С');
  assert.equal((await call('POST', 'students', { course: 2, action: 'add', name: 'Тест Тестов' }, st)).status, 403);
  const c2 = (await call('POST', 'students', { course: 2, action: 'add', name: 'Тест Тестов' }, ad)).body;
  const id = c2.courses[2].students[0].id;
  const w = (await call('POST', 'marks', { course: 2, w: '2026-09-28', changes: [{ s: id, d: '2026-09-29', p: 2, v: 'N' }] }, st)).body;
  assert.equal(w.m[id]['2026-09-29'][2], 'N');
  assert.equal(w.by, 'Староста');
  assert.equal((await call('GET', 'week?course=2&w=2026-09-28', null, st)).body.m[id]['2026-09-29'][2], 'N');
  const imp = await call('POST', 'import', { course: 2, weeks: { '2025-10-06': { 'Тест Тестов': { '2025-10-07': { 1: 'B' } } } } }, ad);
  assert.equal(imp.body.marks, 1);
  const all = (await call('GET', 'weeks?course=2', null, st)).body.weeks;
  assert.deepEqual(Object.keys(all), ['2025-10-06', '2026-09-28']);
  const part = (await call('GET', 'weeks?course=2&from=2026-01-01', null, st)).body.weeks;
  assert.deepEqual(Object.keys(part), ['2026-09-28']);
  assert.equal((await call('POST', 'import', { course: 2, weeks: {} }, st)).status, 403);
});
