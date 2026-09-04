/**
 * Cart (trolley) — rounded pastel container with color stripe, drawn vector
 * identity silhouette, capacity pips, blocked outline, and tap input.
 * v9: identity is ONE big centered Graphics silhouette per color (no letters,
 * no emoji, no corner glyphs). Blocked = dashed gray outline, full color.
 */
import { Container, Graphics, Rectangle } from 'pixi.js';
import { PASTEL, SUITCASE_HEX } from '../app/config.ts';
import type { CartDef, CartRuntime, SuitcaseColor } from './types.ts';

export const CART_W = 112;
export const CART_H = 118;

/** Visible nose direction — points along the cart's exit path (readability only). */
export type CartFacing = 'left' | 'right' | 'up';

/** Bounding size of the centered identity silhouette on carts. */
const IDENTITY_SIZE = 40;

export class Cart extends Container {
  private readonly frame: Graphics;
  private readonly facingGfx: Graphics;
  private readonly pips: Graphics;
  private readonly identity: Graphics;
  private readonly blockedOutline: Graphics;
  private readonly def: CartDef;
  private facing: CartFacing = 'right';
  private loadedCount = 0;
  private runtime: CartRuntime = 'yard';
  private tapHandler: (() => void) | null = null;
  private readonly onTapInternal: () => void;

  constructor(def: CartDef) {
    super();
    this.def = def;
    this.frame = new Graphics();
    this.facingGfx = new Graphics();
    this.pips = new Graphics();
    this.identity = new Graphics();
    this.identity.position.set(0, 6);
    this.blockedOutline = new Graphics();
    this.drawBlockedOutline();
    this.blockedOutline.visible = false;
    this.addChild(this.frame, this.facingGfx, this.identity, this.blockedOutline, this.pips);
    this.onTapInternal = () => {
      this.tapHandler?.();
    };
    this.draw();
  }

  /** Cart id. */
  get cartId(): string {
    return this.def.id;
  }

  /** Cart color. */
  get color(): SuitcaseColor {
    return this.def.color;
  }

  /** Cart capacity. */
  get capacity(): number {
    return this.def.capacity;
  }

  /** Bags loaded so far. */
  get loaded(): number {
    return this.loadedCount;
  }

  /** Runtime lifecycle state. */
  get state(): CartRuntime {
    return this.runtime;
  }

  set state(s: CartRuntime) {
    this.runtime = s;
  }

  /** Set loaded count and redraw pips (event-driven, no per-frame cost). */
  setLoaded(n: number): void {
    this.loadedCount = Math.max(0, Math.min(n, this.def.capacity));
    this.drawPips();
  }

  /** Show/hide the blocked dashed gray outline (no badge, full color). */
  setBlocked(blocked: boolean): void {
    this.blockedOutline.visible = blocked;
  }

  /** v9: carts always render full color (no dimming). Kept for call compat. */
  setDimmed(_dimmed: boolean): void {
    this.alpha = 1;
  }

  /** Attach (or detach with null) the tap callback. Input stays >=44px. */
  setOnTap(cb: (() => void) | null): void {
    if (cb === null) {
      this.tapHandler = null;
      this.off('pointertap', this.onTapInternal);
      this.eventMode = 'none';
      this.cursor = 'auto';
      return;
    }
    this.tapHandler = cb;
    this.off('pointertap', this.onTapInternal);
    this.on('pointertap', this.onTapInternal);
    this.eventMode = 'static';
    this.cursor = 'pointer';
    this.hitArea = new Rectangle(-CART_W / 2, -CART_H / 2, CART_W, CART_H);
  }

  /** Nose direction (readability only — never gates rules). Redraws facing. */
  setFacing(f: CartFacing): void {
    this.facing = f;
    this.draw();
  }

  /** Current nose direction. */
  getFacing(): CartFacing {
    return this.facing;
  }

  private draw(): void {
    const hex = SUITCASE_HEX[this.def.color];
    const g = this.frame;
    g.clear();
    // Card.
    g.roundRect(-CART_W / 2, -CART_H / 2, CART_W, CART_H, 16);
    g.fill({ color: PASTEL.card });
    g.roundRect(-CART_W / 2, -CART_H / 2, CART_W, CART_H, 16);
    g.stroke({ color: hex, width: 4 });
    // Color stripe on top (28px tall).
    g.roundRect(-CART_W / 2 + 6, -CART_H / 2 + 6, CART_W - 12, 28, 8);
    g.fill({ color: hex });
    this.drawFacing();
    this.drawIdentity();
    this.drawPips();
  }

