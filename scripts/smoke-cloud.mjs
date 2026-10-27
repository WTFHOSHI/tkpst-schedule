// Isolated HTTP cookie jar: never touches an open browser's account/session.
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
const origin = process.argv[2];
if (!origin?.startsWith('https://')) throw new Error('Pass an HTTPS application origin.');
const username = 'qa_cloud_' + Date.now().toString(36);
const password = randomBytes(24).toString('base64url');
let cookie;
async function call(path, body = {}) {
  const r = await fetch(origin + '/api/' + path, { method:'POST', headers:{Origin:origin,'Content-Type':'application/json',...(cookie?{Cookie:cookie}:{})},body:JSON.stringify(body),signal:AbortSignal.timeout(25_000) });
  const header=r.headers.get('set-cookie'); if(header) cookie=header.split(';')[0];
  assert.match(r.headers.get('cache-control'),/no-store/);
  return {status:r.status,data:r.status===204?null:await r.json(),header};
}
try {
  const created=await call('auth/register',{username,displayName:'Проверка публикации',password});
  assert.equal(created.status,201); assert.equal(created.data.user.username,username);
  assert.match(created.header,/Secure/); assert.match(created.header,/HttpOnly/);
  const id=created.data.user.id;
  assert.equal((await call('auth/session')).data.user.id,id);
  assert.equal((await call('account')).data.user.id,id);
  assert.deepEqual((await call('grades')).data,{connected:false,subjects:[]});
  assert.equal((await call('auth/logout')).status,204);
  assert.equal((await call('auth/session')).data.user,null);
  assert.equal((await call('grades')).status,401);
  assert.equal((await call('auth/login',{username,password:'wrong-password'})).status,401);
  assert.equal((await call('auth/login',{username,password})).data.user.id,id);
  assert.equal((await call('auth/logout')).status,204);
  const get=await fetch(origin+'/api/auth/session'); assert.equal(get.status,405);
  for(const path of ['/server/.data/accounts.sqlite','/.env.cloud','/server/accounts.mjs']) assert.ok([403,404].includes((await fetch(origin+path)).status), 'Private files must be forbidden or absent: '+path);
  console.log('Cloud smoke passed: register, session, profile, private grades, logout, login, cookies, cache and private files.');
} catch(error) { console.error('Cloud smoke failed: '+error.message); process.exitCode=1; }
