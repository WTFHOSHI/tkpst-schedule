import test from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { createPostgresStore, migratePostgres } from '../postgres-store.mjs';
import { createSQLiteStore } from '../sqlite-store.mjs';
import { createAccounts } from '../accounts.mjs';
import { createAdminService } from '../admin-service.mjs';
import { createAuthServer } from '../http.mjs';
import { randomBytes, pbkdf2Sync, createCipheriv } from 'node:crypto';

const now = Date.parse('2026-10-27T10:00:00Z');
const week = () => ({ m: { s1: { '2026-10-26': { 1: 'P', 2: 'N', 3: 'B', 4: 'U', 5: 'R', 6: 'Z', 7: 'N' }, '2026-10-27': { 1: '' } }, s2: { '2026-10-26': { 1: 'N' } } }, pairs: {}, hide: { '2026-10-26': [7] }, at: '2026-10-27T09:00:00Z', by: 'Private editor' });
const emptyWeek = () => ({ m: {}, pairs: {}, hide: {}, at: '' });
async function persistence(t, engine) {
  if (engine === 'SQLite') { const store = createSQLiteStore(':memory:'); t.after(() => store.close()); return store; }
  const db = new PGlite(); t.after(() => db.close());
  const driver = { query: async (text, params) => (await db.query(text, params)).rows, transaction: statements => db.transaction(async tx => { const result = []; for (const s of statements) result.push((await tx.query(s.text, s.params)).rows); return result; }) };
  await migratePostgres(driver); await migratePostgres(driver); return createPostgresStore(driver);
}
for (const engine of ['SQLite', 'Postgres']) test(`${engine}: private attendance replaces snapshots and rejects replay, wrong binding and same-clock stale writes`, async t => {
  const store = await persistence(t, engine), accounts = await createAccounts({ store, now: () => now });
  const a = await accounts.register({ username: 'first', displayName: 'Account name', password: 'Student password phrase' });
  const b = await accounts.register({ username: 'second', displayName: 'Second account', password: 'Student password phrase' });
  await store.replaceRoster([{ course: '2', id: 's1', name: 'Private source name', groupName: 'ИС', from: '2026-10-26' }, { course: '2', id: 's2', name: 'Other private name', groupName: 'ИС' }], now);
  await store.linkStudent(a.user.id, '2', 's1', '2026-10-27'); await store.linkStudent(b.user.id, '2', 's2', '2026-10-27');
  const admin = createAdminService({ store, now: () => now });
  const start = (token = 'actor', course = '2', monday = '2026-10-26') => admin.beginAttendance({ course, monday }, token);
  const sync = (ticket, source = week(), token = 'actor', course = '2', monday = '2026-10-26') => admin.syncAttendance({ course, monday, ticket, week: source }, token);
  const old = await start(), fresh = await start();
  await assert.rejects(sync(fresh.ticket, week(), 'another'), e => e.status === 409);
  await assert.rejects(sync(fresh.ticket, week(), 'actor', '1'), e => e.status === 409);
  assert.equal((await sync(fresh.ticket)).ok, true);
  await assert.rejects(sync(old.ticket), e => e.status === 409);
  await assert.rejects(sync(fresh.ticket), e => e.status === 409);
  const result = await accounts.attendance(a.token, { month: '2026-10' });
  assert.equal(result.linked, true); assert.equal(result.month, '2026-10'); assert.equal(result.syncedAt, now);
  assert.deepEqual(result.records, [1,2,3,4,5,6].map((pair, i) => ({ date: '2026-10-26', pair, status: ['P','N','B','U','R','Z'][i] })));
  assert.deepEqual(result.counts, { P: 1, N: 1, B: 1, U: 1, R: 1, Z: 1, marked: 6, attended: 1, missed: 5, unexcused: 1 });
  assert.ok(!JSON.stringify(result).includes('Private')); assert.ok(!JSON.stringify(result).includes('s2'));
  assert.equal((await accounts.attendance(b.token, { month: '2026-10' })).records[0].status, 'N');
  const legacy = week(); delete legacy.hide;
  const legacyTicket = await start(); await sync(legacyTicket.ticket, legacy);
  assert.equal((await accounts.attendance(a.token, { month: '2026-10' })).records.length, 7, 'legacy weeks without hide mean no hidden pairs');
  const restore = await start(); await sync(restore.ticket);
  for (const hide of [null, [], { '2026-10-26': [9] }]) {
    const malformed = await start();
    await assert.rejects(sync(malformed.ticket, { ...week(), hide }), e => e.status === 400, 'provided malformed hide remains invalid');
  }
  const boundary = await start('actor', '2', '2026-09-28');
  await sync(boundary.ticket, { m: { s1: { '2026-09-30': { 1: 'P' }, '2026-10-01': { 2: 'P' } } }, pairs: {}, hide: {}, at: '' }, 'actor', '2', '2026-09-28');
  assert.equal((await accounts.attendance(a.token, { month: '2026-09' })).records.length, 0, 'enrollment dates exclude older records');
  assert.equal((await accounts.attendance(b.token, { month: '2026-09' })).syncedAt, now, 'overlapping week establishes sync even without student marks');
  const clear = await start(); await sync(clear.ticket, emptyWeek());
  assert.deepEqual((await accounts.attendance(a.token, { month: '2026-10' })).records, []);
  await store.linkStudent(a.user.id, '', null, '2026-10-27');
  assert.equal((await accounts.attendance(a.token, { month: '2026-10' })).linked, false);
  await store.linkStudent(a.user.id, '2', 's1', '2026-10-27');
  await store.replaceRoster([{ course: '2', id: 's1', name: 'Private source name', groupName: 'ИС', to: '2026-10-26' }], now + 1);
  assert.equal((await accounts.attendance(a.token, { month: '2026-10' })).linked, false);
  await assert.rejects(accounts.attendance(a.token, { month: '2026-10', studentId: 's2' }), e => e.status === 400);
  await assert.rejects(accounts.attendance('anonymous', { month: '2026-10' }), e => e.status === 401);
  for (const month of ['2026-13', '2026-1', '0000-01', '2101-01', null]) await assert.rejects(accounts.attendance(b.token, { month }), e => e.status === 400);
  await assert.rejects(start('actor', '2', '2026-10-27'), e => e.status === 400);
  await assert.rejects(start('actor', '2', '2026-02-30'), e => e.status === 400);
  for (const source of [ { ...week(), m: { s1: { '2026-11-02': { 1: 'P' } } } }, { ...week(), m: { s1: { '2026-10-26': { 0: 'P' } } } }, { ...week(), m: { s1: { '2026-10-26': { 1: 'X' } } } }, JSON.parse('{"m":{"__proto__":{}},"pairs":{},"hide":{},"at":""}'), { ...week(), m: Object.fromEntries(Array.from({ length: 501 }, (_, i) => ['s' + i, {}])) } ]) {
    const ticket = await start(); await assert.rejects(sync(ticket.ticket, source), e => e.status === 400);
  }
});
function seal(key, data, role) {
  const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', key, iv); cipher.setAAD(Buffer.from('vault:' + role));
  const ct = Buffer.concat([cipher.update(JSON.stringify(data)), cipher.final(), cipher.getAuthTag()]);
  return { v: 1, iv: iv.toString('base64'), ct: ct.toString('base64') };
}
test('attendance HTTP: real role vault logins are scoped, revocable, rotated, bounded and private', async t => {
  const password = 'Role password fixture', salt = randomBytes(16), key = pbkdf2Sync(password, salt, 100000, 32, 'sha256');
  const vault = { v: 1, kdf: 'PBKDF2-SHA256', iter: 100000, salt: salt.toString('base64'), roles: Object.fromEntries(['admin','kurator','starosta'].map(role => [role, seal(key, { role, gh: 'private-github-key', dk: randomBytes(32).toString('base64') }, role)])) };
  const store = createSQLiteStore(':memory:'); let clock = now;
  const app = await createAuthServer({ store, publicOrigin: 'http://127.0.0.1:4173', now: () => clock, adminFetch: async () => Response.json(vault) });
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve)); t.after(async () => { await new Promise(resolve => app.server.close(resolve)); app.close(); });
  const url = 'http://127.0.0.1:' + app.server.address().port;
  const request = (path, body = {}, token, headers = {}, method = 'POST') => fetch(url + path, { method, headers: { Origin: path.startsWith('/api/admin/') ? 'https://wtfhoshi.github.io' : 'http://127.0.0.1:4173', 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}), ...headers }, ...(method === 'POST' ? { body: JSON.stringify(body) } : {}) });
  assert.equal((await request('/api/attendance')).status, 401);
  const registered = await request('/api/auth/register', { username: 'student', displayName: 'Student', password: 'Student password phrase' }); const cookie = registered.headers.get('set-cookie').split(';')[0];
  const read = await request('/api/attendance', { month: '2026-10' }, null, { Cookie: cookie }); assert.equal(read.status, 200); assert.equal(read.headers.get('cache-control'), 'no-store'); assert.equal((await read.json()).linked, false);
  assert.equal((await request('/api/attendance', {}, null, { Cookie: cookie }, 'GET')).status, 405);
  assert.equal((await request('/api/attendance', {}, null, { Cookie: cookie, Origin: 'https://evil.example' })).status, 403);
  for (const role of ['admin','kurator','starosta']) {
    const login = await request('/api/admin/attendance/login', { password, role }); assert.equal(login.status, 200, await login.clone().text()); const session = await login.json();
    assert.deepEqual(Object.keys(session).sort(), ['expiresAt', 'token']);
    assert.equal(session.expiresAt, role === 'kurator' ? clock + 864e5 : 0);
    if (role !== 'kurator') { clock += 5 * 365 * 864e5; }
    assert.equal((await request('/api/admin/users', {}, session.token)).status, 401);
    assert.equal((await request('/api/admin/link', {}, session.token)).status, 401);
    const start = await request('/api/admin/attendance/start', { course: '2', monday: '2026-10-26' }, session.token); assert.equal(start.status, 200);
    assert.equal((await request('/api/admin/attendance/sync', { course: '2', monday: '2026-10-26', ticket: (await start.json()).ticket, week: week() }, session.token)).status, 200);
    assert.equal((await request('/api/admin/attendance/sync', { filler: 'x'.repeat(512 * 1024) }, session.token)).status, 413);
    assert.equal((await request('/api/admin/attendance/logout', {}, session.token)).status, 204);
    assert.equal((await request('/api/admin/attendance/start', { course: '2', monday: '2026-10-26' }, session.token)).status, 401);
  }
  const normal = await (await request('/api/admin/login', { password })).json();
  assert.equal((await request('/api/admin/attendance/start', { course: '2', monday: '2026-10-26' }, normal.token)).status, 200);
  const rotated = await (await request('/api/admin/attendance/login', { password, role: 'starosta' })).json();
  vault.roles.starosta = seal(key, { role: 'starosta', gh: 'changed', dk: randomBytes(32).toString('base64') }, 'starosta');
  assert.equal((await request('/api/admin/attendance/start', { course: '2', monday: '2026-10-26' }, rotated.token)).status, 401);
  for (let i = 0; i < 3; i++) assert.equal((await request('/api/admin/attendance/login', { password, role: 'teacher' })).status, 401);
  assert.equal((await request('/api/admin/attendance/login', { password, role: 'teacher' })).status, 429, 'role exchange shares durable password throttling');
});
