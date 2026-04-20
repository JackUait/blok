import type { ImageAlignment } from '../../../types/tools/image';
import { MAX_WIDTH_PERCENT, MIN_WIDTH_PERCENT } from './constants';

export type ResizeEdge = 'left' | 'right';

export function alignmentFraction(alignment: ImageAlignment): number {
  if (alignment === 'left') return 0;
  if (alignment === 'right') return 1;
  return 0.5;
}

/**
 * Compensation translate that keeps the opposite edge visually pinned during
 * resize. Without it, a centered figure grows symmetrically and the user sees
 * the "other side" extend when they drag a single handle.
 */
export function computeTranslateXPx(
  deltaWpx: number,
  edge: ResizeEdge,
  alignFrac: number
): number {
  const raw = edge === 'right'
    ? deltaWpx * alignFrac
    : -deltaWpx * (1 - alignFrac);
  return raw === 0 ? 0 : raw;
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
}

export function clampPercent(value: number): number {
  if (value < MIN_WIDTH_PERCENT) return MIN_WIDTH_PERCENT;
  if (value > MAX_WIDTH_PERCENT) return MAX_WIDTH_PERCENT;
  return value;
}

/**
 * Delta-based width: pin the figure's starting width, then grow/shrink by
 * the pointer travel since pointerdown so the image never jumps on first move.
 */
export function computeWidthPercent(input: ComputeWidthInput): number {
  if (input.containerWidth <= 0) return clampPercent(0);
  const deltaX = input.currentX - input.startX;
  const signedDelta = input.edge === 'right' ? deltaX : -deltaX;
  const nextWidth = input.startWidth + signedDelta;
  return clampPercent(Math.round((nextWidth / input.containerWidth) * 100));
}

export interface AttachResizeHandleOptions {
  handle: HTMLElement;
  /** Element being resized — used to read its starting width */
  figure: HTMLElement;
  /** Layout container — used as the 100% reference */
  container: HTMLElement;
  edge: ResizeEdge;
  /** Figure alignment — drives compensation so the opposite edge stays pinned */
  alignment?: ImageAlignment;
  onPreview(percent: number): void;
  onCommit(percent: number): void;
}

interface DragState {
  active: boolean;
  startX: number;
  startWidth: number;
  containerWidth: number;
  startTranslate: number;
  lastPercent: number | undefined;
}

function parseTranslateXPx(transform: string): number {
  const match = /translateX\((-?[\d.]+)px\)/.exec(transform);
  return match ? parseFloat(match[1]) : 0;
}

export function attachResizeHandle(opts: AttachResizeHandleOptions): () => void {
  const state: DragState = {
    active: false,
    startX: 0,
    startWidth: 0,
    containerWidth: 0,
    startTranslate: 0,
    lastPercent: undefined,
  };

  const alignFrac = alignmentFraction(opts.alignment ?? 'center');
  const { figure } = opts;

  const onDown = (event: PointerEvent): void => {
    state.active = true;
    state.startX = event.clientX;
    state.startTranslate = parseTranslateXPx(figure.style.transform);
    const rect = opts.figure.getBoundingClientRect();
    state.startWidth = rect.width;
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
    });
    state.lastPercent = next;
    const clampedWidthPx = (next / 100) * state.containerWidth;
    const deltaW = clampedWidthPx - state.startWidth;
    const tx = state.startTranslate + computeTranslateXPx(deltaW, opts.edge, alignFrac);
    figure.style.transform = `translateX(${tx}px)`;
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
