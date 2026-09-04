/**
 * Global game configuration + shared type re-exports.
 * Pastel airport theme, portrait 720x1280 FIT, DPR capped.
 */
import type {
  SuitcaseColor as SuitcaseColorType,
  LevelDef as LevelDefType,
  GameState as GameStateType,
  CartDef as CartDefType,
} from '../game/types.ts';

// Re-export so config.ts also "defines" the required domain types.
export type SuitcaseColor = SuitcaseColorType;
export type LevelDef = LevelDefType;
export type GameState = GameStateType;
export type CartDef = CartDefType;

/** Logical canvas size — portrait 720x1280, FIT scaled via CSS. */
export const GAME_WIDTH = 720;
export const GAME_HEIGHT = 1280;

/** Pastel airport terminal background (pale sky). */
export const BACKGROUND_COLOR = 0xdfe8f5;

/** Pastel UI palette. */
export const PASTEL = {
  card: 0xffffff,
  ink: 0x1e293b,
  muted: 0x64748b,
  band: 0xc9dcf3,
  bandEdge: 0xa9c2e4,
  track: 0x42506b,
  trackInner: 0x2e3a52,
  rail: 0x9fb3cc,
  gold: 0xf59e0b,
  pipEmpty: 0xe2e8f0,
} as const;

/** Belt (conveyor) layout — top of screen, shows next 6 in queue order. */
export const BELT = {
  x: 40,
  y: 220,
  width: GAME_WIDTH - 80,
  height: 150,
  visible: 6,
  slotW: 80,
  gap: 8,
} as const;

/** Dual-belt layout (720x1280, touch targets ≥44px, nothing shrunk below).
 *  Single-belt levels keep BELT/BAYS/YARD spacing above unchanged.
 *  Dual levels: BeltA y210 h115 showing 4, BeltB y335 h115 showing 4;
 *  BAYS y→505, YARD y→775, footer stays bottom (GAME_HEIGHT-64). */
export const BELT_A = {
  x: 40,
  y: 210,
  width: GAME_WIDTH - 80,
  height: 115,
  visible: 4,
  slotW: 80,
  gap: 8,
} as const;

export const BELT_B = {
  x: 40,
  y: 335,
  width: GAME_WIDTH - 80,
  height: 115,
  visible: 4,
  slotW: 80,
  gap: 8,
} as const;

/** Dual-level bay/yard tops (slotW/slotH/gap/max + pitch unchanged). */
export const BAYS_DUAL_Y = 505;
export const YARD_DUAL_Y = 775;

/** Bay slots layout — middle row where carts park. */
export const BAYS = {
  y: 460,
  slotW: 150,
  slotH: 130,
  gap: 18,
  max: 4,
} as const;

/** Yard layout — visible spatial parking lot (2 rows × 4 cols, 8 cells max).
 *  Row 0 = front (exit row, bays side, smaller y), row 1 = back (larger y).
 *  Col 0..3 left→right. Exit on the left OR right edge at the front row.
 *  Cell geometry: 640px usable (40px side margins), 4 cols → cellW 160;
 *  rowPitch 150 fits CART_H 118 with padding; front row at yardTop+64. */
export const YARD = {
  y: 740,
  pitch: 116,
  cols: 4,
  rows: 2,
  cellW: 160,
  cellH: 150,
  rowPitch: 150,
  frontYOffset: 64,
} as const;

/** Auto-load cadence: one bag per cart per interval while colors match.
 *  Slow (1100ms) — bags flow one at a time, each hop fully readable. */
export const LOAD_MS = 1100;

/** Motion/flow version tag shown in the footer so playtesters can confirm
 *  they run the latest animation build (busts stale-cache confusion). */
export const FLOW_V = 10;

/** All suitcase colors in stable order. */
export const SUITCASE_COLORS: SuitcaseColor[] = ['red', 'blue', 'green', 'yellow'];

/** Display hex per suitcase color. */
export const SUITCASE_HEX: Record<SuitcaseColor, number> = {
  red: 0xef4444,
  blue: 0x3b82f6,
  green: 0x22c55e,
  yellow: 0xeab308,
};

/** Emoji tag per suitcase color (shown on bags + carts). */
export const SUITCASE_EMOJI: Record<SuitcaseColor, string> = {
  red: '🔴',
  blue: '🔵',
  green: '🟢',
  yellow: '🟡',
};

/** Colorblind-safe shape per color (drawn on luggage body + cart stripe). */
export const SUITCASE_SHAPE: Record<SuitcaseColor, string> = {
  red: '●',
  blue: '▲',
  green: '■',
  yellow: '★',
};

/** Single-letter label per color (front bag + cart). */
export const SUITCASE_LETTER: Record<SuitcaseColor, string> = {
  red: 'R',
  blue: 'B',
  green: 'G',
  yellow: 'Y',
};

/** Stripe count per color (redundant tactile cue: 1-4 bars). */
export const SUITCASE_STRIPES: Record<SuitcaseColor, number> = {
  red: 1,
  blue: 2,
  green: 3,
  yellow: 4,
};

/** Confetti particle colors (win burst). */
export const CONFETTI_COLORS: number[] = [0xef4444, 0x3b82f6, 0x22c55e, 0xeab308, 0xf59e0b, 0xec4899];

/** Max device pixel ratio — capped for perf. */
export const MAX_DPR = 2;
