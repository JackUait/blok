import type { InkSignals } from './motion';
import { createTrackSignals } from './signals';

/**
 * The compact player's seek line: one string with a bead at the playhead. It
 * lies flat at rest. While the track plays it hums a little, and each strong
 * hit plucks it.
 */

export interface WireHandle {
  destroy(): void;
}

export interface WireMotion {
  /** Steady loudness, 0..1. Only a small tremble: on a finished mix it sits near 1 all the time. */
  hum: number;
  /** How hard the last kicks plucked the line, 0..1. */
  swing: number;
  /** The same for snares and hats, 0..1. */
  ripple: number;
  /** Phases of the long and the short wave, in radians. They run faster on a hit. */
  slowPhase: number;
  finePhase: number;
}

/** Gap between the canvas edge and the line's ends. audio.css sizes the seek thumb to twice this, so a click lands under the bead. */
export const WIRE_INSET = 4;
export const WIRE_BEAD_RADIUS = 4.5;

const SEGMENTS = 120;
const LINE_WIDTH = 2;
/** Tallest reach in px of each part of the motion. */
const SWING_PX = 7;
const RIPPLE_PX = 3;
const HUM_PX = 1.5;
/** A hit this weak or weaker does not move the line. Dense tracks land ~8 weak hits a second. */
const HIT_FLOOR = 0.3;
/** A hit this strong plucks at full reach. */
const HIT_FULL = 0.75;
/** Above 1, so the gap between a weak and a strong hit grows. */
const HIT_CURVE = 1.5;
const HAT_WEIGHT = 0.5;
/** Seconds for a pluck to fall to ~37%. */
const SWING_DECAY = 0.22;
const RIPPLE_DECAY = 0.12;
/** Per-second rates the drawn values chase their targets at. */
const HIT_CHASE = 30;
const HUM_CHASE = 6;
/** Radians per second each wave travels: at idle, plus this much more at a full hit. */
const SLOW_IDLE = 1.2;
const SLOW_SURGE = 9;
const FINE_IDLE = 2;
const FINE_SURGE = 16;
/** Below this the line counts as flat. */
const REST_EPSILON = 0.002;
const MAX_PIXEL_RATIO = 3;
/** Clamp per-frame dt so a backgrounded tab does not whip the line on return. */
const MAX_FRAME_S = 0.05;

/** How far the line sits from its rest height at `ratio` (0..1) along it, in px. Both ends are pinned. */
export function wireOffset(ratio: number, motion: WireMotion): number {
  const slow = motion.swing * SWING_PX * Math.sin(ratio * 9.42 - motion.slowPhase);
  const fine = (motion.hum * HUM_PX + motion.ripple * RIPPLE_PX) * Math.sin(ratio * 40.8 + motion.finePhase);

  return Math.sin(Math.PI * ratio) * (slow + fine);
}

/** 0 for a weak hit, 1 for a strong one. */
const pluck = (strength: number): number =>
  Math.min(1, Math.max(0, (strength - HIT_FLOOR) / (HIT_FULL - HIT_FLOOR))) ** HIT_CURVE;

export interface WireMotionStepper {
  /** Advance one frame. `heard` is null while the track is not playing. */
  step(heard: InkSignals | null, dtSec: number): WireMotion;
  atRest(): boolean;
}

export function createWireMotion(): WireMotionStepper {
  const motion: WireMotion = { hum: 0, swing: 0, ripple: 0, slowPhase: 0, finePhase: 0 };
  // What the last hits left behind; the drawn values chase these.
  const struck = { swing: 0, ripple: 0 };
  const flat = (): boolean => motion.hum < REST_EPSILON && motion.swing < REST_EPSILON && motion.ripple < REST_EPSILON;

  return {
    step(heard: InkSignals | null, dtSec: number): WireMotion {
      const high = heard ? Math.max(pluck(heard.snare), pluck(heard.hat) * HAT_WEIGHT) : 0;

      struck.swing = Math.max(struck.swing * Math.exp(-dtSec / SWING_DECAY), heard ? pluck(heard.kick) : 0);
      struck.ripple = Math.max(struck.ripple * Math.exp(-dtSec / RIPPLE_DECAY), high);
      motion.swing += (struck.swing - motion.swing) * Math.min(1, dtSec * HIT_CHASE);
      motion.ripple += (struck.ripple - motion.ripple) * Math.min(1, dtSec * HIT_CHASE);
      motion.hum += ((heard?.level ?? 0) - motion.hum) * Math.min(1, dtSec * HUM_CHASE);
      motion.slowPhase += dtSec * (SLOW_IDLE + SLOW_SURGE * motion.swing);
      motion.finePhase += dtSec * (FINE_IDLE + FINE_SURGE * motion.ripple);

      if (!heard && flat()) {
        struck.swing = 0;
        struck.ripple = 0;
        Object.assign(motion, { hum: 0, swing: 0, ripple: 0 });
      }

      // A copy: the caller keeps frames to compare, and this one changes every step.
      return { ...motion };
    },
    atRest: flat,
  };
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
  const motion = createWireMotion();
  const state = { playing: false, rafId: 0, last: 0, destroyed: false, shape: motion.step(null, 0) };

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
      ...state.shape,
      ink: styles.getPropertyValue('--blok-audio-bar-played').trim() || '#222',
      rest: styles.getPropertyValue('--blok-audio-bar').trim() || '#ddd',
    });
  };

  const frame = (now: number): void => {
    const dt = state.last ? Math.min((now - state.last) / 1000, MAX_FRAME_S) : 0;

    state.last = now;
    state.shape = motion.step(state.playing ? signals.read(dt) : null, dt);
    paint();
    // Keep going after pause until the line lies flat.
    state.rafId = state.playing || !motion.atRest() ? requestAnimationFrame(frame) : 0;
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
