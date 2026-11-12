import { createInkDrop } from './ink';
import { paintInk } from './ink-paint';
import { createListener } from './listen';
import {
  bandsFromSpectrum,
  createMotionReader,
  createPeaksReader,
  createSignalCore,
  decodeMotion,
  type InkSignals,
  type SignalReader,
} from './motion';

export interface InkCoverHandle {
  destroy(): void;
}

const SILENCE: InkSignals = { level: 0, bass: 0, mid: 0, kick: 0, snare: 0, hat: 0 };
/** Above 3x the extra pixels cost paint time and show nothing on a 44px cover. */
const MAX_PIXEL_RATIO = 3;
/** Clamp per-frame dt so a backgrounded tab does not fling the drop on return. */
const MAX_FRAME_S = 0.05;

const prefersReducedMotion = (): boolean =>
  globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

/** Saved motion first, then the coarse stored loudness, then nothing. */
const savedReader = (media: HTMLAudioElement, motion?: string, peaks?: number[]): SignalReader | null => {
  const track = motion ? decodeMotion(motion) : null;

  if (track) return createMotionReader(track);
  if (peaks?.length) return createPeaksReader(peaks, () => media.duration);

  return null;
};

/**
 * The no-cover ink drop. It listens to the track live where the browser allows
 * it, and otherwise reads what was saved with the block.
 */
export function attachInkCover(opts: {
  canvas: HTMLCanvasElement;
  media: HTMLAudioElement;
  motion?: string;
  peaks?: number[];
}): InkCoverHandle {
  const { canvas, media } = opts;
  const drop = createInkDrop();
  const listener = createListener(media);
  const core = createSignalCore();
  const reader = savedReader(media, opts.motion, opts.peaks);
  const state = { playing: false, rafId: 0, last: 0, destroyed: false };

  const paint = (): void => {
    const box = canvas.clientWidth;

    if (box <= 0) return;
    const pixels = Math.round(box * Math.min(globalThis.devicePixelRatio || 1, MAX_PIXEL_RATIO));

    // Resizing clears the backing store, so only do it when the box changed.
    if (canvas.width !== pixels) {
      canvas.width = pixels;
      canvas.height = pixels;
    }
    const ctx = canvas.getContext('2d');

    if (!ctx) return;
    const styles = getComputedStyle(canvas);

    paintInk(ctx, drop.shape(), {
      pixels,
      ink: styles.getPropertyValue('--blok-audio-ink').trim() || '#000',
      sheen: styles.getPropertyValue('--blok-audio-ink-sheen').trim() || 'rgba(255, 255, 255, 0.22)',
      glint: styles.getPropertyValue('--blok-audio-ink-glint').trim() || 'rgba(255, 255, 255, 0.5)',
    });
  };

  const signalsNow = (dt: number): InkSignals => {
    if (!state.playing) return SILENCE;
    const live = listener.read();

    if (live) return core.step(bandsFromSpectrum(live.bytes, live.hzPerBin), dt);

    return reader ? reader.read(media.currentTime, dt) : SILENCE;
  };

  const frame = (now: number): void => {
    const dt = state.last ? Math.min((now - state.last) / 1000, MAX_FRAME_S) : 0;

    state.last = now;
    drop.step(signalsNow(dt), dt);
    paint();
    // Keep going after pause until the drop has settled.
    state.rafId = state.playing || !drop.atRest() ? requestAnimationFrame(frame) : 0;
  };

  const onPlay = (): void => {
    if (state.destroyed || prefersReducedMotion()) return;
    state.playing = true;
    if (state.rafId) return;
    state.last = 0;
    state.rafId = requestAnimationFrame(frame);
  };
  const onStop = (): void => {
    state.playing = false;
  };
  const repaintAtRest = (): void => {
    if (!state.rafId) paint();
  };

  media.addEventListener('play', onPlay);
  media.addEventListener('pause', onStop);
  media.addEventListener('ended', onStop);

  // The canvas has no box until the block is in the page, and its colours
  // change with the theme. Neither sends a media event, so watch both.
  const resizeObserver = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(repaintAtRest);
  const themeObserver = typeof MutationObserver === 'undefined' ? null : new MutationObserver(repaintAtRest);
  const scheme = globalThis.matchMedia?.('(prefers-color-scheme: dark)');

  resizeObserver?.observe(canvas);
  themeObserver?.observe(document.documentElement, { attributes: true, subtree: true, attributeFilter: ['data-blok-theme'] });
  scheme?.addEventListener?.('change', repaintAtRest);
  paint();

  return {
    destroy(): void {
      state.destroyed = true;
      state.playing = false;
      if (state.rafId) cancelAnimationFrame(state.rafId);
      state.rafId = 0;
      resizeObserver?.disconnect();
      themeObserver?.disconnect();
      scheme?.removeEventListener?.('change', repaintAtRest);
      media.removeEventListener('play', onPlay);
      media.removeEventListener('pause', onStop);
      media.removeEventListener('ended', onStop);
      listener.destroy();
    },
  };
}
