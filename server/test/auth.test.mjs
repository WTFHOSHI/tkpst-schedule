import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createAuthServer } from '../http.mjs';

const origin = 'http://127.0.0.1:4173';
const password = 'A-long-test-password-42';
async function fixture(t, options = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'tkpst-auth-'));
  const dbPath = join(dir, 'accounts.sqlite');
  let app;
  const start = async () => {
    app = await createAuthServer({ dbPath, publicOrigin: origin, ...options });
    await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
    return `http://127.0.0.1:${app.server.address().port}`;
  };
  let url = await start();
  const stop = async () => { await new Promise(resolve => app.server.close(resolve)); app.close(); };
  t.after(async () => { await stop(); await rm(dir, { recursive: true, force: true }); });
  return {
    dbPath,
    async restart() { await stop(); url = await start(); },
    async request(path, { method = path.startsWith('/api/') ? 'POST' : 'GET', body, cookie, headers = {} } = {}) {
      return fetch(url + path, { method, headers: { ...(method === 'POST' ? { Origin: origin, 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}), ...headers }, ...(body === undefined ? method === 'POST' ? { body: '{}' } : {} : { body: typeof body === 'string' ? body : JSON.stringify(body) }) });
    },
  };
}
const cookieOf = r => r.headers.get('set-cookie')?.split(';')[0];
const registration = (username = 'student_one') => ({ username, displayName: 'Студент', password });

test('регистрация создаёт реальный сеанс, пароль и токен не раскрываются', async t => {
  const app = await fixture(t);
  const r = await app.request('/api/auth/register', { method: 'POST', body: registration() });
  assert.equal(r.status, 201);
  const data = await r.json();
  assert.equal(data.user.username, 'student_one');
  assert.equal(data.user.displayName, 'Студент');
  assert.equal(data.user.verifiedStudent, false);
  assert.ok(!JSON.stringify(data).includes(password));
  const rawCookie = r.headers.get('set-cookie');
  assert.match(rawCookie, /HttpOnly/i); assert.match(rawCookie, /SameSite=Lax/i);
  assert.match(r.headers.get('cache-control'), /no-store/);
  const session = await app.request('/api/auth/session', { cookie: cookieOf(r) });
  assert.equal((await session.json()).user.id, data.user.id);
  const bytes = await readFile(app.dbPath);
  assert.ok(!bytes.includes(Buffer.from(password)));
  assert.ok(!bytes.includes(Buffer.from(cookieOf(r).split('=')[1])));
});

test('сеанс и аккаунт переживают перезапуск, выход отзывает сеанс', async t => {
  const app = await fixture(t);
  const created = await app.request('/api/auth/register', { method: 'POST', body: registration() });
  const cookie = cookieOf(created);
  await app.restart();
  assert.ok((await (await app.request('/api/auth/session', { cookie })).json()).user);
  const logout = await app.request('/api/auth/logout', { method: 'POST', body: {}, cookie });
  assert.equal(logout.status, 204);
  assert.match(logout.headers.get('set-cookie'), /Max-Age=0/);
  assert.equal((await (await app.request('/api/auth/session', { cookie })).json()).user, null);
  const login = await app.request('/api/auth/login', { method: 'POST', body: { username: 'STUDENT_ONE', password } });
  assert.equal(login.status, 200); assert.notEqual(cookieOf(login), cookie);
});

test('личные данные определяются только сеансом, незнакомый или истёкший сеанс закрыт', async t => {
  let now = 1000;
  const app = await fixture(t, { now: () => now, sessionTtl: 60_000 });
  const a = await app.request('/api/auth/register', { method: 'POST', body: registration('student_a') });
  const b = await app.request('/api/auth/register', { method: 'POST', body: registration('student_b') });
  const bData = await b.json();
  const own = await app.request('/api/account?userId=' + bData.user.id, { cookie: cookieOf(a) });
  assert.equal((await own.json()).user.username, 'student_a');
  assert.equal((await app.request('/api/account')).status, 401);
  assert.equal((await app.request('/api/grades')).status, 401);
  const grades = await app.request('/api/grades', { cookie: cookieOf(a) });
  assert.deepEqual(await grades.json(), { connected: false, subjects: [] });
  assert.equal((await (await app.request('/api/auth/session', { cookie: 'tkpst_session=forged' })).json()).user, null);
  now += 60_001;
  assert.equal((await (await app.request('/api/auth/session', { cookie: cookieOf(a) })).json()).user, null);
});

