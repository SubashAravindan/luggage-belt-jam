/**
 * Board — game controller + scene.
 * Owns the dual queues (Departures A + Arrivals B, FIFO), bay slots,
 * yard carts, delivery progress, jam detection (fail) and drain detection (win).
 *
 * Rules (SPATIAL YARD, DUAL BELTS):
 * - The yard is a visible 2 rows × 4 cols parking lot (8 cells max) with one
 *   exit per level on the left OR right edge at the front row.
 * - Tap any path-clear (reachable) yard cart to park it in the lowest free bay.
 *   Front-row cart: every cell between it and the exit (same row, exit-ward)
 *   must be empty. Back-row cart: its column's front cell + front-row cells
 *   exit-ward from its column must be empty (exits via front, then along front).
 *   Dispatched cells stay empty (no compacting — cells are fixed).
 * - A parked cart whose color equals EITHER belt front auto-loads
 *   one bag per LOAD_MS with a pop + pitch-up tick.
 * - If BOTH fronts match, one load event pulls from both (two bag
 *   flights, delivered+=2, combo+=2, both queues shift). Same-cart dual
 *   (both fronts same color, one cart) takes both bags itself.
 * - A full cart departs (whoosh), frees its bay, and counts delivered.
 * - WIN: both queues empty (all bags delivered). FAIL (jam): queue(s)
 *   remain, neither front has a bay/toBay loader, and no REACHABLE
 *   undispatched cart could change that (unreachable-only remainder = jam).
 */
import { Container, Graphics, Text } from 'pixi.js';
import { Easing, Tween } from '@tweenjs/tween.js';
import {
  BACKGROUND_COLOR,
  BAYS,
  BAYS_DUAL_Y,
  BELT_A,
  BELT_B,
  FLOW_V,
  GAME_HEIGHT,
  GAME_WIDTH,
  LOAD_MS,
  PASTEL,
  YARD,
  YARD_DUAL_Y,
} from '../app/config.ts';
import { Belt } from './belt.ts';
import { Cart } from './cart.ts';
import type { CartDef, GamePhase, LevelDef, SuitcaseColor } from './types.ts';
import { playDepart, playPop } from '../core/audio.ts';
import { load, save } from '../core/storage.ts';
import {
  burstConfetti,
  clearEffects,
  comboPop,
  flashFade,
  fxGroup,
  initConfetti,
  popScale,
  prefersReducedMotion,
  shakeX,
  vibrate,
  wiggleInvalid,
} from './effects.ts';
import type { Luggage } from './luggage.ts';

export interface BoardHooks {
  onHud: (
    delivered: number,
    total: number,
    baysUsed: number,
    baysTotal: number,
    remainingA: Record<SuitcaseColor, number>,
    remainingB: Record<SuitcaseColor, number>,
  ) => void;
  onCombo?: (combo: number) => void;
  onInvalid?: (message: string) => void;
  onWin: (delivered: number, total: number, stars: number, moves: number, par: number) => void;
  onLose: (frontNeeds: SuitcaseColor[], parked: SuitcaseColor[]) => void;
}

interface BaySlot {
  x: number;
  y: number;
  cart: Cart | null;
}

interface YardEntry {
  def: CartDef;
  cart: Cart;
  /** Fixed lot cell center (cells never compact — dispatched cells stay empty). */
  baseX: number;
  baseY: number;
  dispatched: boolean;
  departed: boolean;
  dispatchTween: Tween | null;
}

export class Board extends Container {
  private readonly backdrop: Graphics;
  private world: Container = new Container();
  private belt: Belt | null = null;
  private beltA: Belt | null = null;
  private beltB: Belt | null = null;
  /** Bay slots + yard entries (public for the pw-bot harness). */
  readonly slots: BaySlot[] = [];
  readonly yard: YardEntry[] = [];
  private readonly hooks: BoardHooks;
  /** Dual queues: Departures (A) + Arrivals (B, optional). Public for bot. */
  queueA: SuitcaseColor[] = [];
  queueB: SuitcaseColor[] = [];
  /** Waiter pressure: loads since each belt was last served (reset on serve, ++ on opponent serve). Public for bot. */
  loadsSinceServedA = 0;
  loadsSinceServedB = 0;
  /** Legacy single-queue alias (bot compat): returns Departures. */
  get queue(): SuitcaseColor[] {
    return this.queueA;
  }
  delivered = 0;
  total = 0;
  phase: GamePhase = 'boot';
  private loadAcc = 0;
  private combo = 0;
  private comboGap = 0;
  private levelId = '';
  moves = 0;
  private parMoves = 0;
  private elapsed = 0;
  /** True when queueB non-empty (dual layout + dual rules). */
  private isDual = false;
  /** Bay top Y for the current layout (single BAYS.y vs dual BAYS_DUAL_Y). */
  private bayTopY: number = BAYS.y;
  private readonly tutorialRing: Graphics;
  private readonly tooltip: Text;
  private readonly tooltipBg: Graphics;
  private tooltipTtl = 0;
  /** Persistent short lock segments + pulsing gold blocker outlines (redrawn on flow only). */
  private readonly blockedPaths: Graphics;
  private readonly blockerTint: Graphics;
  private readonly blockedPrev = new Set<string>();
  /** Tap-blocked full-path trace overlay (2.6s TTL, event-driven). */
  private readonly traceFx: Graphics;
  private traceTtl = 0;
  /** In-flight depart tweens, so win/lose can settle them deterministically. */
  private readonly departTweens = new Map<Cart, Tween>();
  /** Bag belt->cart flight tweens (current stage per bag). */
  private readonly bagFlights = new Map<Luggage, Tween>();
  /** Origin belt per in-flight bag (pools are interchangeable but tracked for clean release). */
  private readonly bagBelts = new Map<Luggage, Belt>();
  /** Invalid-tap wiggle tweens + restore bases (re-tappable). */
  private readonly wiggleTweens = new Map<Cart, Tween>();
  private readonly wiggleBase = new Map<Cart, { x: number; r: number }>();
  /** Combo pop tweens per cart. */
  private readonly comboTweens = new Map<Cart, Tween>();
  /** Targeted-bay scale tweens per frame. */
  private readonly bayTweens = new Map<Graphics, Tween>();
  /** Flight layer for detached bag sprites (above carts, below tooltips). */
  private flightLayer: Container = new Container();
  /** Bay slot frames (centered graphics, scalable for targeted feedback). */
  private readonly bayFrames: Graphics[] = [];
  /** Shared overlays: bay red flash, combo white flash, dock ring burst. */
  private readonly bayFlash: Graphics;
  private bayFlashTween: Tween | null = null;
  private readonly comboFlash: Graphics;
  private comboFlashTween: Tween | null = null;
  private readonly dockRing: Graphics;
  private dockRingTween: Tween | null = null;
  /** Yard blocker flash (red ~600ms over path blockers on invalid tap). Pooled. */
  private readonly blockerFlash: Graphics;
  private blockerFlashTween: Tween | null = null;
  /** Board fail-shake tween + base x so settle/load can restore it. */
  private boardShakeTween: Tween | null = null;
  private boardShakeBaseX = 0;
  /** Yard lot home: front-row Y (breathing base per-entry), exit side. */
  private yardBaseY = 0;
  private yardExit: 'left' | 'right' = 'right';
  /** Yard exit tag (rebuilt per level, pooled per level). */
  private yardExitLabel: Text | null = null;

  constructor(hooks: BoardHooks) {
    super();
    this.hooks = hooks;
    this.backdrop = new Graphics();
    this.bayFlash = new Graphics();
    this.bayFlash.visible = false;
    this.comboFlash = new Graphics();
    this.comboFlash.visible = false;
    this.dockRing = new Graphics();
    this.dockRing.visible = false;
    this.blockerFlash = new Graphics();
    this.blockerFlash.visible = false;
    this.tutorialRing = new Graphics();
    this.tutorialRing.visible = false;
    // Pre-build the tutorial ring once (origin-centered); per-frame only
    // moves/scales/fades it — no clear/circle/stroke in the update loop.
    this.tutorialRing.circle(0, 0, 66);
    this.tutorialRing.stroke({ color: 0xf59e0b, width: 5, alpha: 0.9 });
    this.blockedPaths = new Graphics();
    this.blockerTint = new Graphics();
    this.blockedPaths.visible = false;
    this.blockerTint.visible = false;
    this.traceFx = new Graphics();
    this.traceFx.visible = false;
    this.tooltipBg = new Graphics();
    this.tooltipBg.visible = false;
    this.tooltip = new Text({
      text: '',
      style: {
        fill: 0xffffff,
        fontSize: 21,
        fontWeight: '700',
        fontFamily: 'system-ui, sans-serif',
        align: 'center',
        wordWrap: true,
        wordWrapWidth: 560,
      },
    });
    this.tooltip.anchor.set(0.5, 0.5);
    this.tooltip.visible = false;
    this.addChild(this.backdrop, this.world);
    this.drawBackdrop();
    initConfetti(this);
  }

