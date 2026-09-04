/**
 * Belt — visual conveyor at the top showing the next N suitcases
 * in queue order. v9: zero tags inside/below the strip. Single header line
 * ABOVE the strip (left name, right remaining / WAITING), gold down-triangle
 * pointer above the front bag, tight white highlight rect (gold reserved for
 * tap-me), chevrons shift red when starved. Tapping happens on carts, never
 * on the belt. Luggage sprites are pooled; shifts animate via fx group.
 */
import { Container, Graphics, Text } from 'pixi.js';
import { Easing, Tween } from '@tweenjs/tween.js';
import { BELT, PASTEL, SUITCASE_COLORS, SUITCASE_EMOJI } from '../app/config.ts';
import type { SuitcaseColor } from './types.ts';
import { Luggage } from './luggage.ts';
import { Pool } from '../core/pool.ts';
import { fxGroup } from './effects.ts';

export interface BeltOptions {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  visible?: number;
  slotW?: number;
  gap?: number;
  /** Header name drawn ABOVE the strip (e.g. "✈ DEPARTURES"). Empty = default. */
  label?: string;
}

interface BeltLayout {
  x: number;
  y: number;
  width: number;
  height: number;
  visible: number;
  slotW: number;
  gap: number;
}

const AMBER = 0xf59e0b;

export class Belt extends Container {
  private readonly layout: BeltLayout;
  private readonly bg: Graphics;
  private readonly rails: Graphics;
  private readonly chevrons: Graphics;
  private readonly highlight: Graphics;
  private readonly pointer: Graphics;
  private readonly headerLeft: Text;
  private readonly headerRight: Text;
  private readonly beltName: string;
  private waiting = false;
  private remaining = 0;
  /** Per-color tallies for the header counts (rebuilt in sync, event-driven). */
  private readonly tally = new Map<SuitcaseColor, number>();
  private readonly tallyOrder: readonly SuitcaseColor[] = SUITCASE_COLORS;
  private readonly pool: Pool<Luggage>;
  private readonly row: Luggage[] = [];
  /** Tracked shift tweens (slide + fade) so rapid loads can't pile up. */
  private readonly slideTweens = new Map<Luggage, Tween>();
  private readonly alphaTweens = new Map<Luggage, Tween>();
  /** Chevron scroll offset (px). Advanced in update(), no redraw per frame. */
  private scrollX = 0;
  private chevronStep = 100;

  constructor(opts: BeltOptions = {}) {
    super();
    this.layout = {
      x: opts.x ?? BELT.x,
      y: opts.y ?? BELT.y,
      width: opts.width ?? BELT.width,
      height: opts.height ?? BELT.height,
      visible: opts.visible ?? BELT.visible,
      slotW: opts.slotW ?? BELT.slotW,
      gap: opts.gap ?? BELT.gap,
    };
    this.beltName = opts.label && opts.label.length > 0 ? opts.label : '✈ DEPARTURES';
    this.bg = new Graphics();
    this.rails = new Graphics();
    this.chevrons = new Graphics();
    this.highlight = new Graphics();
    this.pointer = new Graphics();
    // Single header line INSIDE the strip top: left name, right remaining.
    this.headerLeft = new Text({
      text: this.beltName,
      style: {
        fill: 0xf1f5f9,
        fontSize: 16,
        fontWeight: '800',
        fontFamily: 'system-ui, sans-serif',
      },
    });
    this.headerLeft.anchor.set(0, 0.5);
    this.headerRight = new Text({
      text: '',
      style: {
        fill: 0xf1f5f9,
        fontSize: 16,
        fontWeight: '800',
        fontFamily: 'system-ui, sans-serif',
      },
    });
    this.headerRight.anchor.set(1, 0.5);
    this.pool = new Pool<Luggage>(
      () => new Luggage(),
      (item) => item.reset(),
      this.layout.visible + 2,
    );
    this.addChild(this.bg, this.rails, this.chevrons, this.highlight, this.pointer, this.headerLeft, this.headerRight);
    this.redraw();
  }

