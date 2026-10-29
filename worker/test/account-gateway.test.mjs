import test from 'node:test';
import assert from 'node:assert/strict';
import gateway from '../account-gateway.mjs';

const origin = 'https://tkpst-account.example.workers.dev';
const api = origin + '/api/auth/session';
const request = (path = api, init = {}) => {
  const { headers = {}, ...options } = init;
  return new Request(path, {
    method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json', ...headers },
    body: '{}', ...options,
  });
};
const assets = { fetch: () => new Response('static') };

test('one-origin account proxy forwards host-only cookies and a fixed upstream origin', async t => {
  const original = globalThis.fetch;
  t.after(() => { globalThis.fetch = original; });
  globalThis.fetch = async (url, init) => {
    assert.equal(url, 'https://tkpst-schedule.vercel.app/api/auth/session');
    assert.equal(init.headers.get('Origin'), 'https://tkpst-schedule.vercel.app');
    assert.equal(init.headers.get('Cookie'), '__Host-tkpst_session=example');
    assert.equal(init.redirect, 'manual');
    return Response.json({ user: null }, { headers: { 'Set-Cookie': '__Host-tkpst_session=next; Path=/; Secure; HttpOnly; SameSite=Lax' } });
  };
  const response = await gateway.fetch(request(api, { headers: { Cookie: '__Host-tkpst_session=example' } }), { ASSETS: assets });
  assert.equal(response.status, 200);
  assert.match(response.headers.get('Set-Cookie'), /HttpOnly/);
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
});

test('foreign origins and admin paths cannot use the account proxy', async () => {
  assert.equal((await gateway.fetch(request(api, { headers: { Origin: 'https://evil.example' } }), { ASSETS: assets })).status, 403);
  assert.equal((await gateway.fetch(request(origin + '/api/admin/users'), { ASSETS: assets })).status, 404);
});

test('static pages stay on the Worker and health is independent of the upstream', async () => {
  const response = await gateway.fetch(new Request(origin + '/#/login'), { ASSETS: assets });
  assert.equal(response.status, 200);
  assert.equal(await response.text(), 'static');
  const health = await gateway.fetch(new Request(origin + '/health'), { ASSETS: assets });
  assert.equal(health.status, 200);
  assert.deepEqual(await health.json(), { status: 'ok' });
});
