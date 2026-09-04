import { chromium } from 'playwright';

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 480, height: 900 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
await page.goto('http://localhost:4173/', { waitUntil: 'networkidle' });
await page.waitForFunction(() => window.__lbj?.board, null, { timeout: 15000 });
await page.waitForTimeout(1000);

// game coords of yard cart 0 -> css
const rect = await page.evaluate(() => {
  const r = document.querySelector('canvas').getBoundingClientRect();
  return { x: r.x, y: r.y, w: r.width, h: r.height };
});
const toCss = (gx, gy) => ({ x: rect.x + (gx / 720) * rect.w, y: rect.y + (gy / 1280) * rect.h });

// start polling positions in-page at ~every frame, then click mid-poll
await page.evaluate(() => {
  const b = window.__lbj.board;
  window.__trace = [];
  window.__tracing = true;
  const t0 = performance.now();
  const yard = () => b.yard.map((e) => ({ x: Math.round(e.cart.position.x), y: Math.round(e.cart.position.y), st: e.cart.state, d: e.dispatched ? 1 : 0 }));
  const tick = () => {
    if (!window.__tracing) return;
    window.__trace.push({ t: Math.round(performance.now() - t0), y: yard() });
    if (window.__trace.length < 140) requestAnimationFrame(tick);
    else window.__tracing = false;
  };
  requestAnimationFrame(tick);
  // click after ~200ms of baseline
  setTimeout(() => {
    window.__clickedAt = performance.now() - t0;
    b.tryDispatch?.(b.yard[0]);
    if (!b.tryDispatch) {
      // fallback: simulate tap handler directly
      const e = b.yard[0];
      e.cart.emit?.('pointertap');
    }
  }, 200);
});

// wait for trace to finish
await page.waitForFunction(() => window.__tracing === false, null, { timeout: 15000 });
const trace = await page.evaluate(() => ({ clickedAt: window.__clickedAt, trace: window.__trace }));
const { clickedAt } = trace;
// print cart0 trajectory relative to click
for (const s of trace.trace) {
  const rel = s.t - Math.round(clickedAt);
  if (rel < -50) continue;
  const c0 = s.y[0];
  console.log(`t=${rel}ms cart0=(${c0.x},${c0.y}) st=${c0.st} d=${c0.d}`);
}
console.log('pageerrors:', JSON.stringify(errors.slice(0, 3)));
await browser.close();
