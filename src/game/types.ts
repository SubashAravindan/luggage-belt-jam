/**
 * Canonical game types for Luggage Belt Jam.
 * Single source of truth — re-exported by app/config and levels/schema.
 */

/** Playable suitcase colors. */
export type SuitcaseColor = 'red' | 'blue' | 'green' | 'yellow';

/** A cart (trolley) waiting in the spatial yard lot. */
export interface CartDef {
  id: string;
  color: SuitcaseColor;
  capacity: number;
  /** Lot row: 0 = front (exit row, bays side), 1 = back. */
  row: 0 | 1;
  /** Lot column: 0..3 left→right. */
  col: 0 | 1 | 2 | 3;
}

/** Full level definition. */
export interface LevelDef {
  id: string;
  /** Colors active in this level. */
  colors: SuitcaseColor[];
  /** Carts to fill. */
  carts: CartDef[];
  /** Departures belt queue (FIFO). Single-belt levels use only this. */
  queueA: SuitcaseColor[];
  /** Arrivals belt queue (FIFO, optional — absent/empty = single-belt level). */
  queueB?: SuitcaseColor[];
  /** Legacy single queue (deprecated — use queueA/queueB; loader falls back if present). */
  spawnQueue?: SuitcaseColor[];
  /** Number of belt bays (slots). */
  bays: number;
  /** Yard lot exit edge at the front row: 'left' | 'right' (default 'right'). */
  exit?: 'left' | 'right';
  /** Optional teaching hint shown under the HUD. */
  hint?: string;
  /** Optimal dispatch count — stars: moves<=par ? 3 : moves<=par+2 ? 2 : 1. */
  parMoves?: number;
  /** Designer note: intended solution + the greedy trap (never shown in-game). */
  design?: string;
}

/** High-level game phase. */
export type GamePhase = 'boot' | 'playing' | 'won' | 'lost';

/** Runtime lifecycle of a cart instance. */
export type CartRuntime = 'yard' | 'toBay' | 'bay' | 'departing' | 'departed';

/** Minimal mutable game state (no game logic yet — scaffold). */
export interface GameState {
  levelIndex: number;
  level: LevelDef | null;
  phase: GamePhase;
  moves: number;
}

/** Create an initial empty state. */
export function createInitialState(): GameState {
  return {
    levelIndex: 0,
    level: null,
    phase: 'boot',
    moves: 0,
  };
}
