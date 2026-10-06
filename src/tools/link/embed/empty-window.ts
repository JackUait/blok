import { embedPreviewSvg } from '../../../components/utils/media-preview-art';
import { leanPreview } from '../../../components/utils/media-preview-3d';
import type { EmbedServiceType } from '../registry';
import { canMorph, morphScene, type Morph } from './morph';

export type EmbedWindowKind = EmbedServiceType | 'generic' | 'idle';

export interface EmbedWindow {
  element: HTMLElement;
  show(kind: EmbedWindowKind): void;
  /** Lands a provider logo on the drawing; null takes it away. */
  brand(mark: HTMLElement | null): void;
  play(anim: 'caught' | 'rejected'): void;
}

const prefersReducedMotion = (): boolean =>
  typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

const makeStage = (kind: EmbedWindowKind): HTMLElement => {
  const stage = document.createElement('span');

  stage.className = 'blok-media-preview';
  stage.innerHTML = embedPreviewSvg(kind);

  return stage;
};

/** The decorative frame above the URL bar that becomes whatever the typed link will embed. */
export const createEmbedWindow = (): EmbedWindow => {
  const element = document.createElement('div');
  const state: { stage: HTMLElement | null; morph: Morph | null; morphing: boolean } = {
    stage: null,
    morph: null,
    morphing: false,
  };

  element.setAttribute('data-role', 'embed-window');
  element.setAttribute('aria-hidden', 'true');
  element.className = 'blok-embed-window';

  // Child parts animate too and their animationend bubbles here.
  element.addEventListener('animationend', (event) => {
    if (event.target === element) {
      element.removeAttribute('data-anim');
    }
  });

  // leanPreview swaps every shape for a projected path, which would drop the
  // morph's animations, so the tilt waits until the morph lands.
  element.addEventListener('pointermove', (event) => {
    if (state.stage === null || state.morphing || prefersReducedMotion()) {
      return;
    }

    const rect = element.getBoundingClientRect();

    if (rect.width === 0 || rect.height === 0) {
      return;
    }

    leanPreview(
      state.stage,
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      ((event.clientY - rect.top) / rect.height) * 2 - 1
    );
  });
  element.addEventListener('pointerleave', () => {
    if (state.stage !== null && !state.morphing) {
      leanPreview(state.stage, 0, 0);
    }
  });

  const show = (kind: EmbedWindowKind): void => {
    if (element.getAttribute('data-kind') === kind) {
      return;
    }

    // A morph cut short lands at once, so the next one starts from a whole scene.
    state.morph?.cleanup();
    state.morph = null;

    const prev = state.stage;
    const next = makeStage(kind);
    const prevSvg = prev?.querySelector('svg') ?? null;

    element.querySelectorAll('.blok-media-preview').forEach((stage) => {
      if (stage !== prev) {
        stage.remove();
      }
    });
    element.setAttribute('data-kind', kind);
    state.stage = next;

    const nextSvg = next.querySelector('svg');
    const animated = prev !== null && prevSvg !== null && nextSvg !== null
      && element.isConnected && !prefersReducedMotion() && canMorph(prevSvg);

    if (!animated) {
      state.morphing = false;
      prev?.remove();
      element.prepend(next);

      return;
    }

    // The old scene's parts ride inside the new scene; its stage stays only for the defs they use.
    prev.after(next);
    prev.style.opacity = '0';
    state.morphing = true;

    const morph = morphScene(prevSvg, nextSvg);
    const running: Morph = {
      animations: morph.animations,
      cleanup: () => {
        morph.cleanup();
        prev.remove();

        if (state.morph === running) {
          state.morph = null;
          state.morphing = false;
        }
      },
    };

    state.morph = running;
    void Promise.all(morph.animations.map((animation) => animation.finished))
      .catch(() => undefined)
      .then(() => {
        if (state.morph === running) {
          running.cleanup();
        }
      });
  };

  const brand = (mark: HTMLElement | null): void => {
    const current = element.querySelector<HTMLElement>('[data-role="embed-brand"]');

    if (mark === null) {
      current?.remove();

      return;
    }

    const logo = document.createElement('span');

    logo.className = 'blok-embed-window__brand-mark';
    logo.setAttribute('data-role', 'embed-brand-mark');
    logo.appendChild(mark);

    if (current === null) {
      const badge = document.createElement('span');

      badge.className = 'blok-embed-window__brand';
      badge.setAttribute('data-role', 'embed-brand');
      badge.setAttribute('aria-hidden', 'true');
      badge.appendChild(logo);
      element.appendChild(badge);

      return;
    }

    // The badge glides to the new scene's corner (CSS) while the logo inside spins over.
    const old = current.querySelector<HTMLElement>('[data-role="embed-brand-mark"]');

    logo.setAttribute('data-swap', '');
    current.appendChild(logo);

    if (old === null) {
      return;
    }

    old.removeAttribute('data-role');

    if (prefersReducedMotion() || typeof old.animate !== 'function') {
      old.remove();

      return;
    }

    void old.animate(
      [{ opacity: 1 }, { opacity: 0, scale: '0.4', rotate: '30deg' }],
      { duration: 160, fill: 'forwards' }
    ).finished.catch(() => undefined).then(() => old.remove());
  };

  const play = (anim: 'caught' | 'rejected'): void => {
    // Restart a running animation of the same name.
    element.removeAttribute('data-anim');
    element.offsetWidth;
    element.setAttribute('data-anim', anim);
  };

  show('idle');

  return { element, show, brand, play };
};
