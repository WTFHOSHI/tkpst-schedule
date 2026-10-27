import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, pbkdf2Sync, createCipheriv } from 'node:crypto';
import { createAuthServer } from '../http.mjs';

const origin = 'http://127.0.0.1:4173';
const adminOrigin = 'https://wtfhoshi.github.io';
const password = 'Administrator test phrase';
const dk = randomBytes(32);
function seal(key, data, aad) {
  const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(Buffer.from(aad));
  const ct = Buffer.concat([cipher.update(JSON.stringify(data)), cipher.final(), cipher.getAuthTag()]);
  return { v: 1, iv: iv.toString('base64'), ct: ct.toString('base64') };
}
function fixtureData() {
  const salt = randomBytes(16), key = pbkdf2Sync(password, salt, 600000, 32, 'sha256');
  const secret = { role: 'admin', gh: 'fixture-token', dk: dk.toString('base64') };
  const vault = { v: 1, kdf: 'PBKDF2-SHA256', iter: 600000, salt: salt.toString('base64'), roles: { admin: seal(key, secret, 'vault:admin') } };
  const config = { courses: { 1: { groupName: '', students: [] }, 2: { groupName: 'ИС-25-3С', students: [{ id: 's1', name: 'Тестовый Студент' }, { id: 's2', name: 'Другой Студент' }, { id: 's3', name: 'Выбыл', to: '2020-01-01' }] }, 3: { groupName: '', students: [] } } };
  return { vault, config, key, secret };
}
async function fixture(t) {
  const data = fixtureData(); let now = Date.now();
  const fetchImpl = async (url, init) => {
    if (url.startsWith('https://wtfhoshi.github.io/tkpst-admin/vault.json')) { data.onVaultRead?.(); return Response.json(data.vault); }
    assert.equal(url, 'https://api.github.com/repos/WTFHOSHI/tkpst-admin-data/contents/config.json');
    assert.equal(init.headers.Authorization, 'Bearer fixture-token');
    return Response.json({ encoding: 'base64', content: Buffer.from(JSON.stringify(seal(dk, data.config, 'data:config.json'))).toString('base64') });
  };
  const app = await createAuthServer({ dbPath: ':memory:', publicOrigin: origin, now: () => now, adminFetch: fetchImpl });
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { await new Promise(resolve => app.server.close(resolve)); app.close(); });
  const url = `http://127.0.0.1:${app.server.address().port}`;
  const request = (path, body = {}, token, headers = {}) => fetch(url + path, { method: 'POST', headers: { Origin: path.startsWith('/api/admin/') ? adminOrigin : origin, 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}), ...headers }, body: JSON.stringify(body) });
  const rawLogin = async () => { const r = await request('/api/admin/login', { password }); assert.equal(r.status, 200, await r.clone().text()); return (await r.json()).token; };
  const sync = async (token, config = data.config) => { const r = await request('/api/admin/sync/start', {}, token); assert.equal(r.status, 200); return request('/api/admin/sync', { config, ticket: (await r.json()).ticket }, token); };
  const login = async () => { const token = await rawLogin(); assert.equal((await sync(token)).status, 200); return token; };
  return { data, request, login, rawLogin, sync, advance: n => now += n, clock: () => now, url };
}

test('admin: real vault password imports roster, wrong role/password and student cookies cannot list users', async t => {
  const f = await fixture(t);
  assert.equal((await f.request('/api/admin/users')).status, 401);
  assert.equal((await f.request('/api/admin/login', { password: 'wrong' })).status, 401);
  const registration = await f.request('/api/auth/register', { username: 'student', displayName: 'Тестовый Студент', password: 'Student long phrase' });
  const user = (await registration.json()).user;
  assert.equal(user.verifiedStudent, false);
  assert.equal((await f.request('/api/admin/users', {}, null, { Cookie: registration.headers.get('set-cookie').split(';')[0] })).status, 401);
  const token = await f.login();
  const r = await f.request('/api/admin/users', {}, token);
  assert.equal(r.status, 200); assert.equal(r.headers.get('access-control-allow-origin'), adminOrigin);
  assert.equal(r.headers.get('cache-control'), 'no-store');
  const list = await r.json(); assert.equal(list.users[0].id, user.id); assert.equal(list.students.length, 3);
  assert.ok(!JSON.stringify(list).includes('password_hash')); assert.ok(!JSON.stringify(list).includes('fixture-token'));
  f.data.secret.role = 'starosta'; f.data.vault.roles.admin = seal(f.data.key, f.data.secret, 'vault:admin');
  assert.equal((await f.request('/api/admin/login', { password, role: 'admin' })).status, 401);
  assert.equal((await f.request('/api/admin/users', {}, token)).status, 401, 'vault rotation revokes old sessions');
});

