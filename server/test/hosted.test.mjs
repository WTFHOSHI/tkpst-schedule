import test from 'node:test';
import assert from 'node:assert/strict';
import { hostedOptions } from '../hosted-config.mjs';
import { createAuthServer } from '../http.mjs';
import { createSQLiteStore } from '../sqlite-store.mjs';

const env = { DATABASE_URL: 'postgresql://fixture:password@fixture.neon.tech/neondb', RENDER_EXTERNAL_URL: 'https://student.onrender.com', PORT: '10000' };

test('hosted startup requires database and a fixed HTTPS origin; request headers never select it', () => {
  const options = hostedOptions(env);
  assert.equal(options.publicOrigin, env.RENDER_EXTERNAL_URL);
  assert.equal(options.port, 10000);
  assert.equal(options.host, '0.0.0.0');
  assert.equal(options.databaseUrl, env.DATABASE_URL);
  assert.throws(() => hostedOptions({ ...env, DATABASE_URL: '' }), /DATABASE_URL/);
  for (const value of ['http://student.onrender.com', 'https://user:pass@student.onrender.com', 'https://student.onrender.com/path', 'https://student.onrender.com/?x=1', 'https://student.onrender.com/#hash']) {
    assert.throws(() => hostedOptions({ ...env, PUBLIC_ORIGIN: value }), /origin/i);
  }
  for (const port of ['0', '-1', '65536', 'NaN', '3.5']) assert.throws(() => hostedOptions({ ...env, PORT: port }), /PORT/);
});

test('hosted overrides use the fixed live source, with no private caching and safe upstream failure', async t => {
  const source = 'https://wtfhoshi.github.io/tkpst-schedule/overrides.json';
  let failed = false, reads = 0;
  const app = await createAuthServer({ store: createSQLiteStore(':memory:'), overridesSource: source, fetchImpl: async (url, options) => {
    assert.equal(url, source); assert.equal(options.redirect, 'error'); reads++;
    return failed ? new Response('unavailable', { status: 503 }) : Response.json({ announcement: 'Актуальное объявление', days: {} });
  } });
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { await new Promise(resolve => app.server.close(resolve)); app.close(); });
  const url = `http://127.0.0.1:${app.server.address().port}/overrides.json?refresh=1`;
  const response = await fetch(url);
  assert.equal(response.status, 200);
  assert.equal((await response.json()).announcement, 'Актуальное объявление');
  assert.match(response.headers.get('cache-control'), /no-store/);
  failed = true;
  assert.equal((await fetch(url)).status, 503);
  assert.equal(reads, 2);
});
