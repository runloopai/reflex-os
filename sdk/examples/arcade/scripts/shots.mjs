/**
 * Screenshot the app's key screens into `shots/` for visual judging. Run a
 * dev stack first (`npm run dev`, or point ARCADE_WEB_ORIGIN elsewhere),
 * then READ the images — the point is to look at them after a visual
 * change, not to collect them.
 *
 *   ARCADE_WEB_ORIGIN=http://localhost:5674 npm run shots
 */
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const WEB = process.env.ARCADE_WEB_ORIGIN ?? 'http://localhost:5674';
const here = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.join(here, '../shots');
await mkdir(outDir, { recursive: true });

const browser = await chromium.launch();
const shot = (page, name) => page.screenshot({ path: path.join(outDir, `${name}.png`) });

// Join screen (logged out), with the cursor on the ASCII field.
const anon = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await anon.goto(WEB, { waitUntil: 'networkidle' });
await anon.waitForTimeout(1200);
await anon.mouse.move(420, 320);
await anon.waitForTimeout(300);
await shot(anon, 'join');
await anon.close();

// Logged-in pages.
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const join = await page.request.post(`${WEB}/api/join`, { data: { name: 'Shotbot' } });
if (!join.ok()) {
  console.error(`join failed (${join.status()}) — is the arcade server running behind ${WEB}?`);
  process.exit(1);
}
const { token } = await join.json();
await page.addInitScript((t) => localStorage.setItem('reflex-arcade:token', t), token);

await page.goto(WEB, { waitUntil: 'networkidle' });
await page.waitForTimeout(2200);
for (let i = 0; i < 10; i++) {
  await page.mouse.move(950 + i * 18, 250 + Math.sin(i) * 70);
  await page.waitForTimeout(60);
}
await shot(page, 'landing');
await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
await page.waitForTimeout(500);
await shot(page, 'landing-footer');

await page.goto(`${WEB}/about`, { waitUntil: 'networkidle' });
await page.waitForTimeout(800);
await shot(page, 'about');

await page.goto(`${WEB}/mine`, { waitUntil: 'networkidle' });
await page.waitForTimeout(800);
await shot(page, 'my-games');

// First public game's stream view, when there is one.
const games = await (
  await page.request.get(`${WEB}/api/games`, {
    headers: { authorization: `Bearer ${token}` },
  })
).json();
const live = games.games?.find((g) => g.isPublic);
if (live) {
  await page.goto(`${WEB}/g/${live.id}`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);
  await shot(page, 'game-view');
}

await browser.close();
console.log(`shots written to ${outDir} — now read them.`);