  /** Load (or reload) a level — rebuilds the world layer only. */
  loadLevel(level: LevelDef): void {
    clearEffects();
    if (this.boardShakeTween) {
      this.boardShakeTween.stop();
      this.boardShakeTween = null;
    }
    this.x = this.boardShakeBaseX;
    this.departTweens.clear();
    this.bagFlights.clear();
    this.bagBelts.clear();
    this.wiggleTweens.clear();
    this.wiggleBase.clear();
    this.comboTweens.clear();
    this.bayTweens.clear();
    this.bayFlashTween = null;
    this.comboFlashTween = null;
    this.dockRingTween = null;
    this.blockerFlashTween = null;
    // Detach persistent overlays so the world rebuild doesn't destroy them.
    this.tutorialRing.removeFromParent();
    this.tooltip.removeFromParent();
    this.tooltipBg.removeFromParent();
    this.blockedPaths.removeFromParent();
    this.blockerTint.removeFromParent();
    this.traceFx.removeFromParent();
    this.bayFlash.removeFromParent();
    this.comboFlash.removeFromParent();
    this.dockRing.removeFromParent();
    this.blockerFlash.removeFromParent();
    this.tutorialRing.visible = false;
    this.tooltip.visible = false;
    this.tooltipBg.visible = false;
    this.blockedPaths.visible = false;
    this.blockerTint.visible = false;
    this.traceFx.visible = false;
    this.traceTtl = 0;
    this.blockedPrev.clear();
    this.tooltipTtl = 0;
    this.removeChild(this.world);
    this.world.destroy({ children: true });
    this.world = new Container();
    // Keep the confetti layer (last child) on top.
    const confetti = this.children.length > 1 ? this.getChildAt(this.children.length - 1) : null;
    if (confetti) this.addChildAt(this.world, this.children.length - 1);
    else this.addChild(this.world);
    // Fresh flight layer (old one died with the old world) + reset flashes.
    this.flightLayer = new Container();
    this.bayFrames.length = 0;
    this.bayFlash.visible = false;
    this.bayFlash.alpha = 0;
    this.comboFlash.visible = false;
    this.comboFlash.alpha = 0;
    this.dockRing.visible = false;
    this.dockRing.alpha = 0;
    this.blockerFlash.visible = false;
    this.blockerFlash.alpha = 0;
    this.tooltipBg.visible = false;
    this.tooltipBg.alpha = 1;
    this.blockedPaths.visible = false;
    this.blockerTint.visible = false;
    this.traceFx.visible = false;
    // Old exit tag died with the old world — drop the reference (no double-destroy).
    this.yardExitLabel = null;
    this.world.addChild(this.flightLayer, this.bayFlash, this.comboFlash, this.dockRing, this.blockerFlash, this.blockedPaths, this.blockerTint, this.traceFx);
    // Persistent tutorial overlays live inside the world, on top.
    this.world.addChild(this.tutorialRing, this.tooltipBg, this.tooltip);

    this.slots.length = 0;
    this.yard.length = 0;
    this.levelId = level.id;
    this.moves = 0;
    this.parMoves = level.parMoves ?? level.carts.length;
    this.elapsed = 0;

    this.slots.length = 0;
    this.yard.length = 0;
    // Dual queues: queueA (Departures) + queueB (Arrivals, optional).
    // Legacy spawnQueue falls back to queueA. Absent/empty B = single-belt.
    const qA = level.queueA ?? level.spawnQueue ?? [];
    const qB = level.queueB ?? [];
    this.queueA = [...qA];
    this.queueB = [...qB];
    this.isDual = this.queueB.length > 0;
    this.delivered = 0;
    this.total = this.queueA.length + this.queueB.length;
    this.phase = 'playing';
    this.loadAcc = 0;
    this.combo = 0;
    this.comboGap = 0;
    this.loadsSinceServedA = 0;
    this.loadsSinceServedB = 0;

    // Belts: single keeps current spacing; dual uses two compact strips.
    if (this.isDual) {
      const beltA = new Belt({ ...BELT_A, label: '✈ DEPARTURES' });
      const beltB = new Belt({ ...BELT_B, label: '🧳 ARRIVALS' });
      this.world.addChild(beltA, beltB);
      beltA.sync(this.queueA, false);
      beltB.sync(this.queueB, false);
      this.beltA = beltA;
      this.beltB = beltB;
      this.belt = beltA;
    } else {
      const belt = new Belt({ label: '✈ DEPARTURES' });
      this.world.addChild(belt);
      belt.sync(this.queueA, false);
      this.belt = belt;
      this.beltA = belt;
      this.beltB = null;
    }
    this.updateWaitingTags();

    // Bays row (dual moves y→505, single keeps BAYS.y).
    const bayTop = this.isDual ? BAYS_DUAL_Y : BAYS.y;
    this.bayTopY = bayTop;
    const bayCount = Math.max(1, Math.min(level.bays, BAYS.max));
    const bayLabel = this.makeLabel(
      this.isDual
        ? '🛫 BAYS — parked carts auto-load EITHER glowing bag'
        : '🛫 BAYS — parked carts auto-load the glowing bag',
    );
    bayLabel.position.set(GAME_WIDTH / 2, bayTop - 42);
    this.world.addChild(bayLabel);
    const bayTotalW = bayCount * BAYS.slotW + (bayCount - 1) * BAYS.gap;
    const bayX0 = (GAME_WIDTH - bayTotalW) / 2 + BAYS.slotW / 2;
    const bayY = bayTop + BAYS.slotH / 2;
    for (let i = 0; i < bayCount; i++) {
      const x = bayX0 + i * (BAYS.slotW + BAYS.gap);
      const frame = new Graphics();
      // Centered dashed slot so scale punches (1.05x) expand about the slot.
      this.drawDashedSlotCentered(frame, BAYS.slotW, BAYS.slotH);
      frame.position.set(x, bayY);
      this.world.addChild(frame);
      this.bayFrames.push(frame);
      this.slots.push({ x, y: bayY, cart: null });
    }

    // Yard lot: visible 2 rows × 4 cols parking lot whose geometry gates dispatch.
    // Row 0 = front (exit row, bays side), row 1 = back. Exit on left/right edge.
    const yardTop = this.isDual ? YARD_DUAL_Y : YARD.y;
    const yardLabel = this.makeLabel(
      this.isTutorialLevel() ? '👇 TAP THE GLOWING CART' : '👇 TAP A CART TO PARK IT',
    );
    yardLabel.position.set(GAME_WIDTH / 2, yardTop - 52);
    this.world.addChild(yardLabel);
    this.yardExit = level.exit ?? 'right';
    const frontY = yardTop + YARD.frontYOffset;
    this.yardBaseY = frontY;
    this.buildYardLot(yardTop, frontY);
    for (const def of level.carts) {
      if (!def) continue;
      const cart = new Cart(def);
      // Facing readability: front-row noses point at the exit side, back-row
      // noses point up (forward → then exit-ward). Rules unchanged.
      cart.setFacing(def.row === 0 ? this.yardExit : 'up');
      const { x, y } = this.cellCenter(def.row, def.col, frontY);
      cart.position.set(x, y);
      const entry: YardEntry = { def, cart, baseX: x, baseY: y, dispatched: false, departed: false, dispatchTween: null };
      cart.setOnTap(() => this.tryDispatch(entry));
      this.world.addChild(cart);
      this.yard.push(entry);
    }
    // Blockers overlay + hint/ring/tooltip stay on top of carts.
    this.world.addChild(this.blockedPaths, this.blockerTint, this.traceFx, this.blockerFlash, this.tutorialRing, this.tooltipBg, this.tooltip);
    this.refreshYard();

    // Footer: short player copy + tiny muted version corner tag (playtest aid).
    const footer = this.makeLabel('Match the glowing bag ✈', 19);
    footer.position.set(GAME_WIDTH / 2, GAME_HEIGHT - 64);
    this.world.addChild(footer);
    const vtag = new Text({
      text: `v${FLOW_V}${prefersReducedMotion() ? ' • calm' : ''}`,
      style: { fill: PASTEL.muted, fontSize: 14, fontFamily: 'system-ui, sans-serif' },
    });
    vtag.anchor.set(1, 1);
    vtag.position.set(GAME_WIDTH - 16, GAME_HEIGHT - 16);
    this.world.addChild(vtag);

    this.emitHud();
    // v9: level teaching hint shows once as an auto-fading dark-pill toast.
    if (level.hint && level.hint.length > 0) {
      this.showTooltipAt(GAME_WIDTH / 2, 620, level.hint, 4000);
    }
  }

  /** Per-tick update (dt in ms, clamped by caller). Drives auto-loading. */
  update(dtMs: number): void {
    if (this.phase !== 'playing') return;
    const dt = Math.min(dtMs, 100);
    this.elapsed += dt;
    this.beltA?.update(dt);
    this.beltB?.update(dt);
    // Tooltip fade (reused objects, no allocs).
    if (this.tooltip.visible) {
      this.tooltipTtl -= dt;
      if (this.tooltipTtl <= 0) {
        this.tooltip.visible = false;
        this.tooltipBg.visible = false;
      }
    }
    this.updateTutorialRing();
    this.updateBayPulse();
    // Tap-blocked full-path trace decay (2.6s TTL, no per-frame redraw).
    if (this.traceTtl > 0) {
      this.traceTtl -= dt;
      if (this.traceTtl <= 0) {
        this.traceTtl = 0;
        this.traceFx.visible = false;
        this.blockerFlash.visible = false;
      }
    }
    // Blockers pulse GOLD (action-here language): alpha only, never redrawn.
    if (this.blockerTint.visible) {
      this.blockerTint.alpha = 0.6 + 0.35 * Math.sin(this.elapsed / 180);
    }
    this.comboGap += dt;
    if (this.comboGap > 1200 && this.combo !== 0) {
      this.combo = 0;
      this.hooks.onCombo?.(0);
    }

    const frontA = this.queueA[0];
    const frontB = this.queueB[0];
    if (frontA === undefined && frontB === undefined) return;
    const loaderA = frontA !== undefined ? this.findLoader(frontA) : null;
    const loaderB = frontB !== undefined ? this.findLoader(frontB) : null;
    if (!loaderA && !loaderB) {
      this.loadAcc = 0;
      return;
    }
    this.loadAcc += dt;
    if (this.loadAcc >= LOAD_MS) {
      this.loadAcc = 0;
      this.doLoad(loaderA, loaderB);
    }
  }

