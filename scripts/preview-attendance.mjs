// Local-only browser QA with a disposable in-memory database and synthetic students.
import { createSQLiteStore } from '../server/sqlite-store.mjs';
import { createAccounts } from '../server/accounts.mjs';
import { createAdminService } from '../server/admin-service.mjs';
import { createAuthServer } from '../server/http.mjs';

const store = createSQLiteStore(':memory:');
const now = Date.parse('2026-10-27T10:00:00Z');
const accounts = await createAccounts({ store, now: () => now });
const student = await accounts.register({ username: 'qa_student', displayName: 'Тестовый студент', password: 'qa-student-only' });
await store.replaceRoster([{ course: '2', id: 'qa-1', name: 'Тестовый студент', groupName: 'ИС-25-3С' }], now);
await store.linkStudent(student.user.id, '2', 'qa-1', '2026-10-27');
const admin = createAdminService({ store, now: () => now });
const { ticket } = await admin.beginAttendance({ course: '2', monday: '2026-10-26' }, 'qa-writer');
await admin.syncAttendance({ course: '2', monday: '2026-10-26', ticket, week: {
  m: { 'qa-1': { '2026-10-26': { 1: 'P', 2: 'N', 3: 'B', 4: 'U', 5: 'R', 6: 'Z' }, '2026-10-27': { 1: 'P', 2: 'P' } } },
  pairs: {}, hide: {}, at: '2026-10-27T10:00:00Z',
} }, 'qa-writer');
const app = await createAuthServer({ store, now: () => now, publicOrigin: 'http://127.0.0.1:4193' });
app.server.listen(4193, '127.0.0.1', () => console.log('Synthetic attendance QA: http://127.0.0.1:4193/#/login (qa_student / qa-student-only)'));
