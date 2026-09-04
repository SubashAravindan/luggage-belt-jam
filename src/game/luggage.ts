/**
 * Luggage (suitcase) — pooled pastel suitcase with drawn vector identity.
 * v9: identity is ONE big centered white Graphics silhouette per color
 * (~36px: circle / triangle / square / 5-star). No emoji, no letters,
 * no corner glyphs. Re-skinned on pool obtain via setColor.
 */
import { Container, Graphics } from 'pixi.js';
import { SUITCASE_HEX, SUITCASE_STRIPES } from '../app/config.ts';
import type { SuitcaseColor } from './types.ts';

export const LUGGAGE_W = 88;
export const LUGGAGE_H = 64;

/** Bounding size of the centered identity silhouette on luggage. */
const IDENTITY_SIZE = 36;

export class Luggage extends Container {
  private readonly body: Graphics;
  private readonly identity: Graphics;
  private colorName: SuitcaseColor = 'red';

  constructor() {
    super();
    this.eventMode = 'none';
    this.body = new Graphics();
    this.identity = new Graphics();
    this.identity.position.set(0, 1);
    this.addChild(this.body, this.identity);
    this.setColor('red');
  }

  /** Re-skin without reallocating. Called on pool obtain. */
  setColor(color: SuitcaseColor): void {
    this.colorName = color;
    const hex = SUITCASE_HEX[color];
    const w = LUGGAGE_W;
    const h = LUGGAGE_H;
    const g = this.body;
    g.clear();
    // Case.
    g.roundRect(-w / 2, -h / 2, w, h, 14);
    g.fill({ color: hex });
    // Lid edge.
    g.roundRect(-w / 2, -h / 2, w, h, 14);
    g.stroke({ color: 0xffffff, width: 3, alpha: 0.65 });
    // Handle.
    g.roundRect(-16, -h / 2 - 10, 32, 12, 5);
    g.stroke({ color: 0x334155, width: 5 });
    // Strap.
    g.rect(-w / 2, -8, w, 16);
    g.fill({ color: 0x000000, alpha: 0.22 });
    // Colorblind stripes: 1-4 white bars bottom-left (tactile cue).
    const stripes = SUITCASE_STRIPES[color];
    for (let i = 0; i < stripes; i++) {
      g.rect(-w / 2 + 8 + i * 10, h / 2 - 14, 6, 10);
    }
    g.fill({ color: 0xffffff, alpha: 0.85 });
    // Wheels.
    g.roundRect(-34, h / 2 - 4, 14, 10, 3);
    g.roundRect(20, h / 2 - 4, 14, 10, 3);
    g.fill({ color: 0x1e293b });
    this.drawIdentity(color);
  }

  /**
   * ONE big centered white silhouette (~36px, body center), filled white
   * on the color. Grayscale-safe via geometry.
   */
  private drawIdentity(color: SuitcaseColor): void {
    const g = this.identity;
    g.clear();
    const R = IDENTITY_SIZE / 2;
    switch (color) {
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
    g.fill({ color: 0xffffff });
  }

  /** Current color. */
  get color(): SuitcaseColor {
    return this.colorName;
  }

  /** Reset for pooling — detach so the pool can re-parent. */
  reset(): void {
    this.removeFromParent();
    this.position.set(0, 0);
    this.rotation = 0;
    this.scale.set(1);
    this.alpha = 1;
    this.visible = true;
  }
}