  // ------------------------------------------------------------------ rules

  private findLoader(front: SuitcaseColor): Cart | null {
    for (const slot of this.slots) {
      const c = slot.cart;
      if (c && c.state === 'bay' && c.color === front && c.loaded < c.capacity) return c;
    }
    return null;
  }

  /**
   * Dual load event (LOAD_MS cadence unchanged). A parked cart loads when its
   * color matches EITHER front. If BOTH fronts have loaders, one event pulls
   * from both (two bag flights, delivered+=2, combo+=2, both queues shift).
   */
  private doLoad(loaderA: Cart | null, loaderB: Cart | null): void {
    if (this.phase !== 'playing') return;
    if (!loaderA && !loaderB) return;
    const frontA = this.queueA[0];
    const frontB = this.queueB[0];

    if (loaderA && loaderB) {
      if (loaderA === loaderB) {
        // Same-cart dual: both fronts share one cart's color.
        if (frontA === undefined || frontB === undefined) return;
        this.queueA.shift();
        this.queueB.shift();
        this.delivered += 2;
        this.combo += 2;
        this.comboGap = 0;
        this.hooks.onCombo?.(this.combo);
        playPop(this.combo);
        vibrate(10);
        this.loadsSinceServedA = 0;
        this.loadsSinceServedB = 0;
        const beltA = this.beltA;
        const beltB = this.beltB ?? this.beltA;
        const bagA = beltA ? beltA.takeFront(this.queueA) : null;
        const bagB = beltB ? beltB.takeFront(this.queueB) : null;
        if (bagA && beltA) this.flyBagToCart(bagA, beltA, loaderA);
        else this.finishLoad(loaderA);
        if (bagB && beltB) this.flyBagToCart(bagB, beltB, loaderA);
        else this.finishLoad(loaderA);
        this.updateWaitingTags();
        this.emitHud();
        return;
      }
      // Two-cart dual: each front feeds its own loader.
      if (frontA === undefined || frontB === undefined) return;
      this.queueA.shift();
      this.queueB.shift();
      this.delivered += 2;
      this.combo += 2;
      this.comboGap = 0;
      this.hooks.onCombo?.(this.combo);
      playPop(this.combo);
      vibrate(10);
      this.loadsSinceServedA = 0;
      this.loadsSinceServedB = 0;
      const beltA = this.beltA;
      const beltB = this.beltB ?? this.beltA;
      const bagA = beltA ? beltA.takeFront(this.queueA) : null;
      const bagB = beltB ? beltB.takeFront(this.queueB) : null;
      if (bagA && beltA) this.flyBagToCart(bagA, beltA, loaderA);
      else this.finishLoad(loaderA);
      if (bagB && beltB) this.flyBagToCart(bagB, beltB, loaderB);
      else this.finishLoad(loaderB);
      this.updateWaitingTags();
      this.emitHud();
      return;
    }

    if (loaderA) {
      if (frontA === undefined) return;
      this.queueA.shift();
      this.delivered += 1;
      this.combo += 1;
      this.comboGap = 0;
      this.hooks.onCombo?.(this.combo);
      playPop(this.combo);
      vibrate(10);
      this.loadsSinceServedA = 0;
      if (this.queueB.length > 0) this.loadsSinceServedB += 1;

      const belt = this.beltA;
      const bag = belt ? belt.takeFront(this.queueA) : null;
      if (bag && belt) {
        // Always flies — calm mode branches to a simplified straight slide
        // inside flyBagToCart. Never snaps.
        this.flyBagToCart(bag, belt, loaderA);
      } else {
        this.finishLoad(loaderA);
      }
      this.updateWaitingTags();
      this.emitHud();
      return;
    }

    // loaderB only.
    if (frontB === undefined || !loaderB) return;
    this.queueB.shift();
    this.delivered += 1;
    this.combo += 1;
    this.comboGap = 0;
    this.hooks.onCombo?.(this.combo);
    playPop(this.combo);
    vibrate(10);
    this.loadsSinceServedB = 0;
    if (this.queueA.length > 0) this.loadsSinceServedA += 1;

    const belt = this.beltB ?? this.beltA;
    const bag = belt ? belt.takeFront(this.queueB) : null;
    if (bag && belt) {
      this.flyBagToCart(bag, belt, loaderB);
    } else {
      this.finishLoad(loaderB);
    }
    this.updateWaitingTags();
    this.emitHud();
  }

  /** Waiting tint: front unserved for ≥3 opponent loads shows WAITING; reset on serve. */
  private updateWaitingTags(): void {
    this.beltA?.setWaiting(this.loadsSinceServedA >= 3 && this.queueA.length > 0);
    if (this.beltB) {
      this.beltB.setWaiting(this.loadsSinceServedB >= 3 && this.queueB.length > 0);
    }
  }

  /**
   * CINEMATIC bag flow belt->cart (Bus-Jam people-walk equivalent), slow and
   * readable: 200ms squash anticipation -> 900-1200ms Cubic-Out arc with
   * 90px peak + stretch + tilt -> 180ms land squash -> 250ms recover.
   * One bag at a time (LOAD_MS spaces them). Detached to flightLayer.
   */
  private flyBagToCart(bag: Luggage, belt: Belt, cart: Cart): void {
    const from = belt.toGlobal(bag.position);
    const start = this.flightLayer.toLocal(from);
    this.flightLayer.addChild(bag);
    bag.position.copyFrom(start);
    bag.rotation = 0;
    this.bagBelts.set(bag, belt);
    const tx = cart.position.x;
    const ty = cart.position.y - 10;
    const sx = start.x;
    const sy = start.y;
    const dist = Math.hypot(tx - sx, ty - sy);
    // Calm mode: simplified VISIBLE flight — straight 700ms slide, no
    // squash/stretch/rotation/arc. Never snaps; tracked identically.
    if (prefersReducedMotion()) {
      const t = new Tween(bag.position, fxGroup)
        .to({ x: tx, y: ty }, 700)
        .easing(Easing.Quadratic.Out)
        .onComplete(() => {
          this.bagFlights.delete(bag);
          this.bagBelts.delete(bag);
          belt.releaseBag(bag);
          if (this.phase !== 'playing') return;
          this.finishLoad(cart);
        });
      this.bagFlights.set(bag, t);
      t.start();
      return;
    }
    const flightMs = Math.max(900, Math.min(1200, Math.round(dist / 0.3)));
    const stagger = this.bagFlights.size * 120;
    const startScale = bag.scale.x || 1;

    const anti = { s: startScale };
    const tAnti = new Tween(anti, fxGroup)
      .to({ s: 0.9 }, 200)
      .easing(Easing.Quadratic.Out)
      .delay(stagger)
      .onUpdate(() => {
        bag.scale.set(anti.s, anti.s);
      });
    const prog = { t: 0 };
    const tFly = new Tween(prog, fxGroup)
      .to({ t: 1 }, flightMs)
      .easing(Easing.Cubic.Out)
      .onUpdate(() => {
        const p = prog.t;
        const lx = sx + (tx - sx) * p;
        const ly = sy + (ty - sy) * p - Math.sin(p * Math.PI) * 90;
        bag.position.set(lx, ly);
        bag.rotation = 0.17 * Math.sin(p * Math.PI);
        const stretch = Math.sin(p * Math.PI);
        bag.scale.set(0.9 + 0.1 * p + 0.15 * stretch, 0.9 + 0.1 * p - 0.1 * stretch);
      });
    const land = { x: 1, y: 1 };
    const tLand = new Tween(land, fxGroup)
      .to({ x: 1.15, y: 0.85 }, 180)
      .easing(Easing.Quadratic.Out)
      .onUpdate(() => {
        bag.scale.set(land.x, land.y);
      });
    const rec = { x: 1.15, y: 0.85 };
    const tRec = new Tween(rec, fxGroup)
      .to({ x: 1, y: 1 }, 250)
      .easing(Easing.Quadratic.Out)
      .onUpdate(() => {
        bag.scale.set(rec.x, rec.y);
      })
      .onComplete(() => {
        this.bagFlights.delete(bag);
        this.bagBelts.delete(bag);
        belt.releaseBag(bag);
        if (this.phase !== 'playing') return;
        this.finishLoad(cart);
      });
    // Manual chain so settleInFlight can kill the current stage deterministically.
    this.bagFlights.set(bag, tAnti);
    tAnti.onComplete(() => {
      if (!this.bagFlights.has(bag)) return;
      this.bagFlights.set(bag, tFly);
      tFly.start();
    });
    tFly.onComplete(() => {
      if (!this.bagFlights.has(bag)) return;
      bag.position.set(tx, ty);
      bag.rotation = 0;
      this.bagFlights.set(bag, tLand);
      tLand.start();
    });
    tLand.onComplete(() => {
      if (!this.bagFlights.has(bag)) return;
      this.bagFlights.set(bag, tRec);
      tRec.start();
    });
    tAnti.start();
  }

