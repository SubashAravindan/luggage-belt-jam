/**
 * Level schema + runtime validation.
 * Re-exports domain types so schema.ts also defines them.
 */
import type {
  SuitcaseColor as SuitcaseColorType,
  LevelDef as LevelDefType,
  GameState as GameStateType,
  CartDef as CartDefType,
} from '../game/types.ts';

export type SuitcaseColor = SuitcaseColorType;
export type LevelDef = LevelDefType;
export type GameState = GameStateType;
export type CartDef = CartDefType;

import { SUITCASE_COLORS } from '../app/config.ts';

const COLOR_SET: ReadonlySet<string> = new Set<string>(SUITCASE_COLORS);

/** Type guard for SuitcaseColor. */
export function isSuitcaseColor(v: unknown): v is SuitcaseColor {
  return typeof v === 'string' && COLOR_SET.has(v);
}

/** Type guard for LevelDef. Returns false instead of throwing. */
export function isLevelDef(v: unknown): v is LevelDef {
  if (typeof v !== 'object' || v === null) return false;
  const o = v as Record<string, unknown>;
  if (typeof o['id'] !== 'string') return false;
  if (!Array.isArray(o['colors']) || !Array.isArray(o['carts'])) return false;
  if (typeof o['bays'] !== 'number') return false;
  if (o['hint'] !== undefined && typeof o['hint'] !== 'string') return false;
  if (o['parMoves'] !== undefined && typeof o['parMoves'] !== 'number') return false;
  if (o['design'] !== undefined && typeof o['design'] !== 'string') return false;

  const colors = o['colors'] as unknown[];
  if (!colors.every(isSuitcaseColor)) return false;

  // Dual belts: queueA required (or legacy spawnQueue), queueB optional.
  // Absent/empty queueB = single-belt level.
  const hasA = Array.isArray(o['queueA']);
  const hasLegacy = Array.isArray(o['spawnQueue']);
  if (!hasA && !hasLegacy) return false;
  if (hasA) {
    const qa = o['queueA'] as unknown[];
    if (!qa.every(isSuitcaseColor)) return false;
  }
  if (hasLegacy) {
    const q = o['spawnQueue'] as unknown[];
    if (!q.every(isSuitcaseColor)) return false;
  }
  if (o['queueB'] !== undefined) {
    if (!Array.isArray(o['queueB'])) return false;
    const qb = o['queueB'] as unknown[];
    if (!qb.every(isSuitcaseColor)) return false;
  }

  const carts = o['carts'] as unknown[];
  for (const c of carts) {
    if (typeof c !== 'object' || c === null) return false;
    const cd = c as Record<string, unknown>;
    if (typeof cd['id'] !== 'string') return false;
    if (!isSuitcaseColor(cd['color'])) return false;
    if (typeof cd['capacity'] !== 'number') return false;
    // Spatial yard: row 0|1 + col 0..3 required per cart; legacy blockedBy rejected.
    if ('blockedBy' in cd) return false;
    if (cd['row'] !== 0 && cd['row'] !== 1) return false;
    if (typeof cd['col'] !== 'number' || !Number.isInteger(cd['col']) || (cd['col'] as number) < 0 || (cd['col'] as number) > 3) return false;
  }
  if (o['exit'] !== undefined && o['exit'] !== 'left' && o['exit'] !== 'right') return false;
  // Yard occupancy: at most one cart per (row, col) cell, max 8 (2 rows × 4 cols).
  const seen = new Set<string>();
  for (const c of carts) {
    const cd = c as Record<string, unknown>;
    const key = `${String(cd['row'])}:${String(cd['col'])}`;
    if (seen.has(key)) return false;
    seen.add(key);
  }
  if (carts.length > 8) return false;
  return true;
}

/** Assert valid LevelDef, throw with reason otherwise. */
export function assertLevelDef(v: unknown): asserts v is LevelDef {
  if (!isLevelDef(v)) throw new Error('Invalid LevelDef');
}
