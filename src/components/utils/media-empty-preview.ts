/**
 * Mounts the media preview drawings (media-preview-art.ts) in the empty and
 * uploading states and drives their upload progress and pointer-leave spring.
 */

import { previewSvg, WAVE_BARS } from './media-preview-art';

export type MediaPreviewKind = 'video' | 'audio' | 'image' | 'file';

export function makePreview(kind: MediaPreviewKind): HTMLElement {
  const stage = document.createElement('span');
  stage.className = 'blok-media-preview';
  stage.setAttribute('data-blok-media-preview', kind);
  stage.setAttribute('aria-hidden', 'true');
  stage.innerHTML = previewSvg(kind);
  return stage;
}

/** Switches a preview into upload mode and fills it to `percent` (0–100). */
export function setPreviewProgress(stage: HTMLElement, percent: number): void {
  const value = Number.isFinite(percent) ? Math.min(100, Math.max(0, percent)) : 0;
  stage.setAttribute('data-uploading', '');
  stage.style.setProperty('--blok-media-progress', String(value / 100));
}

/** Takes a preview back out of upload mode, to its resting look. */
export function clearPreviewProgress(stage: HTMLElement): void {
  stage.removeAttribute('data-uploading');
  stage.style.removeProperty('--blok-media-progress');
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
  if (bar) return (WAVE_BARS - 1 - Number(bar)) * 22;
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

  // The drawing lands: its contact shadow snaps in tight and dark, then relaxes.
  flourish('.blok-media-preview__contact', [
    { opacity: 0.24, transform: 'scaleX(1.15)' },
    { opacity: 0.6, transform: 'scaleX(0.9)', offset: 0.35 },
    { opacity: 0.4, transform: 'none' },
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
