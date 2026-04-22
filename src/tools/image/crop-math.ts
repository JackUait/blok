import type { ImageCrop } from '../../../types/tools/image';

export type Handle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';

export const FULL_RECT: ImageCrop = { x: 0, y: 0, w: 100, h: 100 };
const MIN = 5;

export function isFullRect(r: ImageCrop): boolean {
  return r.x === 0 && r.y === 0 && r.w === 100 && r.h === 100;
}

export function clampRect(r: ImageCrop): ImageCrop {
  const { x: rx, y: ry, w: rw, h: rh } = r;
  const w = Math.max(MIN, Math.min(100, rw));
  const h = Math.max(MIN, Math.min(100, rh));
  const x = Math.max(0, Math.min(100 - w, rx));
  const y = Math.max(0, Math.min(100 - h, ry));
  return { x, y, w, h };
}

export function resizeRect(
  start: ImageCrop,
  handle: Handle,
  dxPct: number,
  dyPct: number
): ImageCrop {
  const { x: sx, y: sy, w: sw, h: sh } = start;
  const hasW = handle.includes('w');
  const hasE = handle.includes('e');
  const hasN = handle.includes('n');
  const hasS = handle.includes('s');

  const startRight = sx + sw;
  const startBottom = sy + sh;

  const left = hasW
    ? Math.max(0, Math.min(startRight - MIN, sx + dxPct))
    : sx;
  const right = hasE
    ? Math.max(sx + MIN, Math.min(100, startRight + dxPct))
    : startRight;
  const top = hasN
    ? Math.max(0, Math.min(startBottom - MIN, sy + dyPct))
    : sy;
  const bottom = hasS
    ? Math.max(sy + MIN, Math.min(100, startBottom + dyPct))
    : startBottom;

  return { x: left, y: top, w: right - left, h: bottom - top };
}

/**
 * Given the current figure width% and the prev/new crop rectangles, return the
 * width% that keeps the figure's rendered HEIGHT roughly the same across the
 * aspect change. Prevents tall/skinny towers when a crop becomes much more
 * vertical (and runaway width when it becomes much more horizontal).
 *
 * Derivation: rendered_height = rendered_width / aspect. aspect for a cropped
 * figure is (w*NW)/(h*NH); across old/new crops the intrinsic factor NW/NH
 * cancels, so only the w/h ratio matters. "No crop" is equivalent to (100,100)
 * in percent-of-intrinsic terms (aspect_unit = 1) — natural dims still cancel.
 */
export function widthForAspectChange(
  oldWidth: number,
  oldCrop: ImageCrop | null | undefined,
  newCrop: ImageCrop | null | undefined
): number {
  const oldUnit = oldCrop ? oldCrop.w / oldCrop.h : 1;
  const newUnit = newCrop ? newCrop.w / newCrop.h : 1;
  if (!Number.isFinite(oldUnit) || !Number.isFinite(newUnit) || oldUnit <= 0 || newUnit <= 0) {
    return oldWidth;
  }
  const next = oldWidth * (newUnit / oldUnit);
  const clamped = Math.max(10, Math.min(100, next));
  return Math.round(clamped * 100) / 100;
}

export function applyRatio(
  rect: ImageCrop,
  ratio: number | null,
  handle?: Handle
): ImageCrop {
  if (ratio === null || !Number.isFinite(ratio) || ratio <= 0) return rect;
  const baseW = rect.w;
  const baseH = baseW / ratio;
  const w = baseH > rect.h ? rect.h * ratio : baseW;
  const h = baseH > rect.h ? rect.h : baseH;

  const hasW = handle?.includes('w') ?? false;
  const hasE = handle?.includes('e') ?? false;
  const hasN = handle?.includes('n') ?? false;
  const hasS = handle?.includes('s') ?? false;

  const cx = rect.x + rect.w / 2;
  const cy = rect.y + rect.h / 2;

  const pickX = (): number => {
    if (handle === undefined) return cx - w / 2;
    if (hasW && !hasE) return rect.x + rect.w - w;
    if (hasE && !hasW) return rect.x;

    return cx - w / 2;
  };

  const pickY = (): number => {
    if (handle === undefined) return cy - h / 2;
    if (hasN && !hasS) return rect.y + rect.h - h;
    if (hasS && !hasN) return rect.y;

    return cy - h / 2;
  };

  const x = pickX();
  const y = pickY();

  return clampRect({ x, y, w, h });
}
