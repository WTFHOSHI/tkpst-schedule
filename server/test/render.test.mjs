import test from 'node:test';
import assert from 'node:assert/strict';
import { createAdminApiServer } from '../render-http.mjs';
test('Render API serves health and admin routes only, never source/private files or student cookies', async t => {
  let calls = 0;
  const server = createAdminApiServer({ publicOrigin: 'https://test.onrender.com', handler: async (req, res) => { calls++; res.writeHead(401, { 'Content-Type': 'application/json' }); res.end('{"error":"unauthorized"}'); } });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = 'http://127.0.0.1:' + server.address().port;
  assert.equal((await fetch(base + '/health')).status, 200);
  for (const path of ['/', '/.env', '/server/.data/accounts.sqlite', '/api/auth/session']) assert.equal((await fetch(base + path)).status, 404);
  const r = await fetch(base + '/api/admin/users', { method: 'POST', body: '{}', headers: { 'Content-Type': 'application/json' } });
  assert.equal(r.status, 401); assert.equal(r.headers.get('cache-control'), 'no-store'); assert.equal(calls, 1);
});
