import { embedPreviewSvg } from '../../../components/utils/media-preview-art';
import { leanPreview, projectPoint } from '../../../components/utils/media-preview-3d';
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

// The logo tile floats above every layer of the drawing (their --d tops out
// at 9, times the 4 units a depth step is worth in media-preview-3d.ts).
const BRAND_DEPTH = 44;
const DRAWING_WIDTH = 200;

const brandOf = (element: HTMLElement): HTMLElement | null =>
  element.querySelector<HTMLElement>('[data-role="embed-brand"]');

// The idle window: a stack of what a link can become. embed.css shuffles it
// and times each card by its place here, so the order is part of that timing.
const DECK_KINDS = ['video', 'social', 'design', 'audio', 'table'] as const;

const deckOf = (element: HTMLElement): HTMLElement | null =>
  element.querySelector<HTMLElement>('[data-role="embed-deck"]');

const makeStage = (kind: Exclude<EmbedWindowKind, 'idle'>): HTMLElement => {
  const stage = document.createElement('span');

  stage.className = 'blok-media-preview';
  stage.innerHTML = embedPreviewSvg(kind);

  return stage;
};

// Lets the hover fan in embed.css ease: only a registered number can transition.
// Not an @property rule: view.css copies every one, and this is edit-only.
const registerDeckFan = (): void => {
  if (typeof CSS === 'undefined' || typeof CSS.registerProperty !== 'function') {
    return;
  }

  try {
    CSS.registerProperty({ name: '--blok-embed-deck-fan', syntax: '<number>', inherits: true, initialValue: '0' });
  } catch {
    // Already registered by an earlier window.
  }
};

const makeDeck = (): HTMLElement => {
  const deck = document.createElement('span');

  deck.className = 'blok-embed-deck';
  deck.setAttribute('data-role', 'embed-deck');

  for (const kind of DECK_KINDS) {
    const card = document.createElement('span');

    card.className = 'blok-embed-deck__card';
    card.setAttribute('data-kind', kind);
    card.appendChild(makeStage(kind));
    deck.appendChild(card);
  }

  return deck;
};

// embed.css raises the leading card's z-index, so the highest one is in front.
const frontDrawing = (deck: HTMLElement): SVGSVGElement | null => {
  const front = Array.from(deck.children).reduce<{ card: Element | null; z: number }>((best, card) => {
    const z = parseInt(getComputedStyle(card).zIndex, 10) || 0;

    return best.card === null || z > best.z ? { card, z } : best;
  }, { card: null, z: 0 });

  return front.card?.querySelector('svg') ?? null;
};

/** The decorative frame above the URL bar that becomes whatever the typed link will embed. */
export const createEmbedWindow = (): EmbedWindow => {
  const element = document.createElement('div');
  const state: { stage: HTMLElement | null; morph: Morph | null; morphing: boolean } = {
    stage: null,
    morph: null,
    morphing: false,
  };

  // Where the logo tile's centre sits at rest, in the drawing's own units.
  // Read on pointer move, not per frame: the tilt loop must not force layout.
  const rest = { x: 0, y: 0, unit: 0 };

  const measureBrand = (frame: DOMRect): void => {
    const badge = brandOf(element);
    const drawing = state.stage?.querySelector('svg')?.getBoundingClientRect();

    rest.unit = badge === null || drawing === undefined ? 0 : drawing.width / DRAWING_WIDTH;

    if (badge === null || drawing === undefined || rest.unit === 0) {
      return;
    }

    rest.x = (badge.offsetLeft + badge.offsetWidth / 2 - (drawing.left - frame.left)) / rest.unit;
    rest.y = (badge.offsetTop + badge.offsetHeight / 2 - (drawing.top - frame.top)) / rest.unit;
  };

  // The tile is outside the drawing, so it is moved by hand through the same projection.
  const followTilt = (tiltX: number, tiltY: number): void => {
    const badge = brandOf(element);

    if (badge === null || rest.unit === 0) {
      return;
    }

    const [x, y] = projectPoint(rest.x, rest.y, BRAND_DEPTH, tiltX, tiltY);

    badge.style.translate = `${((x - rest.x) * rest.unit).toFixed(2)}px ${((y - rest.y) * rest.unit).toFixed(2)}px`;
  };

  registerDeckFan();
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

    measureBrand(rect);
    leanPreview(
      state.stage,
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      ((event.clientY - rect.top) / rect.height) * 2 - 1,
      followTilt
    );
  });
  element.addEventListener('pointerleave', () => {
    if (state.stage !== null && !state.morphing) {
      leanPreview(state.stage, 0, 0, followTilt);
    }
  });

  const show = (kind: EmbedWindowKind): void => {
    if (element.getAttribute('data-kind') === kind) {
      return;
    }

    // A morph cut short lands at once, so the next one starts from a whole scene.
    state.morph?.cleanup();
    state.morph = null;

    // What the new drawing replaces: the scene on show, or the idle deck.
    const deck = deckOf(element);
    const prev = state.stage ?? deck;
    const prevSvg = state.stage?.querySelector('svg') ?? (deck === null ? null : frontDrawing(deck));
    const next = kind === 'idle' ? makeDeck() : makeStage(kind);

    element.querySelectorAll(':scope > .blok-media-preview, :scope > [data-role="embed-deck"]').forEach((stage) => {
      if (stage !== prev) {
        stage.remove();
      }
    });
    element.setAttribute('data-kind', kind);
    // The deck is not one drawing: it does not tilt, and nothing morphs into it.
    state.stage = kind === 'idle' ? null : next;
    // The new drawing starts flat.
    rest.unit = 0;
    brandOf(element)?.style.removeProperty('translate');

    const nextSvg = kind === 'idle' ? null : next.querySelector('svg');
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
    const current = brandOf(element);

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
