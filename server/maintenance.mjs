import { createNeonDriver } from './neon.mjs';
try {
  const driver = createNeonDriver(process.env.DATABASE_URL);
  const now = Date.now();
  await driver.transaction([
    { text: 'DELETE FROM sessions WHERE expires_at <= $1', params: [now] },
    { text: 'DELETE FROM auth_rate_limits WHERE expires_at <= $1', params: [now] },
  ]);
  console.log('Expired sessions and rate buckets cleaned.');
} catch { console.error('Maintenance failed; credentials were not logged.'); process.exitCode = 1; }
