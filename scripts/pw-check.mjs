import { chromium } from 'playwright';

const shots = 'C:/Users/psuba/AppData/Local/Temp/opencode/lbj';
const { mkdirSync } = await import('fs');
mkdirSync(shots, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 480, height: 900 } });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(String(e)));

await page.goto('http://localhost:4173/', { waitUntil: 'networkidle' });
await page.waitForTimeout(2500);
await page.screenshot({ path: `${shots}/00-boot.png` });

// canvas geometry -> game coords (720x1280 FIT)
const rect = await page.evaluate(() => {
  const c = document.querySelector('canvas');
  if (!c) return null;
  const r = c.getBoundingClientRect();
  return { x: r.x, y: r.y, w: r.width, h: r.height };
});
console.log('canvas rect', JSON.stringify(rect));
if (!rect) { console.log('NO CANVAS'); await browser.close(); process.exit(1); }

const toCss = (gx, gy) => ({ x: rect.x + (gx / 720) * rect.w, y: rect.y + (gy / 1280) * rect.h });

// yard cart 0 at game (96, 804)
const c0 = toCss(96, 804);
console.log('click cart0 at', JSON.stringify(c0));
await page.mouse.click(c0.x, c0.y);

// capture motion frames
for (const [i, t] of [50, 150, 300, 500, 800, 1200].entries()) {
  await page.waitForTimeout(i === 0 ? 50 : t - [50, 150, 300, 500, 800][i - 1] || 100);
  await page.screenshot({ path: `${shots}/0${i + 1}-t${t}.png` });
}
console.log('errors:', JSON.stringify(errors.slice(0, 5)));
await browser.close();
console.log('done', shots);