  private finishLoad(cart: Cart): void {
    if (this.phase !== 'playing') return;
    // Late landings: a bag flight started while the cart had space can land
    // AFTER the cart filled via another bag and started departing (LOAD_MS
    // cadence overlaps flight time). Only bay carts accept loads — the bag
    // was already returned to the pool by the caller, so just ignore.
    if (cart.state !== 'bay' || cart.destroyed) return;
    cart.setLoaded(cart.loaded + 1);
    if (cart.loaded >= cart.capacity) {
      // Full cart: depart dip is the anticipation — skip the 1.25 pop and
      // any combo punch so scale isn't fought over by concurrent tweens.
      const prevCombo = this.comboTweens.get(cart);
      if (prevCombo) {
        prevCombo.stop();
        this.comboTweens.delete(cart);
      }
      cart.scale.set(1, 1);
      this.depart(cart);
    } else if (this.combo >= 2 && !prefersReducedMotion()) {
      // Combo pop (>=2): 180ms Back-Out to 1.25x + 120ms back + white flash
      // 150ms + pooled star puff; pitch-up already in audio. Else small punch.
      const prev = this.comboTweens.get(cart);
      if (prev) {
        prev.stop();
        this.comboTweens.delete(cart);
      }
      const t = comboPop(cart, () => {
        this.comboTweens.delete(cart);
      });
      this.comboTweens.set(cart, t);
      this.flashComboAt(cart.position.x, cart.position.y);
      burstConfetti(cart.position.x, cart.position.y - 40, 12);
    } else {
      // Squash read: bag lands, cart punches 1.12 -> 1 (Back.Out).
      popScale(cart, 1.12, 180);
    }
    if (cart.loaded < cart.capacity) {
      this.checkJam();
    }
    if (this.queueA.length === 0 && this.queueB.length === 0) this.win();
  }

  private depart(cart: Cart): void {
    // Double-depart guard: late bag landings must never re-depart a cart
    // already leaving (would fork exit tweens and destroy twice).
    if (cart.state === 'departing' || cart.state === 'departed' || cart.destroyed) return;
    cart.state = 'departing';
    cart.setOnTap(null);
    playDepart();
    // Free the bay synchronously so dispatch/jam logic sees it as available
    // during the slow fly-out; the visual keeps animating detached.
    const freed = this.slots.find((s) => s.cart === cart);
    if (freed) freed.cart = null;
    this.refreshYard();
    this.emitHud();
    // Calm mode still drives off — plain 900ms exit + fade, no dip /
    // squash / arc. Never snaps; tracked identically for settle kills.
    const startX = cart.position.x;
    const startY = cart.position.y;
    if (prefersReducedMotion()) {
      const prog = { t: 0 };
      const exitMs = 900;
      const t = new Tween(prog, fxGroup)
        .to({ t: 1 }, exitMs)
        .easing(Easing.Quadratic.Out)
        .onUpdate(() => {
          const p = prog.t;
          cart.position.x = startX + 568 * p;
          const remain = (1 - p) * exitMs;
          cart.alpha = remain <= 350 ? Math.max(0, remain / 350) : 1;
        })
        .onComplete(() => {
          this.departTweens.delete(cart);
          this.finishDepart(cart);
        });
      this.departTweens.set(cart, t);
      t.start();
      return;
    }
    // CINEMATIC depart, slow and weighty: 250ms dip back 12px + squash
    // 0.95x anticipation, then 1400ms Cubic-In accelerating exit with 25px
    // upward arc, fade alpha only in the last 350ms.
    const dipX = startX - 12;
    const exitMs = 1400;
    const dip = { x: startX, s: cart.scale.x || 1 };
    const prog = { t: 0 };
    const tExit = new Tween(prog, fxGroup)
      .to({ t: 1 }, exitMs)
      .easing(Easing.Cubic.In)
      .onUpdate(() => {
        const p = prog.t;
        cart.position.x = dipX + (568) * p;
        cart.position.y = startY - Math.sin(p * Math.PI) * 25;
        const s = 0.95 + 0.05 * p;
        cart.scale.set(s, s);
        const remain = (1 - p) * exitMs;
        cart.alpha = remain <= 350 ? Math.max(0, remain / 350) : 1;
      })
      .onComplete(() => {
        this.departTweens.delete(cart);
        this.finishDepart(cart);
      });
    const tDip = new Tween(dip, fxGroup)
      .to({ x: dipX, s: 0.95 }, 250)
      .easing(Easing.Quadratic.Out)
      .onUpdate(() => {
        cart.position.x = dip.x;
        cart.scale.set(dip.s, dip.s);
      })
      .onComplete(() => {
        if (!this.departTweens.has(cart)) return;
        this.departTweens.set(cart, tExit);
        tExit.start();
      });
    this.departTweens.set(cart, tDip);
    tDip.start();
  }

  /** Shared departure cleanup — tween completion or win/lose settle path. */
  private finishDepart(cart: Cart): void {
    // Idempotent: late landings, settle paths and tween completions can all
    // converge here; destroy exactly once so tweens never touch a dead cart.
    const entry = this.yard.find((e) => e.cart === cart);
    if (entry?.departed || cart.destroyed) return;
    cart.state = 'departed';
    const slot = this.slots.find((s) => s.cart === cart);
    if (slot) slot.cart = null;
    if (entry) {
      entry.departed = true;
      entry.dispatchTween = null;
    }
    this.world.removeChild(cart);
    cart.destroy({ children: true });
    this.refreshYard();
    this.emitHud();
    this.checkJam();
    if (this.queueA.length === 0 && this.queueB.length === 0) this.win();
  }

  /** Tap a yard cart to park it (public for the pw-bot harness). */
  tryDispatch(entry: YardEntry): void {
    if (this.phase !== 'playing') return;
    if (entry.dispatched || entry.cart.state !== 'yard') return; // double-tap guard
    if (this.isBlocked(entry)) {
      const blockers = this.getBlockers(entry);
      this.showTraceFor(entry, blockers);
      this.invalidTap(entry.cart, 'Move the cart ahead first.', 'locked');
      return;
    }
    const slot = this.slots.find((s) => s.cart === null);
    if (!slot) {
      this.invalidTap(entry.cart, 'Wait for carts to fly away.', 'bays-full');
      return;
    }
    // Occupy synchronously so a second tap in the same frame cannot steal it.
    entry.dispatched = true;
    this.moves += 1;
    slot.cart = entry.cart;
    entry.cart.state = 'toBay';
    entry.cart.setOnTap(null);
    entry.cart.setDimmed(false);
    const cart = entry.cart;
    const slotIdx = this.slots.indexOf(slot);
    // MOVEMENT READABILITY: instant (0-50ms) tap feedback BEFORE motion
    // starts — no dead air. popScale punches, playPop(1) ticks, bay pulses.
    // refreshYard below passes the tutorial/hint ring to the next cart
    // immediately. All no-op safely under reduced motion.
    popScale(cart, 1.15, 350);
    playPop(1);
    this.pulseTargetBay(slotIdx);
    // Calm mode still drives — no snap. dispatchCartMotion branches
    // internally to a simplified visible slide (same tracking/settle).
    this.dispatchCartMotion(entry, slot, slotIdx);
    // Spatial yard: cells are fixed — dispatched cells stay empty (no compacting).
    this.refreshYard();
    this.emitHud();
  }

