import type { EmbedServiceType } from '../registry';

export type EmbedWindowKind = EmbedServiceType | 'generic' | 'idle';

/**
 * Parts drawn inside the window for each kind; embed.css paints them by
 * `[data-kind] [data-part]`. A part listed twice is drawn twice, and `--i`
 * (its index among same-named parts) staggers and offsets the copies.
 */
const SCENES: Record<EmbedWindowKind, readonly string[]> = {
  idle: ['frame', 'line', 'line', 'line'],
  generic: ['bar', 'line', 'line', 'line'],
  video: ['play', 'track'],
  audio: ['cover', 'wave', 'wave', 'wave', 'wave', 'wave'],
  image: ['sun', 'hill', 'hill'],
  social: ['avatar', 'line', 'line', 'heart'],
  document: ['page', 'line', 'line', 'line', 'line'],
  table: ['cell', 'cell', 'cell', 'cell', 'cell', 'cell', 'cell', 'cell', 'cell'],
  form: ['field', 'field', 'button'],
  code: ['line', 'line', 'line', 'line', 'line'],
  design: ['shape', 'shape', 'cursor'],
  chart: ['col', 'col', 'col', 'col', 'col'],
  map: ['road', 'road', 'pin'],
  calendar: ['day', 'day', 'day', 'day', 'day', 'day', 'day', 'day', 'day', 'day', 'day', 'day', 'day', 'day'],
};

export interface EmbedWindow {
  element: HTMLElement;
  show(kind: EmbedWindowKind): void;
  play(anim: 'caught' | 'rejected'): void;
}

/** The decorative frame above the URL bar that becomes whatever the typed link will embed. */
export const createEmbedWindow = (): EmbedWindow => {
  const element = document.createElement('div');

  element.setAttribute('data-role', 'embed-window');
  element.setAttribute('aria-hidden', 'true');
  element.className = 'blok-embed-window';

  // Child parts animate too and their animationend bubbles here.
  element.addEventListener('animationend', (event) => {
    if (event.target === element) {
      element.removeAttribute('data-anim');
    }
  });

  const show = (kind: EmbedWindowKind): void => {
    if (element.getAttribute('data-kind') === kind) {
      return;
    }

    const scene = document.createElement('div');
    const seen = new Map<string, number>();

    scene.className = 'blok-embed-window__scene';
    SCENES[kind].forEach((name) => {
      const part = document.createElement('span');
      const index = seen.get(name) ?? 0;

      seen.set(name, index + 1);
      part.setAttribute('data-part', name);
      part.style.setProperty('--i', String(index));
      scene.appendChild(part);
    });

    element.setAttribute('data-kind', kind);
    element.replaceChildren(scene);
  };

  const play = (anim: 'caught' | 'rejected'): void => {
    // Restart a running animation of the same name.
    element.removeAttribute('data-anim');
    void element.offsetWidth;
    element.setAttribute('data-anim', anim);
  };

  show('idle');

  return { element, show, play };
};
