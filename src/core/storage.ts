/**
 * Tiny localStorage wrapper with JSON + namespacing.
 */
const PREFIX = 'lbj:';

function key(k: string): string {
  return `${PREFIX}${k}`;
}

/** Load a value, return fallback on miss / parse error. */
export function load<T>(k: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key(k));
    if (raw === null) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

/** Save a value (best-effort, ignores quota errors). */
export function save(k: string, value: unknown): void {
  try {
    localStorage.setItem(key(k), JSON.stringify(value));
  } catch {
    // ignore — storage is non-critical
  }
}

/** Remove a key. */
export function remove(k: string): void {
  try {
    localStorage.removeItem(key(k));
  } catch {
    // ignore
  }
}