  /** Show/hide the starved state (Board drives from loadsSinceServed). */
  setWaiting(on: boolean): void {
    this.waiting = on;
    // Chevrons shift red when waiting (no text) — tint only, no redraw.
    this.chevrons.tint = on ? 0xef4444 : 0xffffff;
    this.refreshHeader();
  }

  /** Current waiting state (for tests). */
  isWaiting(): boolean {
    return this.waiting;
  }

  /** Slot center for row index i (0 = front, left). */
  private slotPos(i: number): { x: number; y: number } {
    const L = this.layout;
    const pitch = L.slotW + L.gap;
    const total = L.visible * L.slotW + (L.visible - 1) * L.gap;
    const x0 = L.x + (L.width - total) / 2 + L.slotW / 2;
    return { x: x0 + i * pitch, y: L.y + L.height / 2 + 6 };
  }

  /** Draw static belt once (or on layout change). No allocations per frame. */
  redraw(): void {
    const { x, y, width, height } = this.layout;

    this.bg.clear();
    this.bg.roundRect(x, y, width, height, 28);
    this.bg.fill({ color: PASTEL.track });
    this.bg.roundRect(x + 12, y + 12, width - 24, height - 24, 20);
    this.bg.fill({ color: PASTEL.trackInner });

    this.rails.clear();
    this.rails.roundRect(x, y - 16, width, 12, 6);
    this.rails.roundRect(x, y + height + 4, width, 12, 6);
    this.rails.fill({ color: PASTEL.rail });

    this.chevrons.clear();
    const n = 6;
    const step = width / n;
    this.chevronStep = step;
    for (let i = 0; i < n; i++) {
      const cx = x + 30 + i * step;
      const cy = y + height / 2 + 6;
      this.chevrons.moveTo(cx, cy - 24);
      this.chevrons.lineTo(cx + 24, cy);
      this.chevrons.lineTo(cx, cy + 24);
      this.chevrons.lineTo(cx, cy);
      this.chevrons.closePath();
    }
    this.chevrons.fill({ color: 0xffffff, alpha: 0.08 });
    this.chevrons.tint = this.waiting ? 0xef4444 : 0xffffff;

    // Header line INSIDE the strip top (nothing above/below it): left name,
    // right per-color counts. Light text — the strip is dark navy. Bag tops
    // start ~31px below strip top, so 16px text at y+16 always clears them.
    this.headerLeft.position.set(x + 16, y + 16);
    this.headerRight.position.set(x + width - 16, y + 16);
    this.refreshHeader();
  }

  /** Right header: per-color remaining (light), or amber "WAITING" when starved.
   *  Single source for remaining counts — HUD pills were removed (v9 cleanup)
   *  because they collided with the belt labels. */
  private refreshHeader(): void {
    if (this.waiting && this.remaining > 0) {
      this.headerRight.text = 'WAITING';
      this.headerRight.style.fill = AMBER;
    } else {
      const parts: string[] = [];
      for (const c of this.tallyOrder) {
        const n = this.tally.get(c) ?? 0;
        if (n > 0) parts.push(`${SUITCASE_EMOJI[c]}${n}`);
      }
      this.headerRight.text = parts.join(' ');
      this.headerRight.style.fill = 0xf1f5f9;
    }
  }

  /**
   * Constant-velocity ticker — offset only, no Graphics rebuild per frame.
   * Never pauses on load; zero per-frame alloc. Bags spaced 70-90px
   * (slotW + gap = 88px pitch).
   */
  update(dtMs: number): void {
    const dt = Math.min(Math.max(dtMs, 0), 100);
    this.scrollX += (dt / 1000) * 60;
    if (this.scrollX >= this.chevronStep) this.scrollX -= this.chevronStep;
    this.chevrons.position.x = -this.scrollX;
  }

