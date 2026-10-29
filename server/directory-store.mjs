export const directorySchema = [
  'CREATE TABLE IF NOT EXISTS student_roster (course TEXT NOT NULL, student_id TEXT NOT NULL, name TEXT NOT NULL, group_name TEXT NOT NULL, from_date TEXT, to_date TEXT, PRIMARY KEY(course, student_id))',
  'CREATE TABLE IF NOT EXISTS user_student_links (user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE, course TEXT NOT NULL, student_id TEXT NOT NULL, UNIQUE(course, student_id))',
  'CREATE TABLE IF NOT EXISTS roster_state (id INTEGER PRIMARY KEY CHECK (id = 1), synced_at BIGINT NOT NULL)',
  'CREATE TABLE IF NOT EXISTS admin_sessions (token_hash TEXT PRIMARY KEY, vault_hash TEXT NOT NULL, expires_at BIGINT NOT NULL)',
  'CREATE INDEX IF NOT EXISTS admin_sessions_expiry ON admin_sessions(expires_at)',
  'CREATE TABLE IF NOT EXISTS roster_sync_clock (id INTEGER PRIMARY KEY CHECK (id = 1), tick BIGINT NOT NULL)',
  'CREATE TABLE IF NOT EXISTS roster_sync_tickets (ticket_hash TEXT PRIMARY KEY, token_hash TEXT NOT NULL REFERENCES admin_sessions(token_hash) ON DELETE CASCADE, started_at BIGINT NOT NULL, expires_at BIGINT NOT NULL)',
];
const joins = 'LEFT JOIN user_student_links l ON l.user_id = users.id LEFT JOIN student_roster r ON r.course = l.course AND r.student_id = l.student_id';
const activeLink = "r.student_id IS NOT NULL AND (r.from_date IS NULL OR r.from_date <= $3) AND (r.to_date IS NULL OR r.to_date >= $3)";
const searchWhere = `WHERE (LOWER(users.username) LIKE $1 ESCAPE '!' OR LOWER(users.display_name) LIKE $1 ESCAPE '!' OR LOWER(COALESCE(r.name, '')) LIKE $1 ESCAPE '!') AND ($2 = 'all' OR ($2 = 'linked' AND (${activeLink})) OR ($2 = 'pending' AND NOT (${activeLink})))`;

