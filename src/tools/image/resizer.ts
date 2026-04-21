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
}

export function clampPercent(value: number): number {
  if (value < MIN_WIDTH_PERCENT) return MIN_WIDTH_PERCENT;
  if (value > MAX_WIDTH_PERCENT) return MAX_WIDTH_PERCENT;
  return value;
}

/**
 * Pointer follows the dragged edge; width grows around the alignment anchor.
 * Center (frac 0.5) → both edges move → width delta = 2× pointer delta.
 * Edge-anchored (frac 0 or 1) → single side grows → width delta = 1× pointer delta.
 */
export function computeWidthPercent(input: ComputeWidthInput): number {
  if (input.containerWidth <= 0) return clampPercent(0);
  const frac = input.alignFrac ?? 0;
  const denom = input.edge === 'right' ? 1 - frac : frac;
  const multiplier = denom === 0 ? 1 : 1 / denom;
  const deltaX = input.currentX - input.startX;
  const signedDelta = multiplier * (input.edge === 'right' ? deltaX : -deltaX);
  const nextWidth = input.startWidth + signedDelta;
  return clampPercent(Math.round((nextWidth / input.containerWidth) * 100));
}

export interface AttachResizeHandleOptions {
  handle: HTMLElement;
  figure: HTMLElement;
  container: HTMLElement;
  edge: ResizeEdge;
  alignment?: ImageAlignment;
  onPreview(percent: number): void;
  onCommit(percent: number): void;
}

interface DragState {
  active: boolean;
  startX: number;
  startWidth: number;
  containerWidth: number;
  lastPercent: number | undefined;
}

export function attachResizeHandle(opts: AttachResizeHandleOptions): () => void {
  const state: DragState = {
    active: false,
    startX: 0,
    startWidth: 0,
    containerWidth: 0,
    lastPercent: undefined,
  };

  const alignFrac = alignmentFraction(opts.alignment ?? 'center');

  const onDown = (event: PointerEvent): void => {
    state.active = true;
    state.startX = event.clientX;
    state.startWidth = opts.figure.getBoundingClientRect().width;
    state.containerWidth = opts.container.getBoundingClientRect().width;
    state.lastPercent = undefined;
    opts.handle.setPointerCapture(event.pointerId);
    event.preventDefault();
  };

  const onMove = (event: PointerEvent): void => {
    if (!state.active) return;
    const next = computeWidthPercent({
      edge: opts.edge,
      containerWidth: state.containerWidth,
      startWidth: state.startWidth,
      startX: state.startX,
      currentX: event.clientX,
      alignFrac,
    });
    state.lastPercent = next;
    opts.onPreview(next);
  };

  const onUp = (event: PointerEvent): void => {
    if (!state.active) return;
    state.active = false;
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