  /**
   * CINEMATIC cart yard->bay, responsive-start: 120ms anticipation pull-back
   * 8px (no dead air — tap punch/tick/bay-pulse already fired in
   * tryDispatch), then PATH DRIVE through the lot exit (same cells as the
   * isBlocked gate), then main flight 1400-1800ms by EXIT-point distance
   * (~160px/s) Cubic-Out with 50px arc bow + slow sway, then 8px overshoot
   * 150ms + 300ms Back-Out settle. Total ~120+path+main+150+300 ≈ 2.2s.
   * Tracked for deterministic kill (tAnti→tPath→tMain→tOver→tSettle).
   */
  private dispatchCartMotion(entry: YardEntry, slot: BaySlot, slotIdx: number): void {
    const cart = entry.cart;
    const fromX = cart.position.x;
    const fromY = cart.position.y;
    const toX = slot.x;
    const toY = slot.y;
    const dx = toX - fromX;
    const dy = toY - fromY;
    const dist = Math.hypot(dx, dy);
    const len = Math.max(1, dist);
    const ux = dx / len;
    const uy = dy / len;
    const pullX = fromX - ux * 8;
    const pullY = fromY - uy * 8;
    const overX = toX + ux * 8;
    const overY = toY + uy * 8;

    // PATH DRIVE: exit-path cells with the SAME logic as isBlocked —
    // front (row 0): same-row cells exit-ward; back (row 1): column front
    // cell + front-row cells exit-ward — via cellCenter, plus exit-edge point.
    const frontY = this.yardBaseY;
    const exit = this.yardExit;
    const c = entry.def.col;
    const r = entry.def.row;
    const edgeX = exit === 'right' ? GAME_WIDTH - 32 : 32;
    const pathCells: Array<{ x: number; y: number }> = [];
    if (r === 1) pathCells.push(this.cellCenter(0, c, frontY));
    if (exit === 'right') {
      for (let cc = c + 1; cc <= 3; cc++) pathCells.push(this.cellCenter(0, cc, frontY));
    } else {
      for (let cc = c - 1; cc >= 0; cc--) pathCells.push(this.cellCenter(0, cc, frontY));
    }
    const exitPt = { x: edgeX, y: frontY };
    // Recompute main from the EXIT point (not the yard cell) so total stays ~2.2s.
    const mainDist = Math.hypot(toX - exitPt.x, toY - exitPt.y);
    const mainMs = Math.max(1400, Math.min(1800, Math.round((mainDist / 160) * 1000)));

    // Targeted-bay pulse already fired in tryDispatch for 0-50ms feedback.

    const tAnti = new Tween(cart.position, fxGroup)
      .to({ x: pullX, y: pullY }, 120)
      .easing(Easing.Quadratic.Out);
    // Path polyline: pull point → path cells → exit edge, sampled as ONE
    // prog tween (Quad In-Out, ~175ms per cell, cap ~700ms). Rotation stays
    // 0 on the path (no spin); sway applies on the main flight only.
    const pathPts: Array<{ x: number; y: number }> = [{ x: pullX, y: pullY }, ...pathCells, exitPt];
    const segLens: number[] = [];
    let pathLen = 0;
    for (let i = 1; i < pathPts.length; i++) {
      const a = pathPts[i - 1]!;
      const b = pathPts[i]!;
      const l = Math.hypot(b.x - a.x, b.y - a.y);
      segLens.push(l);
      pathLen += l;
    }
    const pathMs = Math.max(175, Math.min(700, (pathCells.length + 1) * 175));
    const progPath = { t: 0 };
    const tPath = new Tween(progPath, fxGroup)
      .to({ t: 1 }, pathMs)
      .easing(Easing.Quadratic.InOut)
      .onUpdate(() => {
        const target = Math.max(0, Math.min(1, progPath.t)) * pathLen;
        let acc = 0;
        let px = pathPts[pathPts.length - 1]!.x;
        let py = pathPts[pathPts.length - 1]!.y;
        for (let i = 0; i < segLens.length; i++) {
          const sl = segLens[i]!;
          if (target <= acc + sl || i === segLens.length - 1) {
            const a = pathPts[i]!;
            const b = pathPts[i + 1]!;
            const f = sl < 1 ? 1 : Math.max(0, Math.min(1, (target - acc) / sl));
            px = a.x + (b.x - a.x) * f;
            py = a.y + (b.y - a.y) * f;
            break;
          }
          acc += sl;
        }
        cart.position.set(px, py);
        cart.rotation = 0;
      });
    const prog = { t: 0 };
    const tMain = new Tween(prog, fxGroup)
      .to({ t: 1 }, mainMs)
      .easing(Easing.Cubic.Out)
      .onUpdate(() => {
        const p = prog.t;
        const lx = exitPt.x + (toX - exitPt.x) * p;
        const ly = exitPt.y + (toY - exitPt.y) * p - Math.sin(p * Math.PI) * 50;
        cart.position.set(lx, ly);
        cart.rotation = 0.05 * Math.sin(p * Math.PI * 2);
      });
    const tOver = new Tween(cart.position, fxGroup)
      .to({ x: overX, y: overY }, 150)
      .easing(Easing.Quadratic.Out)
      .onUpdate(() => {
        cart.rotation = 0;
      });
    // Shared dock settle — full and calm paths both land here, so state,
    // HUD, yard flow and jam checks behave identically.
    const settleDock = () => {
      entry.dispatchTween = null;
      // Always settle the state — the phase may have flipped mid-flight.
      cart.state = 'bay';
      cart.rotation = 0;
      if (!prefersReducedMotion()) popScale(cart, 1.12, 350);
      this.dockBurst(slot);
      this.releaseTargetBay(slotIdx);
      if (this.phase !== 'playing') return;
      // Spatial yard: cells stay fixed — nothing slides on dock.
      this.slideYardForward();
      this.refreshYard();
      this.emitHud();
      this.checkJam();
    };
    const tSettle = new Tween(cart.position, fxGroup)
      .to({ x: toX, y: toY }, 300)
      .easing(Easing.Back.Out)
      .onComplete(settleDock);
    // Calm mode: simplified VISIBLE slide — plain 700ms drive, no arc /
    // pull-back / overshoot / rotation. Never snaps; tracked identically
    // so settle kills work the same.
    if (prefersReducedMotion()) {
      const t = new Tween(cart.position, fxGroup)
        .to({ x: toX, y: toY }, 700)
        .easing(Easing.Quadratic.Out)
        .onComplete(settleDock);
      entry.dispatchTween = t;
      t.start();
      return;
    }
    // Manual chain for deterministic kill (later stages never start if killed).
    // Path tween is tracked via the same map so settleInFlight kills it.
    entry.dispatchTween = tAnti;
    tAnti.onComplete(() => {
      if (entry.dispatchTween !== tAnti) return;
      entry.dispatchTween = tPath;
      tPath.start();
    });
    tPath.onComplete(() => {
      if (entry.dispatchTween !== tPath) return;
      entry.dispatchTween = tMain;
      tMain.start();
    });
    tMain.onComplete(() => {
      if (entry.dispatchTween !== tMain) return;
      entry.dispatchTween = tOver;
      tOver.start();
    });
    tOver.onComplete(() => {
      if (entry.dispatchTween !== tOver) return;
      entry.dispatchTween = tSettle;
      tSettle.start();
    });
    tAnti.start();
  }

  /**
   * Yard slide-forward (spatial lot): no-op — cells are fixed and dispatched
   * cells stay empty. Kept as a named hook so dock paths read clearly.
   * Breathing (update loop) keeps running — y bob + scale only, x untouched.
   */
  private slideYardForward(): void {
    return;
  }

  /** v9: yard-cart breathing removed (bay pulse stays). */

  /** Empty bay pulse: alpha 0.3-0.6, slow 1800ms Sine. Occupied stay solid. */
  private updateBayPulse(): void {
    if (this.bayFrames.length === 0) return;
    if (prefersReducedMotion()) {
      for (let i = 0; i < this.slots.length; i++) {
        const frame = this.bayFrames[i];
        const slot = this.slots[i];
        if (!frame || !slot) continue;
        if (slot.cart !== null) frame.alpha = 1;
        else if (!this.bayTweens.has(frame)) frame.alpha = 0.6;
      }
      return;
    }
    const TAU = Math.PI * 2;
    for (let i = 0; i < this.slots.length; i++) {
      const frame = this.bayFrames[i];
      const slot = this.slots[i];
      if (!frame || !slot) continue;
      if (slot.cart !== null) {
        if (!this.bayTweens.has(frame)) frame.alpha = 1;
        continue;
      }
      if (this.bayTweens.has(frame)) continue;
      frame.alpha = 0.45 + 0.15 * Math.sin((this.elapsed / 1800) * TAU + i * 0.9);
    }
  }

  /** Targeted bay: punch to 1.05x over 350ms + brighten. */
  private pulseTargetBay(slotIdx: number): void {
    const frame = this.bayFrames[slotIdx];
    if (!frame || prefersReducedMotion()) return;
    const prev = this.bayTweens.get(frame);
    if (prev) {
      prev.stop();
      this.bayTweens.delete(frame);
    }
    frame.alpha = 1;
    const proxy = { s: frame.scale.x || 1 };
    const tween = new Tween(proxy, fxGroup)
      .to({ s: 1.05 }, 350)
      .easing(Easing.Quadratic.Out)
      .onUpdate(() => {
        frame.scale.set(proxy.s, proxy.s);
      })
      .onComplete(() => {
        this.bayTweens.delete(frame);
      })
      .start();
    this.bayTweens.set(frame, tween);
  }

  private releaseTargetBay(slotIdx: number): void {
    const frame = this.bayFrames[slotIdx];
    if (!frame || prefersReducedMotion()) return;
    const prev = this.bayTweens.get(frame);
    if (prev) {
      prev.stop();
      this.bayTweens.delete(frame);
    }
    const proxy = { s: frame.scale.x || 1.05 };
    const tween = new Tween(proxy, fxGroup)
      .to({ s: 1 }, 350)
      .easing(Easing.Quadratic.Out)
      .onUpdate(() => {
        frame.scale.set(proxy.s, proxy.s);
      })
      .onComplete(() => {
        frame.scale.set(1, 1);
        this.bayTweens.delete(frame);
      })
      .start();
    this.bayTweens.set(frame, tween);
  }

  /** On-dock ring burst: expanding gold ring + pooled confetti puff. */
  private dockBurst(slot: BaySlot): void {
    if (prefersReducedMotion()) return;
    burstConfetti(slot.x, slot.y, 12);
    const ring = this.dockRing;
    if (this.dockRingTween) {
      this.dockRingTween.stop();
      this.dockRingTween = null;
    }
    ring.removeFromParent();
    this.world.addChild(ring);
    this.world.addChild(this.tutorialRing, this.tooltipBg, this.tooltip);
    ring.clear();
    ring.circle(0, 0, 46);
    ring.stroke({ color: 0xf59e0b, width: 5, alpha: 0.9 });
    ring.position.set(slot.x, slot.y);
    ring.scale.set(0.6, 0.6);
    ring.visible = true;
    ring.alpha = 0.9;
    const proxy = { s: 0.6, a: 0.9 };
    this.dockRingTween = new Tween(proxy, fxGroup)
      .to({ s: 1.4, a: 0 }, 600)
      .easing(Easing.Quadratic.Out)
      .onUpdate(() => {
        ring.scale.set(proxy.s, proxy.s);
        ring.alpha = proxy.a;
      })
      .onComplete(() => {
        ring.visible = false;
        this.dockRingTween = null;
      })
      .start();
  }

