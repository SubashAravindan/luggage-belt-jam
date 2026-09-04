/**
 * Effects — central Tween group tick, scale-pop + shake helpers,
 * and a pooled confetti burst (no per-frame allocations).
 */
import { Container, Graphics } from 'pixi.js';
import { Easing, Group, Tween } from '@tweenjs/tween.js';
import { CONFETTI_COLORS } from '../app/config.ts';

/** Shared tween group for all gameplay tweens. */
export const fxGroup = new Group();

/** Advance all tweens + confetti. Pass ticker delta MS. */
export function updateEffects(dtMs = 16.7): void {
  fxGroup.update();
  updateConfetti(dtMs);
}

/** Clear all running effects (level transitions). */
export function clearEffects(): void {
  fxGroup.removeAll();
  hideConfetti();
}

/** Punch-scale a target out and back (juice on load). Event-driven. */
export function popScale(target: Container, peak = 1.25, ms = 200): void {
  if (prefersReducedMotion()) {
    target.scale.set(1);
    return;
  }
  target.scale.set(peak);
  new Tween(target.scale, fxGroup)
    .to({ x: 1, y: 1 }, ms)
    .easing(Easing.Back.Out)
    .start();
}

/** Whether the user prefers reduced motion (skip shake/confetti). */
export function prefersReducedMotion(): boolean {
  try {
    return (
      typeof window !== 'undefined' &&
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches
    );
  } catch {
    return false;
  }
}

/** Guarded haptic tap (Android Chrome). No-op where unsupported. */
export function vibrate(ms = 10): void {
  try {
    if (prefersReducedMotion()) return;
    const nav = navigator as Navigator & { vibrate?: (p: number) => boolean };
    if (typeof nav.vibrate === 'function') nav.vibrate(ms);
  } catch {
    // ignore — haptics are non-critical
  }
}

/** Horizontal shake that restores the base x. Juice on invalid tap / fail. */
export function shakeX(
  target: Container,
  magnitude = 10,
  ms = 320,
  onDone?: () => void,
): Tween | null {
  if (prefersReducedMotion()) return null;
  const baseX = target.x;
  const proxy = { t: 0 };
  const tween = new Tween(proxy, fxGroup)
    .to({ t: 1 }, ms)
    .easing(Easing.Quadratic.Out)
    .onUpdate(() => {
      const p = proxy.t;
      target.x = baseX + magnitude * (1 - p) * Math.sin(p * Math.PI * 6);
    })
    .onComplete(() => {
      target.x = baseX;
      onDone?.();
    })
    .start();
  return tween;
}

/**
 * Invalid-tap wiggle: 300ms keyframed x (-6/+6/-3/0) + ±3deg rotation.
 * Re-tappable: caller must stop any prior wiggle for the target first.
 * Returns the tween so callers can track/kill it (no leak).
 */
export function wiggleInvalid(target: Container, onDone?: () => void): Tween {
  const baseX = target.x;
  const baseR = target.rotation;
  const proxy = { t: 0 };
  const tween = new Tween(proxy, fxGroup)
    .to({ t: 1 }, 300)
    .easing(Easing.Linear.None)
    .onUpdate(() => {
      const p = proxy.t;
      // Piecewise x keyframes: 0 -> -6 (0.25) -> +6 (0.5) -> -3 (0.75) -> 0 (1).
      let dx: number;
      if (p < 0.25) dx = -6 * (p / 0.25);
      else if (p < 0.5) dx = -6 + 12 * ((p - 0.25) / 0.25);
      else if (p < 0.75) dx = 6 - 9 * ((p - 0.5) / 0.25);
      else dx = -3 + 3 * ((p - 0.75) / 0.25);
      target.x = baseX + dx;
      target.rotation = baseR + (3 * (Math.PI / 180)) * Math.sin(p * Math.PI * 2);
    })
    .onComplete(() => {
      target.x = baseX;
      target.rotation = baseR;
      onDone?.();
    })
    .start();
  return tween;
}

/**
 * Combo pop, slow and celebratory: 350ms Back-Out to 1.25x, then 250ms back.
 * Returns the tween chain head so callers can track/kill it.
 */