export function createDirectoryStore(driver) {
  return {
    directoryForUser: async id => (await driver.query(`SELECT r.* FROM user_student_links l JOIN student_roster r ON r.course = l.course AND r.student_id = l.student_id WHERE l.user_id = $1`, [id]))[0] || null,
    async replaceRoster(students, now) {
      const results = await driver.transaction([
        // The singleton row serializes concurrent snapshots before any roster delete.
        // Requests fetched earlier cannot overwrite a more recent snapshot.
        { text: 'INSERT INTO roster_state (id, synced_at) VALUES (1,$1) ON CONFLICT(id) DO UPDATE SET synced_at = CASE WHEN roster_state.synced_at <= excluded.synced_at THEN excluded.synced_at ELSE roster_state.synced_at END RETURNING synced_at', params: [now] },
        { text: 'DELETE FROM student_roster WHERE EXISTS (SELECT 1 FROM roster_state WHERE id = 1 AND synced_at = $1)', params: [now] },
        ...students.map(s => ({ text: 'INSERT INTO student_roster (course, student_id, name, group_name, from_date, to_date) SELECT $1,$2,$3,$4,$5,$6 WHERE EXISTS (SELECT 1 FROM roster_state WHERE id = 1 AND synced_at = $7)', params: [s.course, s.id, s.name, s.groupName, s.from || null, s.to || null, now] })),
        { text: 'DELETE FROM user_student_links WHERE EXISTS (SELECT 1 FROM roster_state WHERE id = 1 AND synced_at = $1) AND NOT EXISTS (SELECT 1 FROM student_roster r WHERE r.course = user_student_links.course AND r.student_id = user_student_links.student_id)', params: [now] },
      ]);
      return Number(results[0][0].synced_at) === now;
    },
    reserveSyncTicket: (ticketHash, tokenHash, now) => driver.transaction([
      { text: 'INSERT INTO roster_sync_clock (id, tick) VALUES (1,$1) ON CONFLICT(id) DO UPDATE SET tick = CASE WHEN roster_sync_clock.tick >= excluded.tick THEN roster_sync_clock.tick + 1 ELSE excluded.tick END', params: [now] },
      { text: 'INSERT INTO roster_sync_tickets (ticket_hash, token_hash, started_at, expires_at) SELECT $1,$2,tick,$3 FROM roster_sync_clock WHERE id = 1', params: [ticketHash, tokenHash, now + 60000] },
    ]),
    consumeSyncTicket: async (ticketHash, tokenHash, now) => (await driver.query('DELETE FROM roster_sync_tickets WHERE ticket_hash = $1 AND token_hash = $2 AND expires_at > $3 RETURNING started_at', [ticketHash, tokenHash, now]))[0] || null,
    async registeredUsers(search, offset, status = 'all', today = new Date().toISOString().slice(0, 10)) {
      const term = '%' + search.toLowerCase().replace(/[!%_]/g, '!$&') + '%';
      const params = [term, status, today];
      const users = await driver.query(`SELECT users.id, users.username, users.display_name, users.created_at, l.course AS linked_course, l.student_id AS linked_student_id, r.name, r.group_name, r.from_date, r.to_date FROM users ${joins} ${searchWhere} ORDER BY users.created_at DESC, users.id DESC LIMIT 100 OFFSET $4`, [...params, offset]);
      const [count] = await driver.query(`SELECT COUNT(*) AS total FROM users ${joins} ${searchWhere}`, params);
      return { users, total: Number(count.total) };
    },
    async directorySnapshot() {
      const students = await driver.query('SELECT * FROM student_roster ORDER BY course, name, student_id', []);
      const [state] = await driver.query('SELECT synced_at FROM roster_state WHERE id = 1', []);
      return { students, syncedAt: state ? Number(state.synced_at) : null };
    },
    createAdminSession: (hash, vaultHash, expiresAt, now) => driver.transaction([
      { text: 'DELETE FROM admin_sessions WHERE expires_at > 0 AND expires_at <= $1', params: [now] },
      { text: 'INSERT INTO admin_sessions (token_hash, vault_hash, expires_at) VALUES ($1,$2,$3)', params: [hash, vaultHash, expiresAt] },
    ]),
    adminSession: async (hash, now) => (await driver.query('SELECT vault_hash FROM admin_sessions WHERE token_hash = $1 AND (expires_at = 0 OR expires_at > $2)', [hash, now]))[0] || null,
    deleteAdminSession: hash => driver.query('DELETE FROM admin_sessions WHERE token_hash = $1', [hash]),
    deleteRegisteredUser: async (id, username) => (await driver.query('DELETE FROM users WHERE id = $1 AND username = $2 RETURNING id', [id, username])).length === 1,
    async linkStudent(userId, course, studentId, today) {
      if (studentId === null) {
        await driver.query('DELETE FROM user_student_links WHERE user_id = $1', [userId]); return true;
      }
      const rows = await driver.query(`INSERT INTO user_student_links (user_id, course, student_id)
        SELECT users.id, r.course, r.student_id FROM users CROSS JOIN student_roster r
        WHERE users.id = $1 AND r.course = $2 AND r.student_id = $3 AND (r.from_date IS NULL OR r.from_date <= $4) AND (r.to_date IS NULL OR r.to_date >= $4)
        ON CONFLICT(user_id) DO UPDATE SET course = excluded.course, student_id = excluded.student_id RETURNING user_id`, [userId, course, studentId, today]);
      return rows.length === 1;
    },
  };
}

export function directoryStudent(row, now = Date.now()) {
  const today = new Date(now).toISOString().slice(0, 10);
  if (!row?.student_id || !row.name || row.from_date && row.from_date > today || row.to_date && row.to_date < today) return null;
  return { id: row.student_id, course: row.course, displayName: row.name, groupName: row.group_name };
}
