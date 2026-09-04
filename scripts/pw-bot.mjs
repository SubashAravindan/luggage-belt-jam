// Bot verification: greedy policies play levels headlessly (reduced-motion
// snaps tweens; LOAD_MS cadence still real-time). DUAL BELTS: two fronts
// (Departures A + Arrivals B) feed the shared bays. SPATIAL YARD (2 rows x
// 4 cols, exit left/right): reachable = path-clear via Board.isBlocked —
// front row needs same-row cells exit-ward empty of undispatched unremoved
// carts; back row needs its column front cell + front-row exit-ward empty
// (dispatched/departed cells stay empty, fixed cells, no compacting).
// Usage:
//   node scripts/pw-bot.mjs <dumb|colormatch> <fromIdx> <toIdx>
// Policies: dumb = first REACHABLE in yard order; colormatch = reachable
// either-front match (needier belt first, tie -> A) else first reachable.
import { chromium } from 'playwright';

const [policy, fromS, toS] = process.argv.slice(2);
const from = Number(fromS ?? 0);
const to = Number(toS ?? 9);

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 400, height: 800 }, reducedMotion: 'reduce' });
const page = await ctx.newPage();
const errs = [];
page.on('pageerror', (e) => errs.push(String(e)));
await page.goto('http://localhost:4173/', { waitUntil: 'networkidle' });
await page.waitForFunction(() => window.__lbj?.board, null, { timeout: 15000 });

for (let lvl = from; lvl <= to; lvl++) {
  await page.evaluate((i) => window.__lbj.game.loadLevel(i), lvl);
  await page.waitForTimeout(400);
  const result = await page.evaluate(async (pol) => {
    const b = window.__lbj.board;
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    let steps = 0;
    const t0 = performance.now();
    while (b.phase === 'playing' && steps < 80 && performance.now() - t0 < 120000) {
      const qa = b.queueA ?? b.queue ?? [];
      const qb = b.queueB ?? [];
      const frontA = qa[0];
      const frontB = qb[0];
      const matches = (color) => color !== undefined;
      const hasLoader = b.slots.some((s) => s.cart && (s.cart.state === 'bay' || s.cart.state === 'toBay') && ((matches(frontA) && s.cart.color === frontA) || (matches(frontB) && s.cart.color === frontB)));
      const freeBay = b.slots.some((s) => s.cart === null);
      const cands = b.yard.filter((e) => !e.dispatched && e.cart.state === 'yard' && !b.isBlocked(e));
      if (!hasLoader && freeBay && cands.length > 0 && (frontA !== undefined || frontB !== undefined)) {
        let pick = cands[0];
        if (pol === 'colormatch') {
          // Either-front match, preferring the needier belt (higher
          // loadsSinceServed, tie → A) — mirrors Board.suggestMove.
          const la = b.loadsSinceServedA ?? 0;
          const lb = b.loadsSinceServedB ?? 0;
          let needier;
          let other;
          if (frontA !== undefined && frontB !== undefined) {
            if (la >= lb) { needier = frontA; other = frontB; }
            else { needier = frontB; other = frontA; }
          } else {
            needier = frontA ?? frontB;
            other = undefined;
          }
          pick = cands.find((e) => e.cart.color === needier)
            ?? (other !== undefined ? cands.find((e) => e.cart.color === other) : undefined)
            ?? cands[0];
        }
        try { b.tryDispatch(pick); } catch {}
        steps++;
      }
      await sleep(200);
    }
    return { phase: b.phase, delivered: b.delivered, total: b.total, moves: b.moves ?? steps };
  }, policy);
  console.log(`L${lvl + 1} [${policy}]: ${result.phase} delivered=${result.delivered}/${result.total} dispatches=${result.moves}`);
}
console.log('pageerrors:', JSON.stringify(errs.slice(0, 3)));
await browser.close();
