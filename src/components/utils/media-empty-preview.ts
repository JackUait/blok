/**
 * Decorative outlines of the finished media block, drawn in the media empty
 * state and in the uploading state. media-empty.css animates the
 * `blok-media-preview__*` part classes; `__layer` groups carry a `--d` depth
 * that the pointer parallax multiplies.
 */

export type MediaPreviewKind = 'video' | 'audio' | 'image' | 'file';

const WAVE = [14, 22, 30, 18, 34, 26, 16, 28, 20, 32, 24, 14, 22, 18];

const layer = (depth: number, body: string): string =>
  `<g class="blok-media-preview__layer" style="--d:${depth}">${body}</g>`;

const shadow = (cx: number, rx: number): string =>
  layer(-2, `<ellipse class="blok-media-preview__shadow" cx="${cx}" cy="113" rx="${rx}" ry="4"/>`);

const waveBars = (): string => WAVE
  .map((h, i) => {
    const x = 92 + i * 6;
    return `<rect class="blok-media-preview__bar" style="--i:${i}" x="${x}" y="${76 - h / 2}" width="3" height="${h}" rx="1.5"/>`;
  })
  .join('');

// Clip ids must be unique per instance: several empty blocks share one document.
const drawings: Record<MediaPreviewKind, (id: string) => string> = {
  video: (id) => `
    <defs><clipPath id="${id}"><rect x="32" y="16" width="136" height="62" rx="7"/></clipPath></defs>
    ${shadow(100, 72)}
    ${layer(3, `
      <rect class="blok-media-preview__frame" x="24" y="8" width="152" height="94" rx="12"/>
      <rect class="blok-media-preview__screen" x="32" y="16" width="136" height="62" rx="7"/>
      <g clip-path="url(#${id})">
        <g class="blok-media-preview__scene">
          <circle class="blok-media-preview__sun" cx="140" cy="32" r="7"/>
          <path class="blok-media-preview__hill blok-media-preview__hill--far" d="M20 80l34-30 26 20 22-16 40 26 30-22 44 30z"/>
          <path class="blok-media-preview__hill" d="M20 80l26-14 30 14 34-20 40 20 36-16 30 16z"/>
        </g>
      </g>
      <rect class="blok-media-preview__track" x="32" y="87" width="136" height="4" rx="2"/>
      <rect class="blok-media-preview__progress" x="32" y="87" width="136" height="4" rx="2"/>`)}
    ${layer(7, `
      <g class="blok-media-preview__knob-group">
        <circle class="blok-media-preview__knob" cx="100" cy="47" r="14"/>
        <path class="blok-media-preview__glyph" d="M95.5 40.5v13l11-6.5z"/>
      </g>`)}`,
  audio: () => `
    ${shadow(100, 80)}
    ${layer(3, `
      <rect class="blok-media-preview__frame" x="14" y="20" width="172" height="80" rx="16"/>
      <rect class="blok-media-preview__line" x="92" y="36" width="62" height="5" rx="2.5"/>
      <rect class="blok-media-preview__line blok-media-preview__line--soft" x="92" y="46" width="38" height="4" rx="2"/>
      ${waveBars()}`)}
    ${layer(7, `
      <g class="blok-media-preview__disc">
        <rect class="blok-media-preview__screen" x="24" y="30" width="58" height="60" rx="9"/>
        <circle class="blok-media-preview__groove" cx="53" cy="60" r="19"/>
        <circle class="blok-media-preview__glyph" cx="53" cy="60" r="4"/>
      </g>`)}`,
  image: (id) => `
    <defs><clipPath id="${id}"><rect x="42" y="14" width="120" height="70" rx="3"/></clipPath></defs>
    ${shadow(102, 66)}
    ${layer(1, `<rect class="blok-media-preview__frame blok-media-preview__photo-back" x="38" y="8" width="128" height="96" rx="6"/>`)}
    ${layer(4, `
      <g class="blok-media-preview__photo">
        <rect class="blok-media-preview__frame" x="34" y="6" width="136" height="100" rx="6"/>
        <rect class="blok-media-preview__screen" x="42" y="14" width="120" height="70" rx="3"/>
        <g clip-path="url(#${id})">
          <g class="blok-media-preview__scene">
            <circle class="blok-media-preview__sun" cx="136" cy="32" r="8"/>
            <path class="blok-media-preview__hill blok-media-preview__hill--far" d="M42 84l30-30 24 20 18-12 48 22z"/>
            <path class="blok-media-preview__hill" d="M42 84l22-14 26 14z"/>
          </g>
        </g>
        <rect class="blok-media-preview__line blok-media-preview__line--soft" x="42" y="92" width="46" height="4" rx="2"/>
      </g>`)}`,
  file: (id) => `
    <defs><clipPath id="${id}"><path d="M78 10h30l24 24v60a8 8 0 0 1-8 8H78a8 8 0 0 1-8-8V18a8 8 0 0 1 8-8z"/></clipPath></defs>
    ${shadow(100, 52)}
    ${layer(1, `<rect class="blok-media-preview__frame blok-media-preview__sheet blok-media-preview__sheet--back" x="70" y="10" width="62" height="92" rx="8"/>`)}
    ${layer(2, `<rect class="blok-media-preview__frame blok-media-preview__sheet blok-media-preview__sheet--mid" x="70" y="10" width="62" height="92" rx="8"/>`)}
    ${layer(5, `
      <g class="blok-media-preview__sheet blok-media-preview__sheet--front">
        <path class="blok-media-preview__frame" d="M78 10h30l24 24v60a8 8 0 0 1-8 8H78a8 8 0 0 1-8-8V18a8 8 0 0 1 8-8z"/>
        <g clip-path="url(#${id})"><rect class="blok-media-preview__fill" x="70" y="10" width="62" height="92"/></g>
        <path class="blok-media-preview__fold" d="M108 10v16a8 8 0 0 0 8 8h16"/>
        <rect class="blok-media-preview__line" x="80" y="46" width="40" height="4" rx="2"/>
        <rect class="blok-media-preview__line" x="80" y="56" width="40" height="4" rx="2"/>
        <rect class="blok-media-preview__line blok-media-preview__line--soft" x="80" y="66" width="26" height="4" rx="2"/>
        <rect class="blok-media-preview__chip" x="80" y="82" width="22" height="10" rx="3"/>
      </g>`)}`,
};

