import { readFile } from 'node:fs/promises';

const expected = JSON.parse(await readFile(new URL('../web/overrides.json', import.meta.url), 'utf8'));
const base = 'https://wtfhoshi.github.io/tkpst-schedule/';
const url = base + 'overrides.json';
const expectedCommit = process.argv[2] === '--commit' ? process.argv[3] : null;
if (process.argv.length > 2 && !/^[a-f0-9]{40}$/.test(expectedCommit || '')) throw new Error('Expected --commit and a full SHA');
const attempts = expectedCommit ? 24 : 6;
let matched = false;
for (let attempt = 0; attempt < attempts; attempt++) {
  try {
    const response = await fetch(`${url}?t=${Date.now()}`, { cache: 'no-store', signal: AbortSignal.timeout(10000) });
    if (response.ok) {
      const actual = await response.json();
      // A newer publication is also acceptable if another admin saved meanwhile.
      if (JSON.stringify(actual) === JSON.stringify(expected) || Date.parse(actual.updatedAt) > Date.parse(expected.updatedAt)) {
        if (expectedCommit) {
          const metadata = await fetch(`${base}version.json?t=${Date.now()}`, { cache: 'no-store', signal: AbortSignal.timeout(10000) });
          if (!metadata.ok || (await metadata.json()).commit !== expectedCommit) throw new Error('Pages source commit does not match the tested app');
        }
        matched = true;
        break;
      }
    }
  } catch { /* Retry propagation or a temporary network error. */ }
  if (attempt < attempts - 1) await new Promise(resolve => setTimeout(resolve, 5000));
}
if (!matched) throw new Error('Pages still serves an older or different schedule.');
console.log('Published schedule matches the saved admin changes.');
