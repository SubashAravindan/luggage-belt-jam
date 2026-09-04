/**
 * Entry — init Pixi 720x1280 portrait FIT, DPR capped, resize handler,
 * first-pointer audio unlock, dark airport background (see Game).
 */
import './style.css';
import { Game } from './app/Game.ts';
import { unlockAudioOnFirstPointer } from './core/audio.ts';

function getMount(): HTMLElement {
  const el = document.getElementById('app');
  if (!el) throw new Error('#app mount missing');
  return el;
}

async function boot(): Promise<void> {
  // Unlock WebAudio on first user gesture (mobile autoplay policy).
  unlockAudioOnFirstPointer();

  const mount = getMount();
  mount.innerHTML = '';

  const game = new Game();
  await game.init(mount);

  // Game owns the FIT resize handler (added + removed in Game.init/destroy),
  // so no extra window listener here — a duplicate would leak after destroy.

  // eslint-disable-next-line no-console
  console.log('Luggage Belt Jam boot OK');
}

void boot().catch((err: unknown) => {
  // eslint-disable-next-line no-console
  console.error('[lbj] boot failed', err);
  const mount = document.getElementById('app');
  if (mount) {
    mount.innerHTML = `<pre style="color:#fff;padding:24px">Boot failed: ${
      err instanceof Error ? err.message : String(err)
    }</pre>`;
  }
});
