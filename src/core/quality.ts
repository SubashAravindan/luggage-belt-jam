/**
 * Quality helpers — DPR capping + low-end detection.
 * No allocations; pure functions.
 */
import { MAX_DPR } from '../app/config.ts';

/** Capped device pixel ratio: min(devicePixelRatio, MAX_DPR). */
export function getCappedDPR(): number {
  const raw = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
  return Math.min(raw, MAX_DPR);
}

/** Very rough low-end heuristic for future quality scaling. */
export function isLowEndDevice(): boolean {
  if (typeof navigator === 'undefined') return false;
  const cores = navigator.hardwareConcurrency ?? 4;
  const mem = (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 4;
  return cores <= 4 && mem <= 4;
}

/** Effective DPR: 1 on low-end, capped otherwise. Pure, no allocs. */
export function getEffectiveDPR(): number {
  if (isLowEndDevice()) return 1;
  return getCappedDPR();
}

/**
 * Tiny FPS watcher: call per ticker frame with dtMs. After 60 consecutive
 * frames below 40fps it invokes onDegrade once and latches (one-shot) until
 * reset() is called. No allocs.
 */
export class FpsWatcher {
  private lowFrames = 0;
  private degraded = false;

  /** Returns true on the frame that trips degradation. */
  update(dtMs: number): boolean {
    if (this.degraded) return false;
    const fps = dtMs > 0 ? 1000 / dtMs : 60;
    if (fps < 40) this.lowFrames += 1;
    else this.lowFrames = 0;
    if (this.lowFrames >= 60) {
      this.degraded = true;
      this.lowFrames = 0;
      return true;
    }
    return false;
  }

  /** Reset (e.g. on level load). */
  reset(): void {
    this.lowFrames = 0;
    this.degraded = false;
  }
}
