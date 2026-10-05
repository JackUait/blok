import { embedPreviewSvg } from '../../../components/utils/media-preview-art';
import { leanPreview } from '../../../components/utils/media-preview-3d';
import type { EmbedServiceType } from '../registry';
import { canMorph, morphScene } from './morph';

export type EmbedWindowKind = EmbedServiceType | 'generic' | 'idle';

export interface EmbedWindow {
  element: HTMLElement;
  show(kind: EmbedWindowKind): void;
  /** Lands a provider logo on the drawing; null takes it away. */
  brand(mark: HTMLElement | null): void;
  play(anim: 'caught' | 'rejected'): void;
}

const FADE_OUT_MS = 180;

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
  const state: { stage: HTMLElement | null; running: Animation[]; morphing: boolean } = {
    stage: null,
    running: [],
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

    const prev = state.stage;
    const next = makeStage(kind);
    const prevSvg = prev?.querySelector('svg') ?? null;

    state.running.forEach((animation) => animation.cancel());
    state.running = [];
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

    prev.after(next);
    state.morphing = true;

    const landed = morphScene(prevSvg, nextSvg);
    const fade = prev.animate([{ opacity: 1 }, { opacity: 0, transform: 'scale(0.96)' }], { duration: FADE_OUT_MS, fill: 'forwards' });

    state.running = [...landed, fade];
    void fade.finished.catch(() => undefined).then(() => prev.remove());
    void Promise.all(landed.map((animation) => animation.finished)).catch(() => undefined).then(() => {
      if (state.stage === next) {
        state.morphing = false;
      }
    });
  };

  const brand = (mark: HTMLElement | null): void => {
    element.querySelector('[data-role="embed-brand"]')?.remove();

    if (mark === null) {
      return;
    }

    const badge = document.createElement('span');

    badge.className = 'blok-embed-window__brand';
    badge.setAttribute('data-role', 'embed-brand');
    badge.setAttribute('aria-hidden', 'true');
    badge.appendChild(mark);
    element.appendChild(badge);
  };

  const play = (anim: 'caught' | 'rejected'): void => {
    // Restart a running animation of the same name.
    element.removeAttribute('data-anim');
    void element.offsetWidth;
    element.setAttribute('data-anim', anim);
  };

  show('idle');

  return { element, show, brand, play };
};