  /**
   * Facing cues on the nose edge, UNDERNEATH identity (identity/pips/stripe
   * unchanged and still readable): dark windshield rounded rect + two 6px
   * warm-white headlights with a dark keyline. Graphics only, no assets.
   */
  private drawFacing(): void {
    const g = this.facingGfx;
    g.clear();
    const dark = PASTEL.ink;
    const lamp = 0xfff7cc;
    if (this.facing === 'right') {
      g.roundRect(CART_W / 2 - 20, -34, 12, 68, 6);
      g.fill({ color: dark, alpha: 0.85 });
      for (const y of [-22, 22]) {
        g.circle(CART_W / 2 - 8, y, 6);
        g.fill({ color: lamp });
        g.circle(CART_W / 2 - 8, y, 6);
        g.stroke({ color: dark, width: 2 });
      }
    } else if (this.facing === 'left') {
      g.roundRect(-CART_W / 2 + 8, -34, 12, 68, 6);
      g.fill({ color: dark, alpha: 0.85 });
      for (const y of [-22, 22]) {
        g.circle(-CART_W / 2 + 8, y, 6);
        g.fill({ color: lamp });
        g.circle(-CART_W / 2 + 8, y, 6);
        g.stroke({ color: dark, width: 2 });
      }
    } else {
      g.roundRect(-34, -CART_H / 2 + 38, 68, 12, 6);
      g.fill({ color: dark, alpha: 0.85 });
      for (const x of [-22, 22]) {
        g.circle(x, -CART_H / 2 + 38 + 6, 6);
        g.fill({ color: lamp });
        g.circle(x, -CART_H / 2 + 38 + 6, 6);
        g.stroke({ color: dark, width: 2 });
      }
    }
  }

  /**
   * ONE big centered vector silhouette per color (~40px, card body center):
   * circle / triangle / square / 5-star, hex fill + 3px white stroke.
   * Grayscale-safe via geometry (no letters, no emoji).
   */
  private drawIdentity(): void {
    const g = this.identity;
    g.clear();
    const hex = SUITCASE_HEX[this.def.color];
    const R = IDENTITY_SIZE / 2;
    switch (this.def.color) {
      case 'red': {
        g.circle(0, 0, R);
        break;
      }
      case 'blue': {
        g.moveTo(0, -R);
        g.lineTo(R * 0.95, R * 0.8);
        g.lineTo(-R * 0.95, R * 0.8);
        g.closePath();
        break;
      }
      case 'green': {
        const s = R * 1.8;
        g.rect(-s / 2, -s / 2, s, s);
        break;
      }
      case 'yellow': {
        for (let i = 0; i < 10; i++) {
          const r = i % 2 === 0 ? R : R * 0.45;
          const a = -Math.PI / 2 + (i * Math.PI) / 5;
          const x = Math.cos(a) * r;
          const y = Math.sin(a) * r;
          if (i === 0) g.moveTo(x, y);
          else g.lineTo(x, y);
        }
        g.closePath();
        break;
      }
    }
    g.fill({ color: hex });
    g.stroke({ color: 0xffffff, width: 3 });
  }

  /** 3px dashed gray outline around the card (static geometry, toggled). */
  private drawBlockedOutline(): void {
    const g = this.blockedOutline;
    g.clear();
    const w = CART_W + 10;
    const h = CART_H + 10;
    const x = -w / 2;
    const y = -h / 2;
    const dash = 10;
    const gap = 7;
    const segs: Array<[number, number, number, number]> = [
      [x, y, x + w, y],
      [x, y + h, x + w, y + h],
      [x, y, x, y + h],
      [x + w, y, x + w, y + h],
    ];
    for (const [x1, y1, x2, y2] of segs) {
      const len = Math.hypot(x2 - x1, y2 - y1);
      if (len < 1) continue;
      const dx = (x2 - x1) / len;
      const dy = (y2 - y1) / len;
      for (let d = 0; d < len; d += dash + gap) {
        const sx = x1 + dx * d;
        const sy = y1 + dy * d;
        const ex = x1 + dx * Math.min(d + dash, len);
        const ey = y1 + dy * Math.min(d + dash, len);
        g.moveTo(sx, sy);
        g.lineTo(ex, ey);
      }
    }
    g.stroke({ color: PASTEL.muted, width: 3, alpha: 0.95 });
  }

  private drawPips(): void {
    const hex = SUITCASE_HEX[this.def.color];
    const g = this.pips;
    g.clear();
    const n = this.def.capacity;
    const spacing = 26;
    const startX = -((n - 1) * spacing) / 2;
    for (let i = 0; i < n; i++) {
      const x = startX + i * spacing;
      const y = CART_H / 2 - 20;
      g.circle(x, y, 9);
      g.fill({ color: i < this.loadedCount ? hex : PASTEL.pipEmpty });
    }
  }
}
