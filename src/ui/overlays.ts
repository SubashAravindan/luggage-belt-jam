/**
 * Overlays — win / fail panels with Restart + Next buttons.
 * Objects are built once and reused; buttons are >=44px tap targets.
 */
import { Container, Graphics, Rectangle, Text } from 'pixi.js';
import { GAME_HEIGHT, GAME_WIDTH, PASTEL } from '../app/config.ts';
import type { SuitcaseColor } from '../game/types.ts';

const CARD_W = 560;
const CARD_H = 440;
const BTN_W = 240;
const BTN_H = 84;

class Button extends Container {
  private readonly bg: Graphics;
  private readonly caption: Text;
  private cb: (() => void) | null = null;

  constructor() {
    super();
    this.bg = new Graphics();
    this.caption = new Text({
      text: '',
      style: { fill: 0xffffff, fontSize: 26, fontWeight: '700', fontFamily: 'system-ui, sans-serif' },
    });
    this.caption.anchor.set(0.5, 0.5);
    this.addChild(this.bg, this.caption);
    this.eventMode = 'static';
    this.cursor = 'pointer';
    this.hitArea = new Rectangle(-BTN_W / 2, -BTN_H / 2, BTN_W, BTN_H);
    this.on('pointertap', () => {
      this.cb?.();
    });
  }

  setup(text: string, color: number, cb: () => void): void {
    this.caption.text = text;
    this.cb = cb;
    const g = this.bg;
    g.clear();
    g.roundRect(-BTN_W / 2, -BTN_H / 2, BTN_W, BTN_H, 18);
    g.fill({ color });
  }
}

export class Overlays extends Container {
  private readonly dim: Graphics;
  private readonly card: Graphics;
  private readonly title: Text;
  private readonly subtitle: Text;
  private readonly primary: Button;
  private readonly secondary: Button;

  constructor() {
    super();
    this.dim = new Graphics();
    this.card = new Graphics();
    this.title = new Text({
      text: '',
      style: {
        fill: PASTEL.ink,
        fontSize: 44,
        fontWeight: '800',
        fontFamily: 'system-ui, sans-serif',
      },
    });
    this.title.anchor.set(0.5, 0.5);
    this.subtitle = new Text({
      text: '',
      style: {
        fill: PASTEL.muted,
        fontSize: 23,
        fontFamily: 'system-ui, sans-serif',
        align: 'center',
        wordWrap: true,
        wordWrapWidth: CARD_W - 80,
      },
    });
    this.subtitle.anchor.set(0.5, 0.5);
    this.primary = new Button();
    this.secondary = new Button();
    this.addChild(this.dim, this.card, this.title, this.subtitle, this.primary, this.secondary);
    this.visible = false;
  }

  /** Show the win panel (stars vs par: 3/2/1). */
  showWin(
    delivered: number,
    total: number,
    hasNext: boolean,
    onRestart: () => void,
    onNext: () => void,
    stars = 3,
    moves = 0,
    par = 0,
  ): void {
    const earned = Math.max(0, Math.min(3, Math.round(stars)));
    let subtitle = `Delivered ${delivered}/${total} bags!`;
    subtitle += `\n${'★'.repeat(earned)}${'☆'.repeat(3 - earned)}`;
    if (par > 0) subtitle += ` · ${moves} moves (par ${par})`;
    this.layout(
      '🎉 LEVEL CLEAR!',
      subtitle,
      hasNext ? 'NEXT ➜' : 'PLAY AGAIN ↺',
      0x22c55e,
      onNext,
      'RESTART',
      0x64748b,
      onRestart,
    );
  }

  /** Show the fail (jam) panel — names front + parked colors, offers recovery. */
  showFail(frontNeeds: SuitcaseColor[], parked: SuitcaseColor[], onRestart: () => void): void {
    const uniq = (arr: SuitcaseColor[]): string => [...new Set(arr)].join(' + ') || '—';
    const frontList = uniq(frontNeeds);
    const parkedList = uniq(parked);
    const suggest = parked[0] ?? frontNeeds[0] ?? 'red';
    const reason =
      `Stuck! Front needs ${frontList} — parked ${parkedList}.\n` +
      `Try clearing ${suggest} first.`;
    this.layout(
      '🧳 BELT JAMMED!',
      reason,
      'TRY AGAIN ↺',
      0xef4444,
      onRestart,
      '',
      0x64748b,
      onRestart,
    );
  }

  /** Legacy string-reason entry (unused by Board — kept for harness compat). */
  showFailReason(reason: string, onRestart: () => void): void {
    this.layout(
      '🧳 BELT JAMMED!',
      reason,
      'TRY AGAIN ↺',
      0xef4444,
      onRestart,
      '',
      0x64748b,
      onRestart,
    );
  }

  /** Hide overlay. */
  hide(): void {
    this.visible = false;
  }

  private layout(
    title: string,
    subtitle: string,
    primaryText: string,
    primaryColor: number,
    primaryCb: () => void,
    secondaryText: string,
    secondaryColor: number,
    secondaryCb: () => void,
  ): void {
    const cx = Math.round(GAME_WIDTH / 2);
    const cy = Math.round(GAME_HEIGHT / 2);

    this.dim.clear();
    this.dim.rect(0, 0, GAME_WIDTH, GAME_HEIGHT);
    this.dim.fill({ color: 0x0f172a, alpha: 0.55 });

    const card = this.card;
    card.clear();
    card.roundRect(cx - CARD_W / 2, cy - CARD_H / 2, CARD_W, CARD_H, 28);
    card.fill({ color: PASTEL.card });
    card.roundRect(cx - CARD_W / 2, cy - CARD_H / 2, CARD_W, CARD_H, 28);
    card.stroke({ color: PASTEL.bandEdge, width: 3 });

    this.title.text = title;
    this.title.position.set(cx, cy - 130);
    this.subtitle.text = subtitle;
    this.subtitle.position.set(cx, cy - 50);

    this.primary.setup(primaryText, primaryColor, primaryCb);
    this.primary.position.set(cx, cy + 70);

    if (secondaryText.length > 0) {
      this.secondary.visible = true;
      this.secondary.setup(secondaryText, secondaryColor, secondaryCb);
      this.secondary.position.set(cx, cy + 165);
    } else {
      this.secondary.visible = false;
    }
    this.visible = true;
  }
}
