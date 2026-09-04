/**
 * Level pack — static list for now, validated at load.
 */
import level001 from './level-001.json';
import level002 from './level-002.json';
import level003 from './level-003.json';
import level004 from './level-004.json';
import level005 from './level-005.json';
import level006 from './level-006.json';
import level007 from './level-007.json';
import level008 from './level-008.json';
import level009 from './level-009.json';
import level010 from './level-010.json';
import { assertLevelDef } from './schema.ts';
import type { LevelDef } from '../game/types.ts';

function validate(raw: unknown): LevelDef {
  assertLevelDef(raw);
  return raw;
}

/** All bundled levels in order. */
export const LEVELS: LevelDef[] = [
  validate(level001),
  validate(level002),
  validate(level003),
  validate(level004),
  validate(level005),
  validate(level006),
  validate(level007),
  validate(level008),
  validate(level009),
  validate(level010),
];

/** Get level by index. Throws on out-of-bounds (no silent clamping). */
export function getLevel(index: number): LevelDef {
  if (!Number.isInteger(index) || index < 0 || index >= LEVELS.length) {
    throw new RangeError(`Level index out of bounds: ${index} (pack has ${LEVELS.length})`);
  }
  const lvl = LEVELS[index];
  if (!lvl) throw new Error('Level pack is empty');
  return lvl;
}

/** Number of bundled levels. */
export const LEVEL_COUNT = LEVELS.length;