export function comboPop(target: Container, onDone?: () => void): Tween {
  target.scale.set(1);
  const proxy = { s: 1 };
  const back = new Tween(proxy, fxGroup)
    .to({ s: 1 }, 250)
    .easing(Easing.Quadratic.Out)
    .onUpdate(() => {
      target.scale.set(proxy.s, proxy.s);
    })
    .onComplete(() => {
      target.scale.set(1, 1);
      onDone?.();
    });
  const out = new Tween(proxy, fxGroup)
    .to({ s: 1.25 }, 350)
    .easing(Easing.Back.Out)
    .onUpdate(() => {
      target.scale.set(proxy.s, proxy.s);
    })
    .chain(back)
    .start();
  return out;
}

/**
 * Generic alpha flash: fade a target from peak alpha to 0 over ms.
 * Caller positions/shows the target first. Returns the tween.
 */
export function flashFade(target: Container, peakAlpha: number, ms: number, onDone?: () => void): Tween {
  const proxy = { a: peakAlpha };
  target.alpha = peakAlpha;
  const tween = new Tween(proxy, fxGroup)
    .to({ a: 0 }, ms)
    .easing(Easing.Quadratic.Out)
    .onUpdate(() => {
      target.alpha = proxy.a;
    })
    .onComplete(() => {
      target.visible = false;
      target.alpha = 0;
      onDone?.();
    })
    .start();
  return tween;
}

// ---------------------------------------------------------------------------
// Pooled confetti burst.
// ---------------------------------------------------------------------------

const MAX_PARTICLES = 90;

/** Particle budget scale (0.5 on low-end / FPS-drop). No per-frame alloc. */
let particleScale = 1;

/** Set the confetti budget multiplier (0..1). */
export function setParticleScale(s: number): void {
  particleScale = Math.max(0.25, Math.min(1, s));
}

/** Current particle budget multiplier. */
export function getParticleScale(): number {
  return particleScale;
}

interface Particle {
  gfx: Graphics;
  vx: number;
  vy: number;
  vr: number;
  life: number;
  maxLife: number;
  active: boolean;
}

let confettiLayer: Container | null = null;
const particles: Particle[] = [];

function rand(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

/** Create the pooled layer once (call from Board construction). */
export function initConfetti(parent: Container): void {
  if (confettiLayer) return;
  confettiLayer = new Container();
  for (let i = 0; i < MAX_PARTICLES; i++) {
    const gfx = new Graphics();
    gfx.visible = false;
    confettiLayer.addChild(gfx);
    particles.push({ gfx, vx: 0, vy: 0, vr: 0, life: 0, maxLife: 1, active: false });
  }
  parent.addChild(confettiLayer);
}

/** Fire a confetti burst at (x, y) using pooled particles. */
export function burstConfetti(x: number, y: number, count = 70): void {
  if (!confettiLayer) return;
  if (prefersReducedMotion()) return;
  const budget = Math.max(1, Math.round(count * particleScale));
  let fired = 0;
  for (const p of particles) {
    if (fired >= budget) break;
    if (p.active) continue;
    const color = CONFETTI_COLORS[fired % CONFETTI_COLORS.length] ?? 0xffffff;
    p.gfx.clear();
    p.gfx.rect(-5, -3, 10, 6);
    p.gfx.fill({ color });
    p.gfx.position.set(x + rand(-20, 20), y + rand(-10, 10));
    p.gfx.rotation = rand(0, Math.PI * 2);
    p.gfx.visible = true;
    p.gfx.alpha = 1;
    const angle = rand(-Math.PI, 0);
    const speed = rand(180, 520);
    p.vx = Math.cos(angle) * speed;
    p.vy = Math.sin(angle) * speed - 120;
    p.vr = rand(-9, 9);
    p.maxLife = rand(0.9, 1.6);
    p.life = p.maxLife;
    p.active = true;
    fired++;
  }
}

function updateConfetti(dtMs: number): void {
  const dt = Math.min(dtMs, 50) / 1000;
  if (dt <= 0) return;
  for (const p of particles) {
    if (!p.active) continue;
    p.life -= dt;
    if (p.life <= 0) {
      p.active = false;
      p.gfx.visible = false;
      continue;
    }
    p.vy += 900 * dt;
    p.vx *= 1 - 0.6 * dt;
    p.gfx.position.x += p.vx * dt;
    p.gfx.position.y += p.vy * dt;
    p.gfx.rotation += p.vr * dt;
    p.gfx.alpha = Math.min(1, p.life / (p.maxLife * 0.5));
  }
}

function hideConfetti(): void {
  for (const p of particles) {
    p.active = false;
    p.gfx.visible = false;
  }
}
