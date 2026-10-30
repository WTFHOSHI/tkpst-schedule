import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { mkdir } from 'node:fs/promises';
import { join, extname, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = normalize(fileURLToPath(new URL('../web/', import.meta.url))).replace(/[\\/]$/, '');
const mime = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.svg': 'image/svg+xml' };
const server = createServer(async (req, res) => {
  const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  const path = normalize(join(root, pathname === '/' ? 'index.html' : pathname));
  if (!path.startsWith(root + sep) && path !== root) { res.writeHead(403).end(); return; }
  try {
    const body = await readFile(path);
    res.writeHead(200, { 'Content-Type': `${mime[extname(path)] || 'application/octet-stream'}; charset=utf-8` }).end(body);
  } catch { res.writeHead(404).end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch(process.env.PLAYWRIGHT_CHANNEL ? { channel: process.env.PLAYWRIGHT_CHANNEL } : {});
const lessons = [{ title: 'История', cabinet: '306', teacher: 'Ильина Т.В.', order: 3, startTime: '10:10:00', endTime: '11:40:00' }];
const month = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Yekaterinburg', year: 'numeric', month: '2-digit' }).format(new Date()).slice(0, 7);
const day = `${month}-15`;
const errors = [];
await mkdir('captures', { recursive: true });

try {
  for (const width of [320, 390, 430]) {
    const context = await browser.newContext({ viewport: { width, height: 844 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true, serviceWorkers: 'block' });
    await context.addInitScript(() => localStorage.setItem('group_id', '196'));
    await context.route('**/api/**', route => {
      const path = new URL(route.request().url()).pathname;
      const body = path.endsWith('/auth/session') ? { user: { id: 'qa', displayName: 'QA', student: { displayName: 'QA', groupName: 'ИС-25-3С' } } }
        : path.endsWith('/attendance') ? { linked: true, syncedAt: Date.now(), records: [{ date: day, pair: 2, status: 'N' }] }
          : {};
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
    });
    await context.route('https://api.thisishyum.ru/**', route => {
      const path = new URL(route.request().url()).pathname;
      const body = path.endsWith('/schedules/last') ? { date: day } : path.endsWith('/groups') ? [] : { lessons };
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
    });
    const page = await context.newPage();
    page.on('pageerror', error => errors.push(`${width}px: ${error.message}`));
    for (const [route, expected] of [['schedule', 'Расписание'], ['buses', 'Автобусы'], ['settings', 'Настройки'], ['login', 'Личный кабинет'], ['grades', 'Успеваемость']]) {
      await page.goto(`${base}/#/${route}`, { waitUntil: 'domcontentloaded' });
      await page.getByRole('heading', { name: expected, exact: true }).first().waitFor();
      if (route === 'grades') await page.getByText('История', { exact: true }).waitFor();
      await page.waitForTimeout(150);
      const bounds = await page.evaluate(() => ({ screen: innerWidth, document: document.documentElement.scrollWidth, nav: !!document.querySelector('#nav a') }));
      assert.ok(bounds.document <= bounds.screen + 1, `${width}px ${route}: horizontal overflow ${bounds.document}`);
      assert.ok(bounds.nav, `${width}px ${route}: navigation missing`);
      await page.screenshot({ path: `captures/${width}-${route}.png`, fullPage: true });
    }
    await page.goto(`${base}/#/grades`, { waitUntil: 'domcontentloaded' });
    await page.getByRole('tab', { name: 'Посещаемость' }).waitFor();
    await page.getByRole('tab', { name: 'Оценки' }).click();
    await page.getByText('Оценки не подключены').waitFor();
    await page.getByRole('tab', { name: 'Посещаемость' }).click();
    await page.getByRole('button', { name: 'Следующий месяц' }).click();
    assert.notEqual(await page.locator('[data-attendance-month]').inputValue(), month);
    await page.goto(`${base}/#/settings`, { waitUntil: 'domcontentloaded' });
    await page.getByText('Чёрно-белая').click();
    assert.equal(await page.locator('html').getAttribute('data-palette'), 'mono');
    await page.screenshot({ path: `captures/${width}-mono.png`, fullPage: true });
    console.log(`Mobile smoke passed at ${width}px`);
    await context.close();
  }
  assert.deepEqual(errors, []);
} finally {
  await browser.close();
  await new Promise(resolve => server.close(resolve));
}
