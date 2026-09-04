/**
 * Asset loading scaffold — Pixi v8 Assets wrapper.
 * Empty for now; real bundles (sprites, sfx) land in later milestones.
 */
import { Assets } from 'pixi.js';

let loaded = false;

/** Preload all bundled assets. Currently a no-op pass. */
export async function loadAll(): Promise<void> {
  if (loaded) return;
  // Future: Assets.addBundle(...) then Assets.loadBundle(...).
  // Reference Assets so the import stays live without calling uncertain APIs.
  void Assets;
  loaded = true;
}

/** Whether loadAll() has completed. */
export function isLoaded(): boolean {
  return loaded;
}
