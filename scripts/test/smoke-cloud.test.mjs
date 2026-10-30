import test from 'node:test';
import assert from 'node:assert/strict';

test('cloud smoke accepts an SPA shell instead of a private file', async () => {
  const originalFetch = globalThis.fetch;
  const originalArg = process.argv[2];
  const originalExitCode = process.exitCode;
  const originalLog = console.log;
  const originalError = console.error;
  const messages = [];
  let signedIn = false;
  let username;
  let password;
  const user = { id: 'synthetic-id' };
  const shell = '<!doctype html><div id="app"></div>';
  const json = (data, status = 200, cookie = false) => Response.json(data, {
    status, headers: { 'Cache-Control': 'no-store', ...(cookie ? { 'Set-Cookie': '__Host-tkpst_session=fake; Secure; HttpOnly; Path=/' } : {}) },
  });
  globalThis.fetch = async (url, init = {}) => {
    const path = new URL(url).pathname;
    const body = init.body ? JSON.parse(init.body) : {};
    if (path === '/api/auth/register') {
      username = body.username; password = body.password; signedIn = true;
      return json({ user: { ...user, username } }, 201, true);
    }
    if (path === '/api/auth/session') return init.method === 'POST' ? json({ user: signedIn ? user : null }) : json({ error: 'method' }, 405);
    if (path === '/api/account') return json({ user });
    if (path === '/api/grades') return signedIn ? json({ connected: false, subjects: [] }) : json({ error: 'unauthorized' }, 401);
    if (path === '/api/auth/logout') { signedIn = false; return new Response(null, { status: 204, headers: { 'Cache-Control': 'no-store' } }); }
    if (path === '/api/auth/login') {
      if (body.username !== username || body.password !== password) return json({ error: 'invalid' }, 401);
      signedIn = true; return json({ user }, 200, true);
    }
    return new Response(shell, { status: 200, headers: { 'Content-Type': 'text/html' } });
  };
  process.argv[2] = 'https://example.test';
  process.exitCode = 0;
  console.log = (...args) => messages.push(args.join(' '));
  console.error = (...args) => messages.push(args.join(' '));
  let result;
  try {
    await import('../smoke-cloud.mjs?spa-test');
    result = process.exitCode;
  } finally {
    globalThis.fetch = originalFetch;
    process.argv[2] = originalArg;
    process.exitCode = originalExitCode;
    console.log = originalLog;
    console.error = originalError;
  }
  assert.equal(result, 0, messages.join('\n'));
});