  /**
   * Invalid tap: 300ms wiggle x -6/+6/-3/0 + ±3deg + bay red flash 150ms.
   * Re-tappable during (prior wiggle for the cart is restarted, input never
   * disabled for invalid targets).
   */
  private invalidTap(cart: Cart, message: string, reason: string): void {
    if (!prefersReducedMotion()) {
      const prev = this.wiggleTweens.get(cart);
      if (prev) {
        prev.stop();
        this.wiggleTweens.delete(cart);
      }
      const base = this.wiggleBase.get(cart);
      if (base) {
        cart.position.x = base.x;
        cart.rotation = base.r;
      } else {
        cart.rotation = 0;
      }
      this.wiggleBase.set(cart, { x: cart.position.x, r: cart.rotation });
      const tween = wiggleInvalid(cart, () => {
        this.wiggleTweens.delete(cart);
        this.wiggleBase.delete(cart);
      });
      this.wiggleTweens.set(cart, tween);
      this.flashBayRed();
    }
    this.showTooltip(cart, message);
    this.hooks.onInvalid?.(reason);
  }

  /** Bay red flash 150ms (shared overlay, transform/alpha only). */
  private flashBayRed(): void {
    const flash = this.bayFlash;
    if (this.bayFlashTween) {
      this.bayFlashTween.stop();
      this.bayFlashTween = null;
    }
    flash.removeFromParent();
    this.world.addChild(flash);
    this.world.addChild(this.tutorialRing, this.tooltipBg, this.tooltip);
    const w = this.slots.length > 0 ? this.slots.length * BAYS.slotW + (this.slots.length - 1) * BAYS.gap : 300;
    flash.clear();
    flash.roundRect(-w / 2, -BAYS.slotH / 2, w, BAYS.slotH, 18);
    flash.fill({ color: 0xef4444, alpha: 0.35 });
    // Center across the bay row (dual-aware Y).
    const midX = this.slots.length > 0 ? (this.slots[0]!.x + this.slots[this.slots.length - 1]!.x) / 2 : GAME_WIDTH / 2;
    flash.position.set(midX, this.bayTopY + BAYS.slotH / 2);
    flash.visible = true;
    this.bayFlashTween = flashFade(flash, 0.55, 150, () => {
      this.bayFlashTween = null;
    });
  }

  /** Combo white flash 150ms at the cart (shared overlay). */
  private flashComboAt(x: number, y: number): void {
    const flash = this.comboFlash;
    if (this.comboFlashTween) {
      this.comboFlashTween.stop();
      this.comboFlashTween = null;
    }
    flash.removeFromParent();
    this.flightLayer.addChild(flash);
    flash.clear();
    flash.circle(0, 0, 52);
    flash.fill({ color: 0xffffff, alpha: 0.65 });
    flash.position.set(x, y);
    flash.visible = true;
    this.comboFlashTween = flashFade(flash, 0.65, 150, () => {
      this.comboFlashTween = null;
    });
  }

  /**
   * Spatial lot gate: a cart may dispatch iff every cell between it and the
   * exit is empty. Front (row 0): same-row cells exit-ward must be empty.
   * Back (row 1): its column's front cell + front-row cells exit-ward from
   * its column must be empty (via front, then along front). Dispatched cells
   * stay empty (occupancy = undispatched yard-state carts only). Public for bot.
   */
  isBlocked(entry: YardEntry): boolean {
    return this.getBlockers(entry).length > 0;
  }

  /** Carts currently blocking entry's exit path (empty when reachable). Public for bot/debug. */
  getBlockers(entry: YardEntry): YardEntry[] {
    if (entry.dispatched || entry.cart.state !== 'yard') return [];
    const exit = this.yardExit;
    const c = entry.def.col;
    const r = entry.def.row;
    // Front-row cells that must be empty for this entry's path.
    const needFrontCols = new Set<number>();
    if (r === 0) {
      if (exit === 'right') {
        for (let cc = c + 1; cc <= 3; cc++) needFrontCols.add(cc);
      } else {
        for (let cc = c - 1; cc >= 0; cc--) needFrontCols.add(cc);
      }
    } else {
      // Back row: own front cell + front cells exit-ward.
      needFrontCols.add(c);
      if (exit === 'right') {
        for (let cc = c + 1; cc <= 3; cc++) needFrontCols.add(cc);
      } else {
        for (let cc = c - 1; cc >= 0; cc--) needFrontCols.add(cc);
      }
    }
    const out: YardEntry[] = [];
    for (const e of this.yard) {
      if (e === entry) continue;
      if (e.dispatched || e.cart.state !== 'yard') continue;
      if (e.def.row !== 0) continue;
      if (needFrontCols.has(e.def.col)) out.push(e);
    }
    return out;
  }

  /** Next cart the player can dispatch (first REACHABLE, undispatched). */
  private nextDispatchable(): YardEntry | null {
    for (const e of this.yard) {
      if (e.dispatched || e.cart.state !== 'yard') continue;
      if (this.isBlocked(e)) continue;
      return e;
    }
    return null;
  }

  private isTutorialLevel(): boolean {
    return this.levelId === 'level-001' || this.levelId === 'level-002';
  }

  /**
   * Tutorial auto-ring (gold, level-001/002 only). Reused gfx, no allocs.
   */
  private updateTutorialRing(): void {
    const ring = this.tutorialRing;
    if (this.phase !== 'playing' || prefersReducedMotion()) {
      ring.visible = false;
      return;
    }
    if (!this.isTutorialLevel()) {
      ring.visible = false;
      return;
    }
    const next = this.nextDispatchable();
    if (!next) {
      ring.visible = false;
      return;
    }
    this.placeRingOn(next, ring);
  }

  private placeRingOn(entry: YardEntry, which?: Graphics): void {
    const ring = which ?? this.tutorialRing;
    ring.visible = true;
    const pulse = 1 + 0.06 * Math.sin(this.elapsed / 450);
    // Pre-built geometry: pulse via scale/alpha only, reposition via position.
    ring.position.set(entry.cart.position.x, entry.cart.position.y);
    ring.scale.set(pulse, pulse);
    ring.alpha = 0.9;
    // Re-parent on top within the world (no alloc, just z-order).
    this.world.addChild(ring, this.tooltipBg, this.tooltip);
    // Keep blocker flash + tooltip above the ring.
    this.world.addChild(this.blockerFlash, this.tooltipBg, this.tooltip);
  }

  private checkJam(): void {
    if (this.phase !== 'playing') return;
    const frontA = this.queueA[0];
    const frontB = this.queueB[0];
    if (frontA === undefined && frontB === undefined) return;
    // Never fail while a cart is still landing — its color may match.
    if (this.yard.some((e) => e.cart.state === 'toBay')) return;
    const matches = (color: SuitcaseColor): boolean =>
      this.slots.some(
        (s) =>
          s.cart !== null &&
          (s.cart.state === 'bay' || s.cart.state === 'toBay') &&
          s.cart.color === color,
      );
    const hasMatch =
      (frontA !== undefined && matches(frontA)) || (frontB !== undefined && matches(frontB));
    if (hasMatch) return;
    // Spatial yard: any REACHABLE (path-clear) yard cart is a legal move —
    // parking junk is allowed (even when it is a bad move), so a remaining
    // reachable cart always defers the jam. Only jam when nothing path-clear
    // can be parked: bays full, or every remaining yard cart is
    // dispatched/departed/unreachable (unreachable-only remainder = jam).
    const freeBay = this.slots.some((s) => s.cart === null);
    const canDispatch =
      freeBay && this.yard.some((e) => !e.dispatched && e.cart.state === 'yard' && !this.isBlocked(e));
    if (!canDispatch) {
      this.phase = 'lost';
      this.settleInFlight();
      if (this.boardShakeTween) {
        this.boardShakeTween.stop();
        this.boardShakeTween = null;
      }
      this.boardShakeBaseX = this.x;
      this.boardShakeTween = shakeX(this, 12, 380, () => {
        this.boardShakeTween = null;
      });
      const frontNeeds: SuitcaseColor[] = [];
      if (frontA !== undefined) frontNeeds.push(frontA);
      if (frontB !== undefined && frontB !== frontA) frontNeeds.push(frontB);
      const parked: SuitcaseColor[] = [];
      for (const s of this.slots) {
        const c = s.cart;
        if (c && (c.state === 'bay' || c.state === 'toBay')) parked.push(c.color);
      }
      this.hooks.onLose(frontNeeds, parked);
    }
  }

