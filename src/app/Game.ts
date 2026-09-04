/**
 * Game — owns the Pixi Application + scene root.
 * Portrait 720x1280 FIT, DPR capped, pastel airport theme, level flow
 * (3 levels), HUD + win/fail overlays with Restart/Next.
 */
import { Application, type Ticker } from 'pixi.js';
import { Tween } from '@tweenjs/tween.js';
import {
  BACKGROUND_COLOR,
  GAME_HEIGHT,
  GAME_WIDTH,
} from './config.ts';
import { getEffectiveDPR, isLowEndDevice, FpsWatcher } from '../core/quality.ts';
import { loadAll } from '../core/assets.ts';
import { playFail, playWin } from '../core/audio.ts';
import { Board } from '../game/board.ts';
import { clearEffects, fxGroup, setParticleScale, updateEffects } from '../game/effects.ts';
import { Hud } from '../ui/hud.ts';
import { Overlays } from '../ui/overlays.ts';
import { getLevel, LEVEL_COUNT } from '../levels/pack.ts';
import type { SuitcaseColor } from '../game/types.ts';

export class Game {
  private app: Application | null = null;
  private board: Board | null = null;
  private hud: Hud | null = null;
  private overlays: Overlays | null = null;
  private levelIndex = 0;
  private onResize: (() => void) | null = null;
  private disposed = false;
  private readonly fpsWatcher = new FpsWatcher();
  private booted = false;

  /** Init Pixi + scene. Must be called once with the mount element. */
  async init(container: HTMLElement): Promise<void> {
    await loadAll();

    const app = new Application();
    await app.init({
      width: GAME_WIDTH,
      height: GAME_HEIGHT,
      backgroundColor: BACKGROUND_COLOR,
      antialias: false,
      roundPixels: true,
      resolution: getEffectiveDPR(),
    });
    if (this.disposed) {
      app.destroy(true);
      return;
    }
    this.app = app;

    // Canvas styling for FIT letterbox scaling (logical 720x1280 fixed).
    const canvas = app.canvas;
    canvas.style.display = 'block';
    canvas.style.margin = '0 auto';
    canvas.style.touchAction = 'none';
    container.appendChild(canvas);

    // Scene: board (controller) + HUD + overlays.
    this.board = new Board({
      onHud: (done, total, used, totalBays, remainingA, remainingB) => {
        this.hud?.setProgress(done, total);
        this.hud?.setBays(used, totalBays);
        this.hud?.setRemainingDual(remainingA, remainingB);
      },
      onCombo: (combo) => {
        this.hud?.setCombo(combo);
      },
      onWin: (done, total, stars, moves, par) => this.handleWin(done, total, stars, moves, par),
      onLose: (frontNeeds, parked) => this.handleLose(frontNeeds, parked),
    });
    this.hud = new Hud();
    this.overlays = new Overlays();
    app.stage.addChild(this.board, this.hud, this.overlays);

    // Low-end: halve confetti from the start.
    if (isLowEndDevice()) setParticleScale(0.5);

    // Tick gameplay (board loading timers) + effects (tweens, confetti).
    // Single ticker callback (no duplicate listeners); FPS watcher degrades
    // DPR/particles if <40fps for 60 frames.
    app.ticker.add((ticker: Ticker) => {
      const dt = Math.min(ticker.deltaMS, 100);
      // Never let one bad frame kill the loop (a thrown effect tween used
      // to freeze the whole game on phones): report and keep ticking.
      try {
        this.board?.update(dt);
        updateEffects(dt);
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error('[lbj] tick error (game kept running):', err);
      }
      if (this.fpsWatcher.update(dt)) {
        setParticleScale(0.5);
        try {
          app.renderer.resolution = 1;
          app.renderer.resize(GAME_WIDTH, GAME_HEIGHT);
        } catch {
          // ignore — quality scaling is best-effort
        }
      }
    });

    // FIT resize handler — scale canvas with CSS, keep backing store fixed.
    this.onResize = () => this.resize();
    window.addEventListener('resize', this.onResize);
    window.addEventListener('orientationchange', this.onResize);
    this.resize();

    this.loadLevel(0);

    // Debug hook for automated playtests (harmless in prod).
    try {
      (window as unknown as { __lbj?: unknown }).__lbj = { game: this, board: this.board };
    } catch {
      // ignore
    }

    // eslint-disable-next-line no-console
    console.log('Luggage Belt Jam boot OK');
  }

  /** Load a level index (0-based), refresh HUD, hide overlays. */
  loadLevel(index: number): void {
    const i = Math.max(0, Math.min(index, LEVEL_COUNT - 1));
    // Minimal tuning stats: restarting the same level counts as a restart.
    if (this.booted && i === this.levelIndex) this.board?.trackRestart();
    this.levelIndex = i;
    this.booted = true;
    clearEffects();
    // Re-arm the one-shot FPS watcher so each level gets a fresh 60-frame
    // low-fps window before quality degrades again.
    this.fpsWatcher.reset();
    this.overlays?.hide();
    const level = getLevel(i);
    this.hud?.setLevel(`LEVEL ${i + 1}`, level.id);
    this.board?.loadLevel(level);
  }

  private handleWin(done: number, total: number, stars: number, moves: number, par: number): void {
    playWin();
    const hasNext = this.levelIndex < LEVEL_COUNT - 1;
    // Slow beat so the confetti + final depart read before the panel.
    new Tween({ t: 0 }, fxGroup)
      .to({ t: 1 }, 1000)
      .onComplete(() => {
        if (this.disposed) return;
        this.overlays?.showWin(
          done,
          total,
          hasNext,
          () => this.loadLevel(this.levelIndex),
          () => this.loadLevel(hasNext ? this.levelIndex + 1 : 0),
          stars,
          moves,
          par,
        );
      })
      .start();
  }

  private handleLose(frontNeeds: SuitcaseColor[], parked: SuitcaseColor[]): void {
    playFail();
    this.hud?.setCombo(0);
    // Slow beat so the shake reads before the panel.
    new Tween({ t: 0 }, fxGroup)
      .to({ t: 1 }, 800)
      .onComplete(() => {
        if (this.disposed) return;
        this.overlays?.showFail(frontNeeds, parked, () => this.loadLevel(this.levelIndex));
      })
      .start();
  }

  /** FIT-scale canvas to viewport while preserving aspect. */
  resize(): void {
    const app = this.app;
    if (!app) return;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const scale = Math.min(vw / GAME_WIDTH, vh / GAME_HEIGHT);
    const cssW = Math.floor(GAME_WIDTH * scale);
    const cssH = Math.floor(GAME_HEIGHT * scale);
    app.canvas.style.width = `${cssW}px`;
    app.canvas.style.height = `${cssH}px`;
  }

  /** Cleanup listeners + renderer. */
  destroy(): void {
    this.disposed = true;
    clearEffects();
    if (this.onResize) {
      window.removeEventListener('resize', this.onResize);
      window.removeEventListener('orientationchange', this.onResize);
      this.onResize = null;
    }
    this.app?.destroy(true);
    this.app = null;
    this.board = null;
    this.hud = null;
    this.overlays = null;
  }
}
