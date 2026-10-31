import test from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { createPostgresStore, migratePostgres } from '../postgres-store.mjs';
import { createAccounts } from '../accounts.mjs';

test('Postgres: два экземпляра разделяют пользователей, сеансы и лимиты', async t => {
  const db = new PGlite(); t.after(() => db.close());
  const driver = {
    query: async (text, params) => (await db.query(text, params)).rows,
    transaction: statements => db.transaction(async tx => {
      const results = []; for (const s of statements) results.push((await tx.query(s.text, s.params)).rows); return results;
    }),
  };
  await migratePostgres(driver); await migratePostgres(driver);
  const first = await createAccounts({ store: createPostgresStore(driver) });
  const second = await createAccounts({ store: createPostgresStore(driver) });
  const credentials = { username: 'student', displayName: 'Студент', password: 'Long-password-12345' };
  const created = await first.register(credentials);
  assert.equal((await second.session(created.token)).id, created.user.id);
  await assert.rejects(second.register(credentials), error => error.status === 409);
  const login = await second.login({ username: 'STUDENT', password: credentials.password }, created.token);
  assert.equal(await first.session(created.token), null);
  assert.equal((await first.session(login.token)).id, created.user.id);
  await first.logout(login.token); assert.equal(await second.session(login.token), null);
  const oldSession = await first.login({username:'student',password:credentials.password});
  await second.resetPassword({username:'STUDENT',password:'новый6'});
  assert.equal(await first.session(oldSession.token),null);
  await assert.rejects(first.login({username:'student',password:credentials.password}),error=>error.status===401);
  assert.ok((await first.login({username:'student',password:'новый6'})).token);
  assert.equal((await first.consumeRateLimit('shared', 2, 1000, 1)).allowed, true);
  assert.equal((await second.consumeRateLimit('shared', 2, 1000, 2)).allowed, true);
  assert.equal((await first.consumeRateLimit('shared', 2, 1000, 3)).allowed, false);
  assert.equal((await second.consumeRateLimit('shared', 2, 1000, 1002)).allowed, true);
});

test('Postgres: атомарная регистрация и отсутствие частичного аккаунта', async t => {
  const db = new PGlite(); t.after(() => db.close());
  const driver = {
    query: async (text, params) => (await db.query(text, params)).rows,
    transaction: statements => db.transaction(async tx => { const results = []; for (const s of statements) results.push((await tx.query(s.text, s.params)).rows); return results; }),
  };
  await migratePostgres(driver);
  const store = createPostgresStore(driver);
  await assert.rejects(store.createUserWithSession({ id: 'one', username: 'bad_session', display_name: 'Имя', password_hash: 'hash', created_at: 1 }, { tokenHash: 'token', userId: 'missing', expiresAt: 100 }, null, 1));
  assert.equal(await store.findUser('bad_session'), null);
  const a = await createAccounts({ store }); const b = await createAccounts({ store: createPostgresStore(driver) });
  const body = { username: 'concurrent', displayName: 'Имя', password: 'Long-password-12345' };
  const result = await Promise.allSettled([a.register(body), b.register(body)]);
  assert.equal(result.filter(r => r.status === 'fulfilled').length, 1);
  assert.equal(result.find(r => r.status === 'rejected').reason.status, 409);
});