  private win(): void {
    if (this.phase !== 'playing') return;
    this.phase = 'won';
    this.settleInFlight();
    const isBoss = this.levelId === 'level-010';
    burstConfetti(GAME_WIDTH / 2, GAME_HEIGHT / 2 - 120, isBoss ? 90 : 70);
    if (isBoss) {
      burstConfetti(GAME_WIDTH / 2 - 180, GAME_HEIGHT / 2 - 40, 60);
      burstConfetti(GAME_WIDTH / 2 + 180, GAME_HEIGHT / 2 - 40, 60);
      this.showTooltipAt(GAME_WIDTH / 2, GAME_HEIGHT / 2 - 260, 'Fly every bag home!');
    }
    // Stars vs par (par defaults to cart count): 3 / 2 / 1. Best persists.
    const stars = this.moves <= this.parMoves ? 3 : this.moves <= this.parMoves + 2 ? 2 : 1;
    const key = `stars:${this.levelId}`;
    if (stars > load<number>(key, 0)) save(key, stars);
    this.hooks.onWin(this.delivered, this.total, stars, this.moves, this.parMoves);
  }

  /**
   * Stop ALL in-flight tweens deterministically on win/lose and snap to
   * final states so nothing is left mid-motion. Covers dispatch chains,
   * depart chains, bag flights (bags returned to pool), wiggles (restored),
   * combo pops, bay pulses, and shared flashes. No leaks: every map is drained.
   * (Spatial yard has no slide machinery — cells are fixed.)
   */
  private settleInFlight(): void {
    if (this.boardShakeTween) {
      this.boardShakeTween.stop();
      this.boardShakeTween = null;
    }
    this.x = this.boardShakeBaseX;
    this.belt?.killSlides();
    this.beltA?.killSlides();
    this.beltB?.killSlides();
    for (const e of this.yard) {
      if (e.dispatchTween) {
        e.dispatchTween.stop();
        e.dispatchTween = null;
      }
      if (e.cart.state === 'toBay') {
        const slot = this.slots.find((s) => s.cart === e.cart);
        if (slot) e.cart.position.set(slot.x, slot.y);
        e.cart.state = 'bay';
        e.cart.rotation = 0;
      }
    }
    for (const [cart, tween] of this.departTweens) {
      tween.stop();
      this.departTweens.delete(cart);
      if (cart.state === 'departing') this.finishDepart(cart);
    }
    for (const [bag, tween] of this.bagFlights) {
      tween.stop();
      this.bagFlights.delete(bag);
      const origin = this.bagBelts.get(bag);
      this.bagBelts.delete(bag);
      if (origin) origin.releaseBag(bag);
      else if (this.beltA) this.beltA.releaseBag(bag);
      else if (this.belt) this.belt.releaseBag(bag);
      else {
        bag.removeFromParent();
      }
    }
    for (const [cart, tween] of this.wiggleTweens) {
      tween.stop();
      const base = this.wiggleBase.get(cart);
      if (base) {
        cart.position.x = base.x;
        cart.rotation = base.r;
      } else {
        cart.rotation = 0;
      }
      this.wiggleTweens.delete(cart);
      this.wiggleBase.delete(cart);
    }
    for (const [cart, tween] of this.comboTweens) {
      tween.stop();
      cart.scale.set(1, 1);
    }
    this.comboTweens.clear();
    for (const [frame, tween] of this.bayTweens) {
      tween.stop();
      frame.scale.set(1, 1);
      this.bayTweens.delete(frame);
    }
    if (this.bayFlashTween) {
      this.bayFlashTween.stop();
      this.bayFlashTween = null;
    }
    this.bayFlash.visible = false;
    if (this.comboFlashTween) {
      this.comboFlashTween.stop();
      this.comboFlashTween = null;
    }
    this.comboFlash.visible = false;
    if (this.dockRingTween) {
      this.dockRingTween.stop();
      this.dockRingTween = null;
    }
    this.dockRing.visible = false;
    if (this.blockerFlashTween) {
      this.blockerFlashTween.stop();
      this.blockerFlashTween = null;
    }
    this.blockerFlash.visible = false;
    this.traceFx.visible = false;
    this.traceTtl = 0;
  }

  // ------------------------------------------------------------------ views

  private refreshYard(): void {
    const nowBlocked = new Set<string>();
    for (const e of this.yard) {
      if (e.dispatched) continue;
      const blocked = this.isBlocked(e);
      e.cart.setBlocked(blocked);
      // v9: carts always render full color (no dimming).
      e.cart.setDimmed(false);
      if (blocked && e.cart.state === 'yard') nowBlocked.add(e.cart.cartId);
    }
    // Unblock celebration: was blocked, now reachable in the yard.
    for (const e of this.yard) {
      if (e.dispatched || e.cart.state !== 'yard') continue;
      if (this.isBlocked(e)) continue;
      if (this.blockedPrev.has(e.cart.cartId)) {
        popScale(e.cart, 1.15, 350);
        this.unblockBurst(e.cart.position.x, e.cart.position.y);
        playPop(8);
      }
    }
    this.blockedPrev.clear();
    for (const id of nowBlocked) this.blockedPrev.add(id);
    this.redrawBlockedOverlays();
    this.updateTutorialRing();
  }

  /**
   * v9 persistent lock cues (event-driven only — never per-frame): SHORT ink
   * dotted segment (r2.5, gap 18) from EACH blocked cart to its FIRST blocker
   * only + GOLD outlines on blockers (action-here language, never red).
   * Pulsing is alpha-only in update(); geometry is rebuilt here on flow only.
   */
  private redrawBlockedOverlays(): void {
    const paths = this.blockedPaths;
    const tint = this.blockerTint;
    paths.clear();
    tint.clear();
    const blocked = this.yard.filter(
      (e) => !e.dispatched && e.cart.state === 'yard' && this.isBlocked(e),
    );
    if (blocked.length === 0) {
      paths.visible = false;
      tint.visible = false;
      return;
    }
    const dotGap = 18;
    const drawShort = (x1: number, y1: number, x2: number, y2: number): void => {
      const len = Math.hypot(x2 - x1, y2 - y1);
      if (len < 1) return;
      const n = Math.max(2, Math.floor(len / dotGap));
      for (let i = 0; i <= n; i++) {
        const t = i / n;
        const dx = x1 + (x2 - x1) * t;
        const dy = y1 + (y2 - y1) * t;
        paths.circle(dx, dy, 2.5);
      }
    };
    const tinted = new Set<string>();
    for (const e of blocked) {
      const first = this.getBlockers(e)[0];
      if (!first) continue;
      drawShort(e.baseX, e.baseY, first.baseX, first.baseY);
      for (const b of this.getBlockers(e)) {
        const id = b.cart.cartId;
        if (tinted.has(id)) continue;
        tinted.add(id);
        tint.roundRect(b.baseX - 56, b.baseY - 59, 112, 118, 16);
      }
    }
    paths.fill({ color: PASTEL.ink, alpha: 0.85 });
    paths.visible = true;
    if (tinted.size > 0) {
      tint.stroke({ color: PASTEL.gold, width: 4 });
      tint.visible = true;
      tint.alpha = 0.9;
    } else {
      tint.visible = false;
    }
    // Keep paths/outlines below rings + tooltip.
    this.world.addChild(paths, tint);
    this.world.addChild(this.tutorialRing, this.tooltipBg, this.tooltip);
  }

  /**
   * v9 tap-blocked feedback: full exit-path trace (ink dots) for 2.6s with a
   * gold arrow endpoint on the FIRST blocker. No red anywhere in lock
   * language (red stays for invalid-shake only). TTL decay in update().
   */
  private showTraceFor(entry: YardEntry, blockers: YardEntry[]): void {
    const trace = this.traceFx;
    trace.clear();
    const edgeX = this.yardExit === 'right' ? GAME_WIDTH - 32 : 32;
    const frontY = this.yardBaseY;
    const dir = this.yardExit === 'right' ? 1 : -1;
    const dotGap = 14;
    const drawDotted = (x1: number, y1: number, x2: number, y2: number): void => {
      const len = Math.hypot(x2 - x1, y2 - y1);
      if (len < 1) return;
      const n = Math.max(2, Math.floor(len / dotGap));
      for (let i = 0; i <= n; i++) {
        const t = i / n;
        trace.circle(x1 + (x2 - x1) * t, y1 + (y2 - y1) * t, 3);
      }
    };
    const sx = entry.baseX;
    const sy = entry.baseY;
    if (entry.def.row === 0) {
      drawDotted(sx + dir * 56, sy, edgeX, frontY);
    } else {
      drawDotted(sx, sy - 59, sx, frontY);
      drawDotted(sx + dir * 56, frontY, edgeX, frontY);
    }
    trace.fill({ color: PASTEL.ink, alpha: 0.9 });
    trace.visible = true;
    // Gold arrow endpoint on the FIRST blocker (reuses the pooled flash
    // layer as a gold marker — never red in v9 lock language).
    const flash = this.blockerFlash;
    if (this.blockerFlashTween) {
      this.blockerFlashTween.stop();
      this.blockerFlashTween = null;
    }
    flash.clear();
    flash.alpha = 1;
    const first = blockers[0];
    if (first) {
      const bx = first.baseX;
      const by = first.baseY;
      flash.moveTo(bx + dir * 24, by);
      flash.lineTo(bx + dir * 6, by - 12);
      flash.lineTo(bx + dir * 6, by + 12);
      flash.closePath();
      flash.fill({ color: PASTEL.gold, alpha: 0.95 });
      flash.visible = true;
    } else {
      flash.visible = false;
    }
    this.traceTtl = 2600;
    this.world.addChild(trace, flash);
    this.world.addChild(this.tutorialRing, this.tooltipBg, this.tooltip);
  }

