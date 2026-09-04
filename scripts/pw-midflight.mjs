import { chromium } from 'playwright';

const shots = 'C:/Users/psuba/AppData/Local/Temp/opencode/lbj';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 480, height: 900 } });
await page.goto('http://localhost:4173/', { waitUntil: 'networkidle' });
await page.waitForFunction(() => window.__lbj?.board, null, { timeout: 15000 });
await page.waitForTimeout(1500);
const rect = await page.evaluate(() => {
  const r = document.querySelector('canvas').getBoundingClientRect();
  return { x: r.x, y: r.y, w: r.width, h: r.height };
});
const toCss = (gx, gy) => ({ x: rect.x + (gx / 720) * rect.w, y: rect.y + (gy / 1280) * rect.h });
const c0 = toCss(96, 804);
await page.mouse.click(c0.x, c0.y);
await page.waitForTimeout(1300);
await page.screenshot({ path: `${shots}/mid-drive.png` });
await page.waitForTimeout(2200);
await page.screenshot({ path: `${shots}/docked.png` });
await browser.close();
console.log('saved mid-drive + docked');
