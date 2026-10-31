// Check public release identity without account data or credentials.
import { assertRelease } from './release-check.mjs';
const [base, expected, build] = process.argv.slice(2);
if (!/^https:\/\//.test(base || '') || !/^[a-f0-9]{40}$/.test(expected || '') || !/^[0-9]{1,10}$/.test(build || '')) throw new Error('Expected HTTPS origin and full commit SHA');
let last;
for (let attempt = 0; attempt < 8; attempt++) {
  try {
    const response = await fetch(new URL('/version.json', base), { cache: 'no-store', signal: AbortSignal.timeout(10000) });
    if (!response.ok) throw new Error('Release metadata unavailable: ' + response.status);
    const version = await response.json();
    assertRelease(version, expected, build);
    const session = await fetch(new URL('/api/auth/session', base), {
      method: 'POST', headers: { Origin: new URL(base).origin, 'Content-Type': 'application/json' },
      body: '{}', cache: 'no-store', signal: AbortSignal.timeout(15000),
    });
    if (!session.ok || (await session.json()).user !== null) throw new Error('Anonymous session API check failed');
    console.log('Verified release ' + version.version + ' at ' + new URL(base).origin);
    process.exit(0);
  } catch (error) { last = error; }
  await new Promise(resolve => setTimeout(resolve, 3000));
}
throw last;
