import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const source = readFileSync(new URL('../sw.js', import.meta.url), 'utf8');

function worker(hostname, fetcher) {
  const listeners = {};
  const origin = `https://${hostname}`;
  const cache = new Response('cached shell', { headers: { 'content-type': 'text/html' } });
  const context = {
    self: { location: { hostname }, addEventListener: (type, listener) => { listeners[type] = listener; } },
    location: { origin }, URL, Response, fetch: fetcher,
    caches: { match: async () => cache.clone(), open: async () => ({ put: async () => {} }) },
  };
  runInNewContext(source, context);
  return listeners.fetch;
}

test('Render returns cached shell while the server is still waking', async () => {
  const pendingNetwork = new Promise(() => {});
  const onFetch = worker('tkpst-schedule.onrender.com', () => pendingNetwork);
  let responsePromise, background;
  onFetch({
    request: new Request('https://tkpst-schedule.onrender.com/'),
    respondWith: promise => { responsePromise = promise; },
    waitUntil: promise => { background = promise; },
  });
  const response = await Promise.race([responsePromise, new Promise((_, reject) => setTimeout(() => reject(new Error('shell waited for network')), 100))]);
  assert.equal(await response.text(), 'cached shell');
  assert.ok(background);
});

test('service worker never intercepts private API requests', () => {
  const onFetch = worker('tkpst-schedule.onrender.com', () => { throw new Error('should not fetch'); });
  let intercepted = false;
  onFetch({ request: new Request('https://tkpst-schedule.onrender.com/api/auth/session', { method: 'POST' }), respondWith: () => { intercepted = true; } });
  assert.equal(intercepted, false);
});

test('service worker leaves dated schedule API to its date-specific application cache', () => {
  const onFetch = worker('tkpst-account.telling-math.workers.dev', () => { throw new Error('should not fetch'); });
  let intercepted = false;
  onFetch({
    request: new Request('https://tkpst-account.telling-math.workers.dev/schedule_api/tyumen/groups/196/schedules?date=2026-10-30'),
    respondWith: () => { intercepted = true; },
  });
  assert.equal(intercepted, false);
});
