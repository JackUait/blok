import { MAX_WIDTH_PERCENT, MIN_WIDTH_PERCENT } from './constants';

export type ResizeEdge = 'left' | 'right';

export interface ComputeWidthInput {
  edge: ResizeEdge;
  /** Width of the layout container in pixels */
  containerWidth: number;
  /** Pointer X relative to viewport */
  dragX: number;
  /** Container's left X relative to viewport — used to translate dragX to container-relative */
  originX: number;
}

export function clampPercent(value: number): number {
  if (value < MIN_WIDTH_PERCENT) return MIN_WIDTH_PERCENT;
  if (value > MAX_WIDTH_PERCENT) return MAX_WIDTH_PERCENT;
  return value;
}

/**
 * Compute new width percent given pointer position during edge drag.
 * Right-edge drag: width = relativeX / containerWidth.
 * Left-edge drag:  width = (containerWidth - relativeX) / containerWidth.
 */
export function computeWidthPercent(input: ComputeWidthInput): number {
  const relativeX = input.dragX - input.originX;
  const ratio = input.edge === 'right'
    ? relativeX / input.containerWidth
    : (input.containerWidth - relativeX) / input.containerWidth;
  return clampPercent(Math.round(ratio * 100));
}

export interface AttachResizeHandleOptions {
  handle: HTMLElement;
  container: HTMLElement;
  edge: ResizeEdge;
  onPreview(percent: number): void;
  onCommit(percent: number): void;
}

export function attachResizeHandle(opts: AttachResizeHandleOptions): () => void {
  let active = false;
  let lastPercent: number | undefined;

  const onDown = (event: PointerEvent): void => {
    active = true;
    opts.handle.setPointerCapture(event.pointerId);
    event.preventDefault();
  };

  const onMove = (event: PointerEvent): void => {
    if (!active) return;
    const rect = opts.container.getBoundingClientRect();
    const next = computeWidthPercent({
      edge: opts.edge,
      containerWidth: rect.width,
      dragX: event.clientX,
      originX: rect.left,
    });
    lastPercent = next;
    opts.onPreview(next);
  };

  const onUp = (event: PointerEvent): void => {
    if (!active) return;
    active = false;
    opts.handle.releasePointerCapture(event.pointerId);
    if (lastPercent !== undefined) opts.onCommit(lastPercent);
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
