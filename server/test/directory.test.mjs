import test from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { createPostgresStore, migratePostgres } from '../postgres-store.mjs';
import { createSQLiteStore } from '../sqlite-store.mjs';
import { directoryStudent } from '../directory-store.mjs';
import { validateRoster } from '../admin-service.mjs';

for (const engine of ['SQLite', 'Postgres']) test(`${engine}: directory snapshot, complete pagination/search, atomic unique linking and admin sessions`, async t => {
  let store;
  if (engine === 'SQLite') { store = createSQLiteStore(':memory:'); t.after(() => store.close()); }
  else {
    const db = new PGlite(); t.after(() => db.close());
    const driver = { query: async (text, params) => (await db.query(text, params)).rows, transaction: statements => db.transaction(async tx => { const rows = []; for (const s of statements) rows.push((await tx.query(s.text, s.params)).rows); return rows; }) };
    await migratePostgres(driver); await migratePostgres(driver); store = createPostgresStore(driver);
  }
  for (let i = 0; i < 105; i++) await store.createUserWithSession({ id: 'u' + i, username: 'name' + i, display_name: i === 0 ? 'literal%name' : 'Студент', password_hash: 'not-a-password', created_at: i }, { tokenHash: 'hash' + i, userId: 'u' + i, expiresAt: 9999999 }, null, 0);
  await store.replaceRoster([{ course: '2', id: 's1', name: 'Имя из админки', groupName: 'ИС' }], 123);
  assert.equal((await store.registeredUsers('', 0)).users.length, 100);
  assert.equal((await store.registeredUsers('', 100)).users.length, 5);
  assert.equal((await store.registeredUsers('', 0)).total, 105);
  assert.equal((await store.registeredUsers('%', 0)).total, 1, 'search must treat wildcard literally');
  assert.equal(await store.linkStudent('u0', '2', 's1', '2026-10-27'), true);
  await assert.rejects(store.linkStudent('u1', '2', 's1', '2026-10-27'));
  assert.equal((await store.directoryForUser('u0')).name, 'Имя из админки');
  await store.replaceRoster([{ course: '2', id: 'stale', name: 'Устаревший ответ', groupName: 'ИС' }], 122);
  assert.equal((await store.directoryForUser('u0')).name, 'Имя из админки', 'an older fetch must not replace a newer roster');
  assert.equal((await store.registeredUsers('имя из', 0)).total, 1);
  assert.equal((await store.registeredUsers('', 0, 'linked')).total, 1);
  assert.equal((await store.registeredUsers('', 0, 'pending')).total, 104);
  await assert.rejects(store.replaceRoster([{ course: '2', id: 's2', name: 'New', groupName: 'ИС' }, { course: '2', id: 's2', name: 'Duplicate', groupName: 'ИС' }], 456));
  assert.equal((await store.directorySnapshot()).syncedAt, 123, 'failed refresh rolls back');
  assert.equal((await store.directoryForUser('u0')).name, 'Имя из админки');
  await store.replaceRoster([], 789);
  assert.equal(await store.directoryForUser('u0'), null);
  assert.equal(directoryStudent({ student_id: 's1', name: null }), null);
  await store.createAdminSession('adminhash', 'vaulthash', 100, 1);
  await store.reserveSyncTicket('first-ticket', 'adminhash', 1);
  await store.reserveSyncTicket('second-ticket', 'adminhash', 1);
  assert.equal(await store.consumeSyncTicket('first-ticket', 'wrong-owner', 2), null);
  const firstTicket = await store.consumeSyncTicket('first-ticket', 'adminhash', 2);
  const secondTicket = await store.consumeSyncTicket('second-ticket', 'adminhash', 2);
  assert.ok(Number(secondTicket.started_at) > Number(firstTicket.started_at), 'same-ms source reads have a strict durable order');
  assert.equal(await store.consumeSyncTicket('first-ticket', 'adminhash', 2), null, 'ticket is single use');
  assert.equal((await store.adminSession('adminhash', 99)).vault_hash, 'vaulthash');
  assert.equal(await store.adminSession('adminhash', 100), null);
  await store.deleteAdminSession('adminhash'); assert.equal(await store.adminSession('adminhash', 1), null);
  await store.replaceRoster([{ course: '2', id: 'delete-link', name: 'Студент', groupName: 'ИС' }], 1000);
  await store.linkStudent('u1', '2', 'delete-link', '2026-10-27');
  assert.equal(await store.deleteRegisteredUser('u1', 'wrong-name'), false);
  assert.equal(await store.deleteRegisteredUser('u1', 'name1'), true);
  assert.equal(await store.sessionUser('hash1', 1), null);
  assert.equal(await store.linkStudent('u2', '2', 'delete-link', '2026-10-27'), true, 'account delete cascades link in both engines');
});
test('roster validation rejects malformed dates and duplicate identities', () => {
  const config = { courses: Object.fromEntries(['1','2','3'].map(c => [c, { groupName: '', students: [] }])) };
  config.courses[2].students = [{ id: 'a', name: 'Имя', from: '2026-02-31' }];
  assert.throws(() => validateRoster(config));
  config.courses[2].students = [{ id: 'a', name: 'Имя' }, { id: 'a', name: 'Имя' }];
  assert.throws(() => validateRoster(config));
});
