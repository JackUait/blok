import type { ImageAlignment } from '../../../types/tools/image';
import { MAX_WIDTH_PERCENT, MIN_WIDTH_PERCENT } from './constants';

export type ResizeEdge = 'left' | 'right';

export function alignmentFraction(alignment: ImageAlignment): number {
  if (alignment === 'left') return 0;
  if (alignment === 'right') return 1;
  return 0.5;
}

export interface ComputeWidthInput {
  edge: ResizeEdge;
  /** Width of the layout container (figure's parent) in pixels */
  containerWidth: number;
  /** Figure width in pixels at the moment the drag began */
  startWidth: number;
  /** Pointer X relative to viewport at the moment the drag began */
  startX: number;
  /** Current pointer X relative to viewport */
  currentX: number;
  /** Alignment anchor as a fraction [0..1] of the container. Centered → symmetric resize. */
  alignFrac?: number;
  /**
   * Per-source hard minimum in pixels (e.g. an embed provider's smallest usable
   * player width). Converted to a percent of the live container and used as the
   * lower clamp instead of the global floor.
   */
  minWidthPx?: number;
}

/**
 * Clamps a width percent into the resizable range. `minPercent` raises the lower
 * bound for sources with a per-instance minimum, but never below the global floor
 * and never above the max (a minimum wider than the container pins the width full).
 */
export function clampPercent(value: number, minPercent: number = MIN_WIDTH_PERCENT): number {
  const floor = Math.min(Math.max(minPercent, MIN_WIDTH_PERCENT), MAX_WIDTH_PERCENT);
  if (value < floor) return floor;
  if (value > MAX_WIDTH_PERCENT) return MAX_WIDTH_PERCENT;
  return value;
}

export interface WidthResult {
  /** The clamped width as a percent of the container. */
  percent: number;
  /**
   * True when the drag wanted to shrink past the lower floor and was pinned
   * there — used to surface a "can't go smaller" cue to the user.
   */
  clampedToMin: boolean;
}

/**
 * Pointer follows the dragged edge; width grows around the alignment anchor.
 * Center (frac 0.5) → both edges move → width delta = 2× pointer delta.
 * Edge-anchored (frac 0 or 1) → single side grows → width delta = 1× pointer delta.
 *
 * Returns the clamped percent plus whether it hit the lower floor, so callers
 * can animate a resistance cue when the player refuses to shrink further.
 */
export function computeWidthResult(input: ComputeWidthInput): WidthResult {
  if (input.containerWidth <= 0) return { percent: clampPercent(0), clampedToMin: true };
  const frac = input.alignFrac ?? 0;
  const denom = input.edge === 'right' ? 1 - frac : frac;
  const multiplier = denom === 0 ? 1 : 1 / denom;
  const deltaX = input.currentX - input.startX;
  const signedDelta = multiplier * (input.edge === 'right' ? deltaX : -deltaX);
  const nextWidth = input.startWidth + signedDelta;
  const minPercent = input.minWidthPx !== undefined
    ? Math.round((input.minWidthPx / input.containerWidth) * 100)
    : MIN_WIDTH_PERCENT;
  const floor = Math.min(Math.max(minPercent, MIN_WIDTH_PERCENT), MAX_WIDTH_PERCENT);
  const raw = Math.round((nextWidth / input.containerWidth) * 100);
  return { percent: clampPercent(raw, minPercent), clampedToMin: raw < floor };
}

export function computeWidthPercent(input: ComputeWidthInput): number {
  return computeWidthResult(input).percent;
}

/**
 * Marker set on the figure while a drag is pinned at the lower floor. Shared
 * resize-cue CSS keys off it to recoil the player/image/embed and neutralise
 * the dragged handle, so every resizable tool gets the "can't shrink further"
 * feedback for free.
 */
export const RESIZE_BLOCKED_ATTR = 'data-resize-blocked';

export interface AttachResizeHandleOptions {
  handle: HTMLElement;
  figure: HTMLElement;
  container: HTMLElement;
  edge: ResizeEdge;
  alignment?: ImageAlignment;
  /**
   * Hard minimum width in pixels; floors the resize lower bound. May be a thunk
   * resolved at drag start for context-dependent floors (e.g. an image inside a
   * table cell) that are only known once the element is mounted.
   */
  minWidthPx?: number | (() => number | undefined);
  onPreview(percent: number): void;
  onCommit(percent: number): void;
}

interface DragState {
  active: boolean;
  startX: number;
  startWidth: number;
  containerWidth: number;
  lastPercent: number | undefined;
  minWidthPx: number | undefined;
}

/** Global vertical clamp for height-resizable embeds (document-style providers). */
export const MIN_HEIGHT_PX = 200;
export const MAX_HEIGHT_PX = 2000;

export interface ComputeHeightInput {
  /** Figure height in pixels at the moment the drag began. */
  startHeight: number;
  /** Pointer Y relative to viewport at the moment the drag began. */
  startY: number;
  /** Current pointer Y relative to viewport. */
  currentY: number;
  /** Per-source hard minimum in pixels; never lowers the global floor. */
  minHeightPx?: number;
  maxHeightPx?: number;
}

export interface HeightResult {
  /** The clamped height in pixels. */
  heightPx: number;
  /** True when the drag wanted to shrink past the floor and was pinned there. */
  clampedToMin: boolean;
}

