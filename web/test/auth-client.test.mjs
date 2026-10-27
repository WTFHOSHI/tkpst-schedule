import test from 'node:test';
import assert from 'node:assert/strict';
import { createAuthClient } from '../js/auth-client.js';
import { profileMarkup } from '../js/auth-view.js';

const reply = (data, status = 200) => new Response(status === 204 ? null : JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
const user = { id: 'one', username: 'student', displayName: 'Студент' };
test('вход передаёт данные серверу с cookie и без кэширования', async () => {
  let request;
  const client = createAuthClient(async (path, options) => { request = { path, options }; return reply({ user }); });
  await client.authenticate('login', { username: 'student', password: 'example-password' });
  assert.equal(client.state().user.id, 'one');
  assert.equal(request.path, '/api/auth/login');
  assert.equal(request.options.credentials, 'same-origin');
  assert.equal(request.options.cache, 'no-store');
});
test('старый ответ проверки сеанса не отменяет успешный вход', async () => {
  let finish;
  const client = createAuthClient(path => path.endsWith('/session') ? new Promise(resolve => { finish = resolve; }) : Promise.resolve(reply({ user })));
  const restore = client.restore();
  await client.authenticate('login', { username: 'student', password: 'example-password' });
  finish(reply({ user: null })); await restore;
  assert.equal(client.state().user.id, 'one');
});
test('ошибка выхода не выдаётся за успешный выход, 401 закрывает личный журнал', async () => {
  const client = createAuthClient(async path => path.endsWith('/login') ? reply({ user }) : path.endsWith('/logout') ? reply({ error: 'Ошибка сервера' }, 503) : reply({ error: 'Нужен вход' }, 401));
  await client.authenticate('login', {});
  await assert.rejects(client.logout(), /Ошибка сервера/);
  assert.equal(client.state().user.id, 'one');
  await assert.rejects(client.grades(), /Нужен вход/);
  assert.equal(client.state().user, null);
});
test('статический хостинг с HTML вместо API не создаёт фиктивный сеанс', async () => {
  const client = createAuthClient(async () => new Response('<html>404</html>', { status: 404 }));
  await client.restore();
  assert.equal(client.state().status, 'unavailable');
  assert.equal(client.state().user, null);
});
test('имя и логин в профиле экранируются', () => {
  const markup = profileMarkup({ displayName: '<img src=x onerror=alert(1)>', username: '<script>bad</script>' });
  assert.ok(!markup.includes('<script>'));
  assert.ok(!markup.includes('<img src=x'));
  assert.ok(markup.includes('&lt;img'));
});

test('приватные чтения используют POST, чтобы старый офлайн-кэш не сохранил профиль', async () => {
  const calls = [];
  const client = createAuthClient(async (path, options) => { calls.push(options); return reply(path.endsWith('/session') ? { user } : { connected: false, subjects: [] }); });
  await client.restore(); await client.grades();
  for (const options of calls) { assert.equal(options.method, 'POST'); assert.equal(options.body, '{}'); }
});

test('поздний 401 старого журнала не отменяет новый вход', async () => {
  let finish;
  const client = createAuthClient(async path => {
    if (path === '/api/grades') return new Promise(resolve => { finish = resolve; });
    if (path.endsWith('/logout')) return reply(null, 204);
    return reply({ user });
  });
  await client.authenticate('login', {});
  const stale = client.grades();
  await client.logout(); await client.authenticate('login', {});
  finish(reply({ error: 'Старый сеанс истёк' }, 401));
  await assert.rejects(stale);
  assert.equal(client.state().user.id, 'one');
});

test('attendance posts only selected month using private session cookie', async () => {
  let request;
  const client = createAuthClient(async (path, options) => { request = { path, options }; return reply({ linked: false, records: [] }); });
  await client.attendance('2026-10');
  assert.equal(request.path, '/api/attendance');
  assert.equal(request.options.body, '{"month":"2026-10"}');
  assert.equal(request.options.method, 'POST');
  assert.equal(request.options.credentials, 'same-origin');
  assert.equal(request.options.cache, 'no-store');
});

test('stale attendance 401 cannot clear a newer login but current 401 clears session', async () => {
  let finish;
  const client = createAuthClient(async path => path === '/api/attendance'
    ? new Promise(resolve => { finish = resolve; }) : reply({ user }));
  await client.authenticate('login', {});
  const stale = client.attendance('2026-10');
  await client.authenticate('login', {});
  finish(reply({ error: 'Сеанс истёк' }, 401));
  await assert.rejects(stale);
  assert.equal(client.state().user.id, 'one');
  const current = client.attendance('2026-11');
  finish(reply({ error: 'Сеанс истёк' }, 401));
  await assert.rejects(current);
  assert.equal(client.state().user, null);
});
