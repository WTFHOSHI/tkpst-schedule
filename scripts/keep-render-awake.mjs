import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const accountManifest = 'https://tkpst-schedule.onrender.com/manifest.webmanifest';
const localTime = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Asia/Yekaterinburg', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
});

export function shouldWarm(date = new Date()) {
  const parts = Object.fromEntries(localTime.formatToParts(date).map(({ type, value }) => [type, value]));
  const hour = Number(parts.hour);
  const minute = Number(parts.minute);
  // Start shortly before 07:00 so a sleeping service is ready at 07:00.
  return (hour === 6 && minute >= 50) || (hour >= 7 && hour < 23);
}

export async function warmAccount({ now = new Date(), fetcher = globalThis.fetch } = {}) {
  if (!shouldWarm(now)) return 'Outside 07:00–23:00 Tyumen window; skipped.';
  const response = await fetcher(accountManifest, {
    method: 'HEAD', redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(120_000),
  });
  if (response.status !== 200 || !response.headers.get('content-type')?.startsWith('application/manifest+json')) {
    throw new Error(`Account service did not return its manifest (HTTP ${response.status}).`);
  }
  return 'Account service is responding.';
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  warmAccount().then(message => console.log(message)).catch(error => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
