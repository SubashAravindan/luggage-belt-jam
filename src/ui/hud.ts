/**
 * HUD — level label, delivery progress bar, bays occupancy.
 * v9: level-hint line deleted (hint shows once as a board toast at level
 * start); combo line deleted (cart pop + sound carry it). Remaining lines
 * keep a 28px minimum line pitch.
 */
import { Container, Graphics, Rectangle, Text } from 'pixi.js';
import { GAME_WIDTH, PASTEL } from '../app/config.ts';
import type { SuitcaseColor } from '../game/types.ts';
import { isMuted, setMuted } from '../core/audio.ts';
import { load, save } from '../core/storage.ts';

const BAR_X = 140;
const BAR_Y = 104;
const BAR_W = GAME_WIDTH - BAR_X * 2;
const BAR_H = 18;

/** v9 vertical rhythm (28px minimum pitch): title 44 / level 78 / progress 138 / counts 168 / bays 196. */
const Y_PROGRESS = BAR_Y + BAR_H + 16;
const Y_COUNTS = 168;
const Y_BAYS = 196;

const MUTE_KEY = 'muted';

export class Hud extends Container {
  private readonly title: Text;
  private readonly level: Text;
  private readonly barBg: Graphics;
  private readonly barFill: Graphics;
  private readonly progressText: Text;
  private readonly remainingBg: Graphics;
  private readonly remainingBgB: Graphics;
  private readonly remainingText: Text;
  private readonly remainingTextB: Text;
  private readonly baysText: Text;
  private readonly muteBtn: Text;
  private combo = 0;

  constructor() {
    super();
    this.title = new Text({
      text: '✈ LUGGAGE BELT JAM',
      style: {
        fill: PASTEL.ink,
        fontSize: 32,
        fontWeight: '700',
        fontFamily: 'system-ui, sans-serif',
        letterSpacing: 2,
      },
    });
    this.title.anchor.set(0.5, 0.5);
    this.title.position.set(Math.round(GAME_WIDTH / 2), 44);

    this.level = new Text({
      text: 'LEVEL 1',
      style: {
        fill: PASTEL.muted,
        fontSize: 22,
        fontWeight: '700',
        fontFamily: 'system-ui, sans-serif',
      },
    });
    this.level.anchor.set(0.5, 0.5);
    this.level.position.set(Math.round(GAME_WIDTH / 2), 78);

    this.barBg = new Graphics();
    this.barFill = new Graphics();
    this.drawBarShell();

    this.progressText = new Text({
      text: '0 / 0 bags',
      style: { fill: PASTEL.ink, fontSize: 20, fontFamily: 'system-ui, sans-serif' },
    });
    this.progressText.anchor.set(0.5, 0.5);
    this.progressText.position.set(Math.round(GAME_WIDTH / 2), Y_PROGRESS);

    this.remainingBg = new Graphics();
    this.remainingBgB = new Graphics();
    this.remainingBgB.visible = false;
    this.remainingText = new Text({
      text: '',
      style: { fill: PASTEL.ink, fontSize: 20, fontWeight: '700', fontFamily: 'system-ui, sans-serif' },
    });
    this.remainingText.anchor.set(0.5, 0.5);
    this.remainingText.position.set(Math.round(GAME_WIDTH / 2), Y_COUNTS);

    this.remainingTextB = new Text({
      text: '',
      style: { fill: PASTEL.ink, fontSize: 20, fontWeight: '700', fontFamily: 'system-ui, sans-serif' },
    });
    this.remainingTextB.anchor.set(0.5, 0.5);
    this.remainingTextB.position.set(Math.round(GAME_WIDTH / 2), Y_COUNTS);
    this.remainingTextB.visible = false;

    this.baysText = new Text({
      text: 'BAYS 0/4',
      style: {
        fill: PASTEL.ink,
        fontSize: 20,
        fontWeight: '700',
        fontFamily: 'system-ui, sans-serif',
      },
    });
    this.baysText.anchor.set(0.5, 0.5);
    this.baysText.position.set(Math.round(GAME_WIDTH / 2), Y_BAYS);

    this.muteBtn = new Text({
      text: '🔊',
      style: { fontSize: 36, fontFamily: 'system-ui, sans-serif' },
    });
    this.muteBtn.anchor.set(0.5, 0.5);
    this.muteBtn.position.set(GAME_WIDTH - 44, 44);
    this.muteBtn.eventMode = 'static';
    this.muteBtn.cursor = 'pointer';
    this.muteBtn.hitArea = new Rectangle(-26, -26, 52, 52);
    // Restore persisted mute before first paint.
    const persisted = load<boolean>(MUTE_KEY, false);
    if (persisted) {
      setMuted(true);
      this.muteBtn.text = '🔇';
    }
    this.muteBtn.on('pointertap', () => {
      const next = !isMuted();
      setMuted(next);
      save(MUTE_KEY, next);
      this.muteBtn.text = next ? '🔇' : '🔊';
    });

    this.addChild(
      this.title,
      this.level,
      this.barBg,
      this.barFill,
      this.progressText,
      this.remainingBg,
      this.remainingBgB,
      this.remainingText,
      this.remainingTextB,
      this.baysText,
      this.muteBtn,
    );
  }

