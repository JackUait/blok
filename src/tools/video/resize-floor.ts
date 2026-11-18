import { MIN_HEIGHT_PX, MIN_WIDTH_PX } from './constants';

const FALLBACK_SHAPE = 16 / 9;

/**
 * The narrowest a player of this shape (width / height) may be dragged: wide
 * enough to stay MIN_HEIGHT_PX tall, and never under MIN_WIDTH_PX.
 */
export function floorForShape(shape: number): number {
  const safe = Number.isFinite(shape) && shape > 0 ? shape : FALLBACK_SHAPE;

  return Math.max(MIN_WIDTH_PX, Math.ceil(MIN_HEIGHT_PX * safe));
}

/** "16 / 9" or "1.5", as the block writes it on the frame. */
function declaredShape(value: string): number {
  const [width, height = '1'] = value.split('/').map((part) => part.trim());

  return Number(width) / Number(height);
}

/**
 * The resize floor for the frame as it is drawn. Before it has a size, the
 * shape the block declared on it stands in.
 */
export function resizeFloorPx(media: HTMLElement): number {
  const { width, height } = media.getBoundingClientRect();

  return floorForShape(width > 0 && height > 0 ? width / height : declaredShape(media.style.aspectRatio));
}