test('проверка полей, дубликатов и неверных паролей', async t => {
  const app = await fixture(t);
  for (const body of [null, [], {}, registration('x'), { ...registration(), displayName: '' }, { ...registration(), password: 'short' }]) {
    assert.equal((await app.request('/api/auth/register', { method: 'POST', body })).status, 400);
  }
  assert.equal((await app.request('/api/auth/register', { method: 'POST', body: registration() })).status, 201);
  assert.equal((await app.request('/api/auth/register', { method: 'POST', body: registration('STUDENT_ONE') })).status, 409);
  const wrong = await app.request('/api/auth/login', { method: 'POST', body: { username: 'student_one', password: 'wrong' } });
  const missing = await app.request('/api/auth/login', { method: 'POST', body: { username: 'missing_user', password: 'wrong' } });
  assert.equal(wrong.status, 401); assert.equal(missing.status, 401);
  assert.deepEqual(await wrong.json(), await missing.json());
});

test('конкурентная регистрация одного логина создаёт только один аккаунт', async t => {
  const app = await fixture(t);
  const results = await Promise.all([1, 2].map(() => app.request('/api/auth/register', { method: 'POST', body: registration() })));
  assert.deepEqual(results.map(r => r.status).sort(), [201, 409]);
});

test('CSRF, тип и размер запроса отклоняются безопасно', async t => {
  const app = await fixture(t);
  assert.equal((await app.request('/api/auth/register', { method: 'POST', body: registration(), headers: { Origin: 'https://foreign.example' } })).status, 403);
  assert.equal((await app.request('/api/auth/register', { method: 'POST', body: '{}', headers: { 'Content-Type': 'text/plain' } })).status, 415);
  assert.equal((await app.request('/api/auth/register', { method: 'POST', body: '{invalid' })).status, 400);
  assert.equal((await app.request('/api/auth/register', { method: 'POST', body: 'x'.repeat(20_000) })).status, 413);
});

test('лимит попыток входа возвращает 429 и Retry-After', async t => {
  const app = await fixture(t, { loginLimit: 2 });
  for (let i = 0; i < 2; i++) assert.equal((await app.request('/api/auth/login', { method: 'POST', body: { username: 'missing', password: 'wrong' } })).status, 401);
  const limited = await app.request('/api/auth/login', { method: 'POST', body: { username: 'missing', password: 'wrong' } });
  assert.equal(limited.status, 429); assert.ok(+limited.headers.get('retry-after') > 0);
});

test('публичный сервер не раздаёт базу, исходники сервера или git', async t => {
  const app = await fixture(t);
  assert.equal((await app.request('/')).status, 200);
  for (const path of ['/server/.data/accounts.sqlite', '/server/http.mjs', '/.git/config', '/%2e%2e%2fserver/http.mjs', '/icons/%00.png']) {
    assert.ok([403, 404].includes((await app.request(path)).status), path);
  }
  const r = await app.request('/api/auth/session');
  assert.match(r.headers.get('content-type'), /application\/json/);
  assert.match(r.headers.get('cache-control'), /no-store/);
});

test('HTTPS origin включает Secure cookie', async t => {
  const app = await fixture(t, { publicOrigin: 'https://college.example' });
  const r = await app.request('/api/auth/register', { method: 'POST', body: registration(), headers: { Origin: 'https://college.example' } });
  assert.equal(r.status, 201); assert.match(r.headers.get('set-cookie'), /; Secure/);
});

test('старый офлайн-worker не может получить приватные данные через GET', async t => {
  const app = await fixture(t);
  const created = await app.request('/api/auth/register', { method: 'POST', body: registration() });
  for (const path of ['/api/auth/session', '/api/account', '/api/grades']) {
    const r = await app.request(path, { method: 'GET', cookie: cookieOf(created) });
    assert.equal(r.status, 405); assert.match(r.headers.get('cache-control'), /no-store/);
    assert.ok(!(await r.text()).includes('student_one'));
  }
});


test('пароли: минимум 6, максимум 128; существующие длинные пароли работают', async t => {
  const app = await fixture(t);
  for (const [i, value] of ['12345', '123456', 'пароль', 'x'.repeat(128), 'x'.repeat(129)].entries()) {
    const valid = value.length >= 6 && value.length <= 128;
    const body = { ...registration('boundary_' + i), password: value };
    const created = await app.request('/api/auth/register', { body });
    assert.equal(created.status, valid ? 201 : 400, 'length=' + value.length);
    if (valid) assert.equal((await app.request('/api/auth/login', { body: { username: body.username, password: value } })).status, 200);
    else assert.equal((await created.json()).field, 'password');
  }
});