  /** Gold ring burst for newly-unblocked carts (dockBurst-style, yard pos). */
  private unblockBurst(x: number, y: number): void {
    if (prefersReducedMotion()) return;
    burstConfetti(x, y - 40, 12);
    const ring = this.dockRing;
    if (this.dockRingTween) {
      this.dockRingTween.stop();
      this.dockRingTween = null;
    }
    ring.removeFromParent();
    this.world.addChild(ring);
    this.world.addChild(this.tutorialRing, this.tooltipBg, this.tooltip);
    ring.clear();
    ring.circle(0, 0, 46);
    ring.stroke({ color: 0xf59e0b, width: 5, alpha: 0.9 });
    ring.position.set(x, y);
    ring.scale.set(0.6, 0.6);
    ring.visible = true;
    ring.alpha = 0.9;
    const proxy = { s: 0.6, a: 0.9 };
    this.dockRingTween = new Tween(proxy, fxGroup)
      .to({ s: 1.4, a: 0 }, 600)
      .easing(Easing.Quadratic.Out)
      .onUpdate(() => {
        ring.scale.set(proxy.s, proxy.s);
        ring.alpha = proxy.a;
      })
      .onComplete(() => {
        ring.visible = false;
        this.dockRingTween = null;
      })
      .start();
  }

  /** Restart counter for tuning (call from Game when a level reloads). */
  trackRestart(): void {
    const k = `restarts:${this.levelId || 'unknown'}`;
    save(k, load<number>(k, 0) + 1);
  }

  private emitHud(): void {
    // DOCK-COUNTED HUD: only docked (state 'bay') carts count as used.
    // In-flight ('toBay') slots stay reserved for logic/jam but show only via
    // the targeted-bay pulse — the number ticks up on dock (tSettle calls
    // emitHud again). Logic (slot.cart reservation, jam) is untouched.
    const used = this.slots.filter((s) => s.cart?.state === 'bay').length;
    const remainingA: Record<SuitcaseColor, number> = { red: 0, blue: 0, green: 0, yellow: 0 };
    const remainingB: Record<SuitcaseColor, number> = { red: 0, blue: 0, green: 0, yellow: 0 };
    for (const c of this.queueA) remainingA[c] += 1;
    for (const c of this.queueB) remainingB[c] += 1;
    this.hooks.onHud(this.delivered, this.total, used, this.slots.length, remainingA, remainingB);
  }

  // ---------------------------------------------------------- tutorial + tooltip

  /** Floating tooltip above a cart (reused Text, no allocs). */
  private showTooltip(anchor: Cart, message: string): void {
    this.showTooltipAt(anchor.position.x, anchor.position.y - 96, message);
  }

  private showTooltipAt(x: number, y: number, message: string, ttlMs = 2600): void {
    const cx = Math.max(140, Math.min(GAME_WIDTH - 140, x));
    this.tooltip.text = message;
    this.tooltip.position.set(cx, y);
    this.tooltip.visible = true;
    // Dark pill behind text (ink 0.9, 12px radius), sized to the text.
    const bg = this.tooltipBg;
    bg.clear();
    const w = this.tooltip.width + 32;
    const h = this.tooltip.height + 18;
    bg.roundRect(cx - w / 2, y - h / 2, w, h, 12);
    bg.fill({ color: 0x1e293b, alpha: 0.9 });
    bg.visible = true;
    this.tooltipTtl = ttlMs;
    this.world.addChild(bg, this.tooltip);
  }

  private makeLabel(text: string, size = 21): Text {
    const t = new Text({
      text,
      style: { fill: PASTEL.muted, fontSize: size, fontFamily: 'system-ui, sans-serif' },
    });
    t.anchor.set(0.5, 0.5);
    return t;
  }

  /** Paint once — pastel terminal + header band (no runway dashes, no floor strike). */
  private drawBackdrop(): void {
    const g = this.backdrop;
    g.clear();
    g.rect(0, 0, GAME_WIDTH, GAME_HEIGHT);
    g.fill({ color: BACKGROUND_COLOR });
    // Header band.
    g.roundRect(16, 8, GAME_WIDTH - 32, 196, 24);
    g.fill({ color: PASTEL.band });
    g.roundRect(16, 8, GAME_WIDTH - 32, 196, 24);
    g.stroke({ color: PASTEL.bandEdge, width: 3 });
    // Floor separation rule at y=664 — clears single + dual labels (zero text struck).
    g.rect(0, 664, GAME_WIDTH, 4);
    g.fill({ color: PASTEL.bandEdge });
  }

  /** Centered dashed slot (drawn about origin) so scale punches stay centered. */
  private drawDashedSlotCentered(g: Graphics, w: number, h: number): void {
    this.drawDashedSlot(g, -w / 2, -h / 2, w, h);
  }

  /**
   * Lot geometry spec (2 rows × 4 cols, 8 cells max):
   * - Row 0 = front (exit row, bays side), row 1 = back. Col 0..3 left→right.
   * - Exit on the left OR right edge at the front row (level.exit, default right).
   * - Cell centers: x = 40 + cellW/2 + col*cellW (cellW 160 → 120/280/440/600),
   *   y = frontY + row*rowPitch (rowPitch 150). Front row at yardTop+64.
   * - Dispatch gate: front needs same-row exit-ward cells empty; back needs
   *   its front cell + front exit-ward cells empty. Dispatched cells stay empty.
   */
  private cellCenter(row: 0 | 1, col: number, frontY: number): { x: number; y: number } {
    const x = 40 + YARD.cellW / 2 + col * YARD.cellW;
    const y = frontY + row * YARD.rowPitch;
    return { x, y };
  }

  /** Build the visible lot: panel + 8 dashed cells + exit chevrons. */
  private buildYardLot(yardTop: number, frontY: number): void {
    const lot = new Graphics();
    const backY = frontY + YARD.rowPitch;
    // Panel behind the 8 cells (single rounded rect, pastel band tint).
    const panelX = 16;
    const panelW = GAME_WIDTH - 32;
    const panelTop = frontY - 95;
    const panelBottom = backY + 95;
    lot.roundRect(panelX, panelTop, panelW, panelBottom - panelTop, 20);
    lot.fill({ color: 0xeef3fb, alpha: 1 });
    lot.roundRect(panelX, panelTop, panelW, panelBottom - panelTop, 20);
    lot.stroke({ color: PASTEL.bandEdge, width: 3 });
    this.world.addChild(lot);
    // 8 dashed cells (fixed, never compact).
    for (let r = 0; r < YARD.rows; r++) {
      for (let c = 0; c < YARD.cols; c++) {
        const { x, y } = this.cellCenter(r as 0 | 1, c, frontY);
        const cell = new Graphics();
        this.drawDashedSlotCentered(cell, YARD.cellW - 18, 132);
        cell.position.set(x, y);
        cell.alpha = 0.9;
        this.world.addChild(cell);
      }
    }
    // Exit arrow (chevrons) on the exit edge at the front row (inset 10px).
    const exitGfx = new Graphics();
    const edgeX = this.yardExit === 'right' ? GAME_WIDTH - 32 : 32;
    const dir = this.yardExit === 'right' ? 1 : -1;
    for (let k = 0; k < 2; k++) {
      const cx = edgeX - dir * k * 18;
      exitGfx.moveTo(cx - dir * 10, frontY - 22);
      exitGfx.lineTo(cx + dir * 6, frontY);
      exitGfx.lineTo(cx - dir * 10, frontY + 22);
    }
    exitGfx.stroke({ color: 0x16a34a, width: 7, alpha: 0.95 });
    this.world.addChild(exitGfx);
    // Small EXIT tag above the chevrons (rebuilt per level, pooled per level).
    if (this.yardExitLabel) {
      this.yardExitLabel.removeFromParent();
      this.yardExitLabel.destroy();
      this.yardExitLabel = null;
    }
    const tag = new Text({
      text: this.yardExit === 'right' ? 'EXIT ▶' : '◀ EXIT',
      style: { fill: 0x16a34a, fontSize: 20, fontWeight: '800', fontFamily: 'system-ui, sans-serif' },
    });
    tag.anchor.set(0.5, 0.5);
    tag.position.set(this.yardExit === 'right' ? GAME_WIDTH - 52 : 52, frontY - 52);
    this.world.addChild(tag);
    this.yardExitLabel = tag;
    // Yard zone label sits above the panel (already added by caller).
    void yardTop;
  }

  /** v9: red blocker flash deleted — tap-blocked uses showTraceFor (ink + gold). */

  private drawDashedSlot(g: Graphics, x: number, y: number, w: number, h: number): void {
    g.clear();
    const dash = 12;
    const gap = 8;
    const r = 18;
    // Approximate a dashed rounded rect with dashed straight edges.
    const segs: Array<[number, number, number, number]> = [
      [x + r, y, x + w - r, y],
      [x + r, y + h, x + w - r, y + h],
      [x, y + r, x, y + h - r],
      [x + w, y + r, x + w, y + h - r],
    ];
    for (const [x1, y1, x2, y2] of segs) {
      const len = Math.hypot(x2 - x1, y2 - y1);
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
    g.stroke({ color: PASTEL.muted, width: 4, alpha: 0.8 });
  }
}