function uid(): string {
  return Math.random().toString(36).slice(2, 9);
}

export function makePreview(kind: MediaPreviewKind): HTMLElement {
  const stage = document.createElement('span');
  stage.className = 'blok-media-preview';
  stage.setAttribute('data-blok-media-preview', kind);
  stage.setAttribute('aria-hidden', 'true');
  // The tilt lives on a group inside the SVG: a transform on the element around
  // the SVG makes the browser tilt a bitmap, and the lines turn jagged.
  stage.innerHTML = `<svg viewBox="0 0 200 120" width="200" height="120" fill="none" focusable="false"><g class="blok-media-preview__tilt">${drawings[kind](`blok-media-preview-${uid()}`)}</g></svg>`;
  return stage;
}

/** Switches a preview into upload mode and fills it to `percent` (0–100). */
export function setPreviewProgress(stage: HTMLElement, percent: number): void {
  const value = Number.isFinite(percent) ? Math.min(100, Math.max(0, percent)) : 0;
  stage.setAttribute('data-uploading', '');
  stage.style.setProperty('--blok-media-progress', String(value / 100));
}

const EXIT_MS = 900;

/** Long enough for the slowest staggered part to finish its exit. */
export const EXIT_CLEAR_MS = 1400;

const SPRING_FALLBACK = 'cubic-bezier(0.34, 1.56, 0.64, 1)';
const spring = { easing: '' };

