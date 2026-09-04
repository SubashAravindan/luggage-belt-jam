/**
 * Generic object pool — avoids per-frame allocations.
 * Preallocate Pixi objects / vectors here during gameplay.
 */
export class Pool<T> {
  private readonly free: T[] = [];
  private readonly create: () => T;
  private readonly reset: (item: T) => void;

  constructor(create: () => T, reset: (item: T) => void, prewarm = 0) {
    this.create = create;
    this.reset = reset;
    for (let i = 0; i < prewarm; i++) this.free.push(this.create());
  }

  /** Obtain an instance (reused or fresh). */
  obtain(): T {
    const item = this.free.pop();
    return item ?? this.create();
  }

  /** Return an instance for reuse. */
  release(item: T): void {
    this.reset(item);
    this.free.push(item);
  }

  /** Number of cached instances. */
  get cached(): number {
    return this.free.length;
  }

  /** Drop all cached instances. */
  clear(): void {
    this.free.length = 0;
  }
}
