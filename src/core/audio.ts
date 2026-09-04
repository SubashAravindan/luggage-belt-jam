/**
 * Audio — Howler unlock wrapper + tiny synthesized SFX (no assets needed).
 * pop pitch rises with the load combo; depart/win/fail are short blips.
 * Everything is guarded: audio is non-critical, never throws.
 * Voice-capped (max 4 concurrent) to stay ASMR-light on mobile.
 */
import { Howl, Howler } from 'howler';

let unlocked = false;
let unlockAttached = false;
let muted = false;

/** Max concurrent synth voices (ASMR cap). */
const MAX_VOICES = 4;
let activeVoices = 0;

// Placeholder silent instance map (real sfx added in later milestones).
const sounds = new Map<string, Howl>();

/** Resume WebAudio on first pointer/key gesture. Idempotent. */
export function unlockAudio(): void {
  if (unlocked) return;
  unlocked = true;
  try {
    // Create + resume the synth context INSIDE the user gesture so mobile
    // autoplay policies allow it (never lazily on first blip).
    ensureSynthContext(true);
    const ctx = Howler.ctx;
    if (ctx && ctx.state === 'suspended') {
      void ctx.resume();
    }
    if (synthCtx && synthCtx.state === 'suspended') {
      void synthCtx.resume();
    }
  } catch {
    // ignore — audio is non-critical for scaffold
  }
}

/**
 * Attach one-time pointerdown/keydown listeners that unlock audio.
 * Call once from main.ts. Returns a cleanup function.
 */
export function unlockAudioOnFirstPointer(): () => void {
  if (unlockAttached) return () => undefined;
  unlockAttached = true;

  const handler = (): void => {
    unlockAudio();
  };
  window.addEventListener('pointerdown', handler, { once: true, passive: true });
  window.addEventListener('keydown', handler, { once: true });

  return () => {
    window.removeEventListener('pointerdown', handler);
    window.removeEventListener('keydown', handler);
  };
}

/** Mute / unmute all. */
export function setMuted(m: boolean): void {
  muted = m;
  try {
    Howler.mute(m);
  } catch {
    // ignore
  }
}

/** Current mute state. */
export function isMuted(): boolean {
  return muted;
}

/** Whether audio was unlocked by a user gesture. */
export function isAudioUnlocked(): boolean {
  return unlocked;
}

/** Get (or lazily note) registered sound count — scaffold helper. */
export function soundCount(): number {
  return sounds.size;
}

// ---------------------------------------------------------------------------
// Synthesized placeholder SFX (WebAudio oscillators, no assets).
// ---------------------------------------------------------------------------

let synthCtx: AudioContext | null = null;

/** Create/resume the shared synth context. When fromGesture, force creation. */
function ensureSynthContext(fromGesture = false): AudioContext | null {
  try {
    if (!synthCtx) {
      if (!fromGesture && !unlocked) return null;
      const AC =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AC) return null;
      synthCtx = new AC();
    }
    if (synthCtx.state === 'suspended') {
      void synthCtx.resume();
    }
    return synthCtx;
  } catch {
    return null;
  }
}

function ctx(): AudioContext | null {
  // After unlock the context already exists; otherwise only resume, never
  // create on a bare blip (autoplay policy). Pre-unlock blips stay silent.
  if (!unlocked || !synthCtx) return null;
  try {
    if (synthCtx.state === 'suspended') {
      void synthCtx.resume();
    }
    return synthCtx;
  } catch {
    return null;
  }
}

function blip(freq: number, durMs: number, type: OscillatorType, vol: number, whenMs = 0): void {
  if (muted) return;
  if (activeVoices >= MAX_VOICES) return; // cap concurrent voices
  const ac = ctx();
  if (!ac) return;
  try {
    activeVoices += 1;
    const t0 = ac.currentTime + whenMs / 1000;
    const osc = ac.createOscillator();
    const gain = ac.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(Math.max(vol, 0.0002), t0 + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + durMs / 1000);
    osc.connect(gain);
    gain.connect(ac.destination);
    osc.start(t0);
    osc.stop(t0 + durMs / 1000 + 0.05);
    // Single-release guard: onended + safety timeout must not double-free.
    let released = false;
    let timer = 0;
    const release = (): void => {
      if (released) return;
      released = true;
      activeVoices = Math.max(0, activeVoices - 1);
    };
    osc.onended = () => {
      release();
      window.clearTimeout(timer);
      osc.disconnect();
      gain.disconnect();
    };
    // Safety: release the voice slot even if onended never fires.
    timer = window.setTimeout(release, durMs + whenMs + 120);
  } catch {
    activeVoices = Math.max(0, activeVoices - 1);
    // ignore — audio is non-critical
  }
}

/** Load tick — pitch rises with the consecutive-load combo (placeholder). */
export function playPop(combo = 0): void {
  const step = Math.min(Math.max(combo, 0), 12);
  const freq = 440 * Math.pow(2, step / 12);
  blip(freq, 90, 'triangle', 0.12);
}

/** Cart departs full — quick upward whoosh (placeholder). */
export function playDepart(): void {
  blip(520, 120, 'sine', 0.1);
  blip(780, 140, 'sine', 0.1, 90);
}

/** Win jingle — tiny rising arpeggio (placeholder). */
export function playWin(): void {
  blip(523, 140, 'triangle', 0.12);
  blip(659, 140, 'triangle', 0.12, 120);
  blip(784, 200, 'triangle', 0.12, 240);
}

/** Fail buzz — low double-thud (placeholder). */
export function playFail(): void {
  blip(160, 180, 'sawtooth', 0.08);
  blip(120, 240, 'sawtooth', 0.08, 150);
}