// A damped spring sampled into a CSS linear() easing: it overshoots about 20%
// and settles inside EXIT_MS.
function springEasing(): string {
  if (spring.easing) return spring.easing;
  const supported = typeof CSS !== 'undefined' && CSS.supports?.('transition-timing-function', 'linear(0, 1)');
  if (!supported) {
    spring.easing = SPRING_FALLBACK;
    return spring.easing;
  }
  const zeta = 0.42;
  const omega = 14;
  const damped = omega * Math.sqrt(1 - zeta * zeta);
  const steps = 40;
  const points = Array.from({ length: steps + 1 }, (_, i) => {
    if (i === steps) return '1';
    const t = (i / steps) * (EXIT_MS / 1000);
    const v = 1 - Math.exp(-zeta * omega * t) * (Math.cos(damped * t) + (zeta * omega / damped) * Math.sin(damped * t));
    return String(Math.round(v * 1000) / 1000);
  });
  spring.easing = `linear(${points.join(', ')})`;
  return spring.easing;
}

const depthOf = (el: Element): number => {
  const layer = el.closest<HTMLElement>('.blok-media-preview__layer');
  return layer ? Math.max(0, parseFloat(layer.style.getPropertyValue('--d')) || 0) : 0;
};

// Bars collapse right to left; everything else settles back layer first, front layer last.
const delayOf = (el: Element): number => {
  const bar = (el as HTMLElement).style?.getPropertyValue('--i');
  if (bar) return (WAVE.length - 1 - Number(bar)) * 22;
  return depthOf(el) * 30;
};

/**
 * Ends the hover demo: every part still moving is caught where it is and
 * springs home, and a few parts add a flourish. Returns a function that stops
 * the exit, for when the pointer comes back mid-way.
 */
export function springHome(stage: HTMLElement): () => void {
  const easing = springEasing();
  const canCapture = typeof stage.getAnimations === 'function';
  const moving = canCapture
    ? Array.from(stage.querySelectorAll<SVGElement>('svg *'))
      // Only keyframe demos: a running transition has no fixed end to spring to.
      .filter((el) => el.getAnimations().some((animation) => 'animationName' in animation))
      .map((el) => ({ el, from: getComputedStyle(el).transform }))
    : [];

  stage.removeAttribute('data-hover');
  stage.setAttribute('data-leaving', '');
  stage.style.setProperty('--spring', easing);
  if (!canCapture) return () => undefined;

  const played: Animation[] = moving.map(({ el, from }) => el.animate(
    [{ transform: from }, { transform: getComputedStyle(el).transform }],
    { duration: EXIT_MS, easing, delay: delayOf(el), fill: 'backwards' }
  ));

  const flourish = (selector: string, keyframes: Keyframe[], options: KeyframeAnimationOptions): void => {
    stage.querySelectorAll(selector).forEach((el) => played.push(el.animate(keyframes, options)));
  };

  // The drawing lands: its shadow squashes wide, then relaxes.
  flourish('.blok-media-preview__shadow', [
    { transform: 'none' },
    { transform: 'scale(1.22, 0.7)', offset: 0.3 },
    { transform: 'none' },
  ], { duration: EXIT_MS, easing: 'ease-out' });
  // The sun sets behind the hills and comes back up.
  flourish('.blok-media-preview__sun', [
    { transform: 'translateY(-6px)' },
    { transform: 'translateY(16px)', offset: 0.4 },
    { transform: 'none' },
  ], { duration: EXIT_MS + 200, easing: 'ease-in-out' });
  // The front page thuds as the stack lands on it.
  flourish('.blok-media-preview__sheet--front', [
    { transform: 'none' },
    { transform: 'translateY(2px) scale(1.03, 0.94)', offset: 0.45 },
    { transform: 'none' },
  ], { duration: 500, delay: 200, easing: 'ease-out' });

  return () => played.forEach((animation) => animation.cancel());
}