  /** Update level label (LEVEL n only — internal id stays in console). */
  setLevel(label: string, id: string): void {
    this.level.text = label;
    // eslint-disable-next-line no-console
    console.log(`[lbj] level ${label} id=${id}`);
  }

  /** Update delivery progress (call on change only). */
  setProgress(done: number, total: number): void {
    this.progressText.text = `${done} / ${total} bags`;
    const frac = total > 0 ? Math.max(0, Math.min(1, done / total)) : 0;
    const g = this.barFill;
    g.clear();
    if (frac > 0) {
      const fx = BAR_X + 3;
      const fy = BAR_Y + 3;
      const fw = (BAR_W - 6) * frac;
      const fh = BAR_H - 6;
      g.roundRect(fx, fy, fw, fh, 7);
      g.fill({ color: 0x22c55e });
      g.roundRect(fx, fy, fw, fh, 7);
      g.stroke({ color: 0x15803d, width: 2 });
    }
  }

  /** Update bays occupancy (call on change only). */
  setBays(used: number, totalBays: number): void {
    this.baysText.text = `BAYS ${used}/${totalBays}`;
  }

  /** Update per-color bags remaining in the queue (call on change only). */
  setRemaining(counts: Record<SuitcaseColor, number>): void {
    const empty: Record<SuitcaseColor, number> = { red: 0, blue: 0, green: 0, yellow: 0 };
    this.setRemainingDual(counts, empty);
  }

  /** Dual-belt remaining — RETIRED (v9 follow-up): per-color counts now live
   *  on each belt's own header line (Belt.refreshHeader), because these HUD
   *  pills collided with the belt labels. Kept as a no-op so board/Game
   *  wiring is untouched; hides any stale pill visuals. */
  setRemainingDual(
    _countsA: Record<SuitcaseColor, number>,
    _countsB: Record<SuitcaseColor, number>,
  ): void {
    this.remainingText.visible = false;
    this.remainingTextB.visible = false;
    this.remainingBg.visible = false;
    this.remainingBgB.visible = false;
    this.baysText.position.set(Math.round(GAME_WIDTH / 2), Y_BAYS);
  }

  /** v9: level teaching hint is shown once as a board toast — no HUD line. */
  setHint(_hint: string): void {
    return;
  }

  /** v9: combo line deleted (cart pop + sound carry it). Tracked, not drawn. */
  setCombo(combo: number): void {
    this.combo = combo;
  }

  /** Current combo (for tests / tuning). */
  getCombo(): number {
    return this.combo;
  }

  private drawBarShell(): void {
    const g = this.barBg;
    g.clear();
    g.roundRect(BAR_X, BAR_Y, BAR_W, BAR_H, 9);
    g.fill({ color: PASTEL.bandEdge });
    g.roundRect(BAR_X, BAR_Y, BAR_W, BAR_H, 9);
    g.stroke({ color: PASTEL.bandEdge, width: 2 });
  }
}