  /** Sync visible row to the queue (first N). Animated shifts, no per-frame cost. */
  sync(queue: SuitcaseColor[], animate: boolean): void {
    this.remaining = queue.length;
    this.tally.clear();
    for (const c of queue) this.tally.set(c, (this.tally.get(c) ?? 0) + 1);
    this.refreshHeader();
    const want = queue.slice(0, this.layout.visible);
    // Release extras from the back.
    while (this.row.length > want.length) {
      const item = this.row.pop();
      if (item) {
        this.stopSlideFor(item);
        this.removeChild(item);
        this.pool.release(item);
      }
    }
    // Ensure rows + re-skin in order.
    for (let i = 0; i < want.length; i++) {
      const color = want[i] ?? 'red';
      let item = this.row[i];
      if (!item) {
        const fresh = this.pool.obtain();
        fresh.setColor(color);
        const p = this.slotPos(i);
        // Spawn off-screen-right (one pitch over), fade/slide in — no pop-in.
        fresh.position.set(p.x + 90, p.y);
        fresh.alpha = 0;
        this.addChild(fresh);
        // Keep highlight + pointer + headers on top of bags.
        this.addChild(this.highlight, this.pointer, this.headerLeft, this.headerRight);
        this.row[i] = fresh;
        item = fresh;
      } else {
        item.setColor(color);
      }
      const p = this.slotPos(i);
      if (animate) {
        // Slide forward to close the gap (no jump): single slow position
        // tween per bag, 600ms Cubic-Out. Tracked so rapid loads stop the
        // prev tween instead of piling up concurrent tweens on one sprite.
        this.stopSlideFor(item);
        const target = item;
        const slide = new Tween(target.position, fxGroup)
          .to({ x: p.x, y: p.y }, 600)
          .easing(Easing.Cubic.Out)
          .onComplete(() => {
            this.slideTweens.delete(target);
          })
          .start();
        this.slideTweens.set(target, slide);
        if (target.alpha < 1) {
          const fade = new Tween(target, fxGroup)
            .to({ alpha: 1 }, 450)
            .onComplete(() => {
              this.alphaTweens.delete(target);
            })
            .start();
          this.alphaTweens.set(target, fade);
        }
      } else {
        this.stopSlideFor(item);
        item.position.set(p.x, p.y);
        item.alpha = 1;
      }
      item.scale.set(i === 0 ? 1.15 : 1);
    }
    this.drawHighlight();
  }

  /**
   * Remove the front bag for the fly-to-cart animation and re-sync the rest.
   * The caller owns the returned bag and must release it via releaseBag().
   */
  takeFront(remaining: SuitcaseColor[]): Luggage | null {
    const front = this.row.shift() ?? null;
    if (front) {
      this.stopSlideFor(front);
      this.removeChild(front);
    }
    this.sync(remaining, true);
    return front;
  }

  /** Return a flown bag to the pool. */
  releaseBag(bag: Luggage): void {
    this.stopSlideFor(bag);
    this.pool.release(bag);
  }

  /** Stop tracked shift tweens for one bag (re-sync, take, release). */
  private stopSlideFor(bag: Luggage): void {
    const slide = this.slideTweens.get(bag);
    if (slide) {
      slide.stop();
      this.slideTweens.delete(bag);
    }
    const fade = this.alphaTweens.get(bag);
    if (fade) {
      fade.stop();
      this.alphaTweens.delete(bag);
    }
  }

  /** Stop all belt shift tweens (called from Board settle/load). */
  killSlides(): void {
    for (const [, tween] of this.slideTweens) tween.stop();
    this.slideTweens.clear();
    for (const [, tween] of this.alphaTweens) tween.stop();
    this.alphaTweens.clear();
  }

  private drawHighlight(): void {
    const g = this.highlight;
    g.clear();
    const ptr = this.pointer;
    ptr.clear();
    if (this.row.length === 0) return;
    const p = this.slotPos(0);
    // Tight highlight rect (88x68, 3px WHITE stroke — gold reserved for tap-me).
    g.roundRect(p.x - 44, p.y - 34, 88, 68, 14);
    g.stroke({ color: 0xffffff, width: 3 });
    // Small gold down-triangle pointer above the front bag.
    const fx = p.x;
    const baseY = this.layout.y - 10;
    ptr.moveTo(fx - 9, baseY - 8);
    ptr.lineTo(fx + 9, baseY - 8);
    ptr.lineTo(fx, baseY + 4);
    ptr.closePath();
    ptr.fill({ color: PASTEL.gold });
  }
}
