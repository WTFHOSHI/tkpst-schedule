import test from 'node:test';
import assert from 'node:assert/strict';
import { shouldWarm, warmAccount } from '../keep-render-awake.mjs';

test('warmup runs from shortly before 07:00 until 23:00 Tyumen time', () => {
  for (const [utc, expected] of [
    ['2026-10-29T01:49:00Z', false],
    ['2026-10-29T01:50:00Z', true],
    ['2026-10-29T02:00:00Z', true],
    ['2026-10-29T17:59:00Z', true],
    ['2026-10-29T18:00:00Z', false],
  ]) assert.equal(shouldWarm(new Date(utc)), expected, utc);
});

test('warmup requests only the public manifest and checks the response', async () => {
  let calls = 0;
  const fetcher = async (url, options) => {
    calls++;
    assert.equal(url, 'https://tkpst-schedule.onrender.com/manifest.webmanifest');
    assert.equal(options.method, 'HEAD');
    assert.equal(options.redirect, 'error');
    return { status: 200, headers: new Headers({ 'content-type': 'application/manifest+json' }) };
  };
  assert.match(await warmAccount({ now: new Date('2026-10-29T02:00:00Z'), fetcher }), /responding/);
  assert.equal(calls, 1);
  assert.match(await warmAccount({ now: new Date('2026-10-29T18:00:00Z'), fetcher }), /skipped/);
  assert.equal(calls, 1);
  await assert.rejects(warmAccount({ now: new Date('2026-10-29T02:00:00Z'), fetcher: async () => ({ status: 200, headers: new Headers({ 'content-type': 'text/html' }) }) }), /did not return its manifest/);
});
