import test from 'node:test';
import assert from 'node:assert/strict';
import { allowedOrigin, vercelAddress } from '../vercel-config.mjs';
import { createCloudHandler } from '../cloud.mjs';

const env = { VERCEL: '1', VERCEL_ENV: 'production', VERCEL_URL: 'unique.vercel.app', VERCEL_PROJECT_PRODUCTION_URL: 'student.vercel.app' };
test('GitHub admin origin is limited to the admin API', () => {
  assert.equal(allowedOrigin({ url: '/api/admin/users', headers: { origin: 'https://wtfhoshi.github.io' } }, env), 'https://unique.vercel.app');
  assert.throws(() => allowedOrigin({ url: '/api/auth/session', headers: { origin: 'https://wtfhoshi.github.io' } }, env));
});
test('Vercel origin берётся из доверенной конфигурации, а не Host запроса', () => {
  assert.equal(allowedOrigin({ headers: { origin: 'https://student.vercel.app' } }, env), 'https://student.vercel.app');
  assert.equal(allowedOrigin({ headers: { origin: 'https://unique.vercel.app' } }, env), 'https://unique.vercel.app');
  assert.throws(() => allowedOrigin({ headers: { origin: 'https://evil.example', host: 'evil.example' } }, env));
  assert.throws(() => allowedOrigin({ headers: { origin: 'http://student.vercel.app' } }, env));
  assert.throws(() => allowedOrigin({ headers: { origin: 'https://student.vercel.app' } }, { ...env, VERCEL_ENV: 'preview' }));
});
test('Vercel IP проверяется, отсутствующий IP не отключает общий лимит', () => {
  assert.equal(vercelAddress({ headers: { 'x-vercel-forwarded-for': '203.0.113.5' } }), '203.0.113.5');
  assert.equal(vercelAddress({ headers: {} }), 'unknown');
  assert.equal(vercelAddress({ headers: { 'x-vercel-forwarded-for': 'attacker' } }), 'unknown');
});
test('облако без DATABASE_URL отказывает без SQLite и не раскрывает конфигурацию', async () => {
  const handler = createCloudHandler({ env });
  const res = { headers: {}, setHeader(k,v) { this.headers[k]=v; }, writeHead(status,headers) { this.status=status;Object.assign(this.headers,headers); }, end(text) { this.body=text;this.writableEnded=true; } };
  await handler({ method:'POST',url:'/api/auth/session',headers:{origin:'https://student.vercel.app','content-type':'application/json'},body:{} },res);
  assert.equal(res.status,503); assert.equal(res.headers['Cache-Control'],'no-store');
  assert.ok(!res.body.includes('DATABASE_URL'));
});