/**
 * Bottom-edge drag: height follows the pointer 1:1. Pixel-based (not percent)
 * because a document embed's usable height is independent of container width.
 */
export function computeHeightResult(input: ComputeHeightInput): HeightResult {
  const floor = Math.max(input.minHeightPx ?? MIN_HEIGHT_PX, MIN_HEIGHT_PX);
  const ceiling = Math.min(input.maxHeightPx ?? MAX_HEIGHT_PX, MAX_HEIGHT_PX);
  const raw = Math.round(input.startHeight + (input.currentY - input.startY));
  const heightPx = Math.min(Math.max(raw, floor), ceiling);
  return { heightPx, clampedToMin: raw < floor };
}

export interface AttachHeightResizeHandleOptions {
  handle: HTMLElement;
  /** Carries the `data-resize-blocked` cue while pinned at the floor. */
  figure: HTMLElement;
  /** Resolved at drag start so the live rendered height is the baseline. */
  startHeight: () => number;
  minHeightPx?: number;
  maxHeightPx?: number;
  onPreview(heightPx: number): void;
  onCommit(heightPx: number): void;
}

export function attachHeightResizeHandle(opts: AttachHeightResizeHandleOptions): () => void {
  const state = { active: false, startY: 0, startHeight: 0, lastHeight: undefined as number | undefined };

  const onDown = (event: PointerEvent): void => {
    state.active = true;
    state.startY = event.clientY;
    state.startHeight = opts.startHeight();
    state.lastHeight = undefined;
    opts.handle.setPointerCapture(event.pointerId);
    event.preventDefault();
  };

  const onMove = (event: PointerEvent): void => {
    if (!state.active) return;
    const result = computeHeightResult({
      startHeight: state.startHeight,
      startY: state.startY,
      currentY: event.clientY,
      minHeightPx: opts.minHeightPx,
      maxHeightPx: opts.maxHeightPx,
    });
    state.lastHeight = result.heightPx;
    if (result.clampedToMin) {
      opts.figure.setAttribute(RESIZE_BLOCKED_ATTR, 'true');
    } else {
      opts.figure.removeAttribute(RESIZE_BLOCKED_ATTR);
    }
    opts.onPreview(result.heightPx);
  };

  const onUp = (event: PointerEvent): void => {
    if (!state.active) return;
    state.active = false;
    opts.figure.removeAttribute(RESIZE_BLOCKED_ATTR);
    opts.handle.releasePointerCapture(event.pointerId);
    if (state.lastHeight !== undefined) opts.onCommit(state.lastHeight);
  };

  opts.handle.addEventListener('pointerdown', onDown);
  opts.handle.addEventListener('pointermove', onMove);
  opts.handle.addEventListener('pointerup', onUp);
  opts.handle.addEventListener('pointercancel', onUp);

  return () => {
    opts.handle.removeEventListener('pointerdown', onDown);
    opts.handle.removeEventListener('pointermove', onMove);
    opts.handle.removeEventListener('pointerup', onUp);
    opts.handle.removeEventListener('pointercancel', onUp);
  };
}

export function attachResizeHandle(opts: AttachResizeHandleOptions): () => void {
  const state: DragState = {
    active: false,
    startX: 0,
    startWidth: 0,
    containerWidth: 0,
    lastPercent: undefined,
    minWidthPx: undefined,
  };

  const alignFrac = alignmentFraction(opts.alignment ?? 'center');

  const onDown = (event: PointerEvent): void => {
    state.active = true;
    state.startX = event.clientX;
    state.startWidth = opts.figure.getBoundingClientRect().width;
    state.containerWidth = opts.container.getBoundingClientRect().width;
    state.lastPercent = undefined;
    state.minWidthPx = typeof opts.minWidthPx === 'function' ? opts.minWidthPx() : opts.minWidthPx;
    opts.handle.setPointerCapture(event.pointerId);
    event.preventDefault();
  };

  const onMove = (event: PointerEvent): void => {
    if (!state.active) return;
    const result = computeWidthResult({
      edge: opts.edge,
      containerWidth: state.containerWidth,
      startWidth: state.startWidth,
      startX: state.startX,
      currentX: event.clientX,
      alignFrac,
      minWidthPx: state.minWidthPx,
    });
    state.lastPercent = result.percent;
    if (result.clampedToMin) {
      opts.figure.setAttribute(RESIZE_BLOCKED_ATTR, 'true');
    } else {
      opts.figure.removeAttribute(RESIZE_BLOCKED_ATTR);
    }
    opts.onPreview(result.percent);
  };

  const onUp = (event: PointerEvent): void => {
    if (!state.active) return;
    state.active = false;
    opts.figure.removeAttribute(RESIZE_BLOCKED_ATTR);
    opts.handle.releasePointerCapture(event.pointerId);
    if (state.lastPercent !== undefined) opts.onCommit(state.lastPercent);
  };

  opts.handle.addEventListener('pointerdown', onDown);
  opts.handle.addEventListener('pointermove', onMove);
  opts.handle.addEventListener('pointerup', onUp);
  opts.handle.addEventListener('pointercancel', onUp);

  return () => {
    opts.handle.removeEventListener('pointerdown', onDown);
    opts.handle.removeEventListener('pointermove', onMove);
    opts.handle.removeEventListener('pointerup', onUp);
    opts.handle.removeEventListener('pointercancel', onUp);
  };
}