test('admin: explicit unique links affect only the linked student, unlink/withdrawal/expiry fail closed', async t => {
  const f = await fixture(t);
  const register = async username => {
    const r = await f.request('/api/auth/register', { username, displayName: 'Моё имя', password: 'Student long phrase' });
    return { user: (await r.json()).user, cookie: r.headers.get('set-cookie').split(';')[0] };
  };
  const a = await register('first'), b = await register('second'), token = await f.login();
  const link = (userId, studentId) => f.request('/api/admin/link', { userId, course: '2', studentId }, token);
  assert.equal((await link(a.user.id, 's1')).status, 200);
  assert.equal((await link(b.user.id, 's1')).status, 409);
  assert.equal((await link(b.user.id, 'missing')).status, 400);
  assert.equal((await link(b.user.id, 's3')).status, 400);
  const account = async a => (await (await f.request('/api/account', {}, null, { Cookie: a.cookie })).json()).user;
  assert.equal((await account(a)).student.displayName, 'Тестовый Студент');
  assert.equal((await account(a)).student.groupName, 'ИС-25-3С');
  assert.equal((await account(b)).verifiedStudent, false);
  assert.equal((await f.request('/api/admin/link', { userId: a.user.id, studentId: null }, token)).status, 200);
  assert.equal((await account(a)).verifiedStudent, false);
  await link(a.user.id, 's1');
  f.data.config.courses[2].students[0].to = '2020-01-01'; await f.login();
  assert.equal((await account(a)).verifiedStudent, false);
  f.advance(25 * 3600_000);
  assert.equal((await f.request('/api/admin/users', {}, token)).status, 401);
});

test('admin: exact origins, preflight and durable login throttling', async t => {
  const f = await fixture(t);
  assert.equal((await f.request('/api/admin/login', { password }, null, { Origin: 'https://evil.example' })).status, 403);
  const preflight = await fetch(f.url + '/api/admin/users', { method: 'OPTIONS', headers: { Origin: adminOrigin, 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'authorization,content-type' } });
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get('access-control-allow-origin'), adminOrigin);
  for (let i = 0; i < 5; i++) assert.equal((await f.request('/api/admin/login', { password: 'bad' })).status, 401);
  const limited = await f.request('/api/admin/login', { password }); assert.equal(limited.status, 429); assert.ok(limited.headers.get('retry-after'));
});
test('admin: password login works before a student directory is created', async t => {
  const f = await fixture(t), token = await f.rawLogin();
  const data = await (await f.request('/api/admin/users', {}, token)).json();
  assert.equal(data.students.length, 0);
});
test('admin: shared one-day session refreshes directory without another password; invalid sync is atomic', async t => {
  const f = await fixture(t), token = await f.login();
  f.advance(3600_000);
  assert.equal((await f.request('/api/admin/users', {}, token)).status, 200);
  assert.equal((await f.request('/api/admin/sync', { config: f.data.config })).status, 401);
  f.data.config.courses[2].students.push({ id: 's4', name: 'Новый Студент' });
  assert.equal((await f.sync(token)).status, 200);
  let data = await (await f.request('/api/admin/users', {}, token)).json(); assert.equal(data.students.length, 4);
  assert.equal((await f.sync(token, { courses: {} })).status, 400);
  data = await (await f.request('/api/admin/users', {}, token)).json(); assert.equal(data.students.length, 4);
});
test('admin: ticket orders source reads, rejects replay and delayed old snapshots', async t => {
  const f = await fixture(t), token = await f.rawLogin();
  const oldTicket = (await (await f.request('/api/admin/sync/start', {}, token)).json()).ticket;
  const oldConfig = structuredClone(f.data.config);
  f.advance(1000); f.data.config.courses[2].students[0].to = '2020-01-01';
  await f.sync(token);
  const old = await f.request('/api/admin/sync', { config: oldConfig, ticket: oldTicket }, token);
  assert.equal(old.status, 409);
  const list = await (await f.request('/api/admin/users', {}, token)).json();
  assert.equal(list.students.find(s => s.id === 's1').active, false);
  assert.equal((await f.request('/api/admin/sync', { config: oldConfig, ticket: oldTicket }, token)).status, 409);
});
