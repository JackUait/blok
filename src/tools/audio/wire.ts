import { createTrackSignals } from './signals';

/**
 * The compact player's seek line: one string with a bead at the playhead. It
 * lies flat at rest and hums with the track while it plays.
 */

export interface WireHandle {
  destroy(): void;
}

export interface WireMotion {
  /** Smoothed loudness, 0..1. */
  level: number;
  /** Smoothed hit, 0..1. */
  kick: number;
  /** Seconds the line has been moving. */
  time: number;
}

/** Gap between the canvas edge and the line's ends. audio.css sizes the seek thumb to twice this, so a click lands under the bead. */
export const WIRE_INSET = 4;
export const WIRE_BEAD_RADIUS = 4.5;

const SEGMENTS = 120;
const LINE_WIDTH = 2;
/** Tallest swing in px of the slow wave a hit sends down the line. */
const KICK_SWING = 10;
/** Tallest swing in px of the fast hum that follows loudness. */
const LEVEL_SWING = 6;
/** Seconds for a hit to fall to ~37%. */
const KICK_DECAY = 0.1;
/** Per-second rates the drawn values chase their targets at. */
const LEVEL_CHASE = 14;
const KICK_CHASE = 30;
/** Below this the line counts as flat. */
const REST_EPSILON = 0.002;
const MAX_PIXEL_RATIO = 3;
/** Clamp per-frame dt so a backgrounded tab does not whip the line on return. */
const MAX_FRAME_S = 0.05;

/** How far the line sits from its rest height at `ratio` (0..1) along it, in px. Both ends are pinned. */
export function wireOffset(ratio: number, motion: WireMotion): number {
  const slow = motion.kick * KICK_SWING * Math.sin(ratio * 9.42 - motion.time * 9);
  const fast = motion.level * LEVEL_SWING * Math.sin(ratio * 40.8 + motion.time * 31);

  return Math.sin(Math.PI * ratio) * (slow + fast);
}

export interface WirePaint extends WireMotion {
  width: number;
  height: number;
  /** Playhead, 0..1. */
  progress: number;
  /** Colour of the played part and the bead. */
  ink: string;
  /** Colour of the part still to play. */
  rest: string;
}

export function paintWire(context: CanvasRenderingContext2D, paint: WirePaint): void {
  // `ctx` aliases the param so property writes below are not flagged by no-param-reassign.
  const ctx = context;
  const { width, height, progress } = paint;
  const middle = height / 2;
  const span = width - 2 * WIRE_INSET;
  const headX = WIRE_INSET + progress * span;

  ctx.lineWidth = LINE_WIDTH;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  const stroke = (colour: string, from: number, to: number): void => {
    ctx.save();
    ctx.beginPath();
    ctx.rect(from, 0, to - from, height);
    ctx.clip();
    ctx.strokeStyle = colour;
    ctx.beginPath();
    Array.from({ length: SEGMENTS + 1 }, (_, i) => i / SEGMENTS).forEach((ratio) => {
      ctx.lineTo(WIRE_INSET + ratio * span, middle + wireOffset(ratio, paint));
    });
    ctx.stroke();
    ctx.restore();
  };

  stroke(paint.rest, headX, width);
  stroke(paint.ink, 0, headX);

  ctx.fillStyle = paint.ink;
  ctx.beginPath();
  ctx.arc(headX, middle + wireOffset(progress, paint), WIRE_BEAD_RADIUS, 0, Math.PI * 2);
  ctx.fill();
}

const prefersReducedMotion = (): boolean =>
  globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

export function attachWire(opts: {
  mount: HTMLElement;
  media: HTMLAudioElement;
  motion?: string;
  peaks?: number[];
}): WireHandle {
  const { mount, media } = opts;
  const canvas = document.createElement('canvas');

  canvas.className = 'blok-audio-wire';
  canvas.setAttribute('data-role', 'audio-wire');
  canvas.setAttribute('aria-hidden', 'true');
  mount.appendChild(canvas);

  const signals = createTrackSignals(opts);
  const state = { playing: false, rafId: 0, last: 0, destroyed: false, level: 0, kick: 0, hit: 0, time: 0 };

  const paint = (): void => {
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;

    if (width <= 0 || height <= 0) return;
    const ratio = Math.min(globalThis.devicePixelRatio || 1, MAX_PIXEL_RATIO);
    const pixelWidth = Math.round(width * ratio);
    const pixelHeight = Math.round(height * ratio);

    // Resizing clears the backing store, so only do it when the box changed.
    if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
      canvas.width = pixelWidth;
      canvas.height = pixelHeight;
    }
    const ctx = canvas.getContext('2d');

    if (!ctx) return;
    const styles = getComputedStyle(canvas);

    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.clearRect(0, 0, width, height);
    paintWire(ctx, {
      width,
      height,
      progress: media.duration ? Math.min(1, Math.max(0, media.currentTime / media.duration)) : 0,
      level: state.level,
      kick: state.kick,
      time: state.time,
      ink: styles.getPropertyValue('--blok-audio-bar-played').trim() || '#222',
      rest: styles.getPropertyValue('--blok-audio-bar').trim() || '#ddd',
    });
  };

  const step = (dt: number): void => {
    const heard = state.playing ? signals.read(dt) : null;

    state.hit = Math.max(state.hit * Math.exp(-dt / KICK_DECAY), heard?.kick ?? 0);
    state.level += ((heard?.level ?? 0) - state.level) * Math.min(1, dt * LEVEL_CHASE);
    state.kick += ((heard ? state.hit : 0) - state.kick) * Math.min(1, dt * KICK_CHASE);
    state.time += dt;
  };

  const frame = (now: number): void => {
    const dt = state.last ? Math.min((now - state.last) / 1000, MAX_FRAME_S) : 0;

    state.last = now;
    step(dt);

    const flat = !state.playing && state.level < REST_EPSILON && state.kick < REST_EPSILON;

    if (flat) {
      state.level = 0;
      state.kick = 0;
      state.hit = 0;
    }
    paint();
    // Keep going after pause until the line lies flat.
    state.rafId = flat ? 0 : requestAnimationFrame(frame);
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
  media.addEventListener('timeupdate', repaintAtRest);
  // A paused drag on the seek line: timeupdate only comes once the seek lands.
  media.addEventListener('seeking', repaintAtRest);
  media.addEventListener('loadedmetadata', repaintAtRest);

  // The canvas has no box until the block is in the page, and its colours
  // change with the theme. Neither sends a media event, so watch both.
  const resizeObserver = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(repaintAtRest);
  const themeObserver = typeof MutationObserver === 'undefined' ? null : new MutationObserver(repaintAtRest);
  const scheme = globalThis.matchMedia?.('(prefers-color-scheme: dark)');

  resizeObserver?.observe(canvas);
  themeObserver?.observe(document.documentElement, { attributes: true, subtree: true, attributeFilter: ['data-blok-theme'] });
  scheme?.addEventListener?.('change', repaintAtRest);
  paint();
  // A track that is already playing when the line mounts sends no play event.
  if (!media.paused) onPlay();

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
      media.removeEventListener('timeupdate', repaintAtRest);
      media.removeEventListener('seeking', repaintAtRest);
      media.removeEventListener('loadedmetadata', repaintAtRest);
      signals.destroy();
      canvas.remove();
    },
  };
}
