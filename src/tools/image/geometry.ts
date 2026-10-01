import type { ImageCrop, ImageData, ImageRotation } from '../../../types/tools/image';
import type { Point, Size } from './darkroom/camera';

export interface Geometry { rotation: ImageRotation; flipX: boolean; straighten: number }

export const IDENTITY: Geometry = { rotation: 0, flipX: false, straighten: 0 };

const ROTATIONS: readonly ImageRotation[] = [0, 90, 180, 270];
const MAX_STRAIGHTEN = 45;
const EPS = 1e-9;

const isRotation = (v: unknown): v is ImageRotation => ROTATIONS.some((r) => r === v);

/** Adding 0 turns -0 into 0, so saved data never carries "-0". */
const noNegZero = (v: number): number => v + 0;

const rad = (deg: number): number => (deg * Math.PI) / 180;

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

export function readGeometry(data: Partial<ImageData>): Geometry {
  const { rotation, flipX, straighten } = data;
  const turn = typeof straighten === 'number' && Number.isFinite(straighten)
    ? noNegZero(Math.round(clamp(straighten, -MAX_STRAIGHTEN, MAX_STRAIGHTEN) * 10) / 10)
    : 0;

  return { rotation: isRotation(rotation) ? rotation : 0, flipX: flipX === true, straighten: turn };
}

export function geometryFields(g: Geometry): Pick<ImageData, 'rotation' | 'flipX' | 'straighten'> {
  return {
    ...(g.rotation !== 0 && { rotation: g.rotation }),
    ...(g.flipX && { flipX: true }),
    ...(g.straighten !== 0 && { straighten: g.straighten }),
  };
}

export function isIdentity(g: Geometry): boolean {
  return g.rotation === 0 && !g.flipX && g.straighten === 0;
}

export function orientedSize(n: Size, g: Geometry): Size {
  return g.rotation % 180 === 0 ? { w: n.w, h: n.h } : { w: n.h, h: n.w };
}

const withShape = (crop: ImageCrop, rect: Omit<ImageCrop, 'shape'>): ImageCrop =>
  crop.shape === undefined ? rect : { ...rect, shape: crop.shape };

/** View-space turn: rotate the result 90° counter-clockwise. */
export function rotateLeft(g: Geometry, crop: ImageCrop): { g: Geometry; crop: ImageCrop } {
  const turned = (g.rotation + 270) % 360;
  const rotation = isRotation(turned) ? turned : 0;

  return {
    g: { ...g, rotation },
    crop: withShape(crop, { x: crop.y, y: 100 - crop.x - crop.w, w: crop.h, h: crop.w }),
  };
}

/** View-space mirror left↔right. A mirror flips the turn direction, so rotation and straighten negate. */
export function flipHorizontal(g: Geometry, crop: ImageCrop): { g: Geometry; crop: ImageCrop } {
  const mirrored = (360 - g.rotation) % 360;
  const rotation = isRotation(mirrored) ? mirrored : 0;

  return {
    g: { rotation, flipX: !g.flipX, straighten: noNegZero(-g.straighten) },
    crop: withShape(crop, { x: 100 - crop.x - crop.w, y: crop.y, w: crop.w, h: crop.h }),
  };
}

/** Bounding box of a frame turned by theta. A rect fits an axis-aligned box iff its bounding box does. */
const turnedExtent = (frame: Size, theta: number): Size => {
  const c = Math.abs(Math.cos(rad(theta)));
  const s = Math.abs(Math.sin(rad(theta)));

  return { w: frame.w * c + frame.h * s, h: frame.w * s + frame.h * c };
};

/** Min camera scale s (stage px per O px) so a frame of `frame` stage px fits inside O turned by theta (degrees). */
export function coverScale(frame: Size, o: Size, theta: number): number {
  const ext = turnedExtent(frame, theta);

  return Math.max(ext.w / o.w, ext.h / o.h);
}

/** Centre offset from O's centre, in the image's own (un-turned) axes. */
const toLocal = (d: Point, theta: number): Point => {
  const t = rad(theta);

  return { x: d.x * Math.cos(t) + d.y * Math.sin(t), y: -d.x * Math.sin(t) + d.y * Math.cos(t) };
};

const fromLocal = (d: Point, theta: number): Point => toLocal(d, -theta);

/** How far the centre may sit from O's centre in local axes. */
const localSlack = (frame: Size, o: Size, theta: number): Size => {
  const ext = turnedExtent(frame, theta);

  return { w: Math.max(0, (o.w - ext.w) / 2), h: Math.max(0, (o.h - ext.h) / 2) };
};

/** Clamp a frame centre (O px, origin = O's top-left) so the frame (O px), turned back by -theta, stays inside O. */
export function clampCentre(c: Point, frame: Size, o: Size, theta: number): Point {
  const slack = localSlack(frame, o, theta);
  const local = toLocal({ x: c.x - o.w / 2, y: c.y - o.h / 2 }, theta);
  const back = fromLocal({ x: clamp(local.x, -slack.w, slack.w), y: clamp(local.y, -slack.h, slack.h) }, theta);

  if (Math.abs(back.x + o.w / 2 - c.x) < EPS && Math.abs(back.y + o.h / 2 - c.y) < EPS) return c;

  return { x: back.x + o.w / 2, y: back.y + o.h / 2 };
}

/** Fit a crop inside the turned content (shrinks about its centre, keeps aspect). */
export function coverCrop(crop: ImageCrop, o: Size, theta: number): ImageCrop {
  const frame: Size = { w: (crop.w / 100) * o.w, h: (crop.h / 100) * o.h };
  const ext = turnedExtent(frame, theta);
  const k = Math.min(1, o.w / ext.w, o.h / ext.h);
  const fitted: Size = { w: frame.w * k, h: frame.h * k };
  const want: Point = { x: ((crop.x + crop.w / 2) / 100) * o.w - o.w / 2, y: ((crop.y + crop.h / 2) / 100) * o.h - o.h / 2 };
  const turnSlack = localSlack(fitted, o, theta);
  const boxSlack: Size = { w: Math.max(0, (o.w - fitted.w) / 2), h: Math.max(0, (o.h - fitted.h) / 2) };

  const fits = (d: Point): boolean => {
    const l = toLocal(d, theta);

    return Math.abs(l.x) <= turnSlack.w + EPS && Math.abs(l.y) <= turnSlack.h + EPS
      && Math.abs(d.x) <= boxSlack.w + EPS && Math.abs(d.y) <= boxSlack.h + EPS;
  };

  if (k === 1 && fits(want)) return crop;

  const turned = clampCentre({ x: want.x + o.w / 2, y: want.y + o.h / 2 }, fitted, o, theta);
  const inBox: Point = {
    x: clamp(turned.x - o.w / 2, -boxSlack.w, boxSlack.w),
    y: clamp(turned.y - o.h / 2, -boxSlack.h, boxSlack.h),
  };
  // Both limits are symmetric boxes about O's centre, so pulling toward it keeps the box clamp
  // and finds the farthest point inside the turned limit on that line.
  const local = toLocal(inBox, theta);
  const t = Math.min(
    1,
    Math.abs(local.x) > EPS ? turnSlack.w / Math.abs(local.x) : 1,
    Math.abs(local.y) > EPS ? turnSlack.h / Math.abs(local.y) : 1
  );
  const centre: Point = { x: inBox.x * t + o.w / 2, y: inBox.y * t + o.h / 2 };
  const w = (fitted.w / o.w) * 100;
  const h = (fitted.h / o.h) * 100;

  return withShape(crop, { x: (centre.x / o.w) * 100 - w / 2, y: (centre.y / o.h) * 100 - h / 2, w, h });
}

/** Rounds to 4 decimals so styles carry no float noise. */
const fmt = (v: number): string => String(noNegZero(Math.round(v * 1e4) / 1e4));

/** CSS for the <img> inside an O-sized plane: size %, offset %, transform. */
export function planeImageStyle(
  n: Size,
  g: Geometry
): { width: string; height: string; left: string; top: string; transform: string } {
  const o = orientedSize(n, g);
  const w = (n.w / o.w) * 100;
  const h = (n.h / o.h) * 100;
  // CSS applies transforms right to left, so the mirror runs before the turn.
  const mirror = g.flipX ? ' scaleX(-1)' : '';

  return {
    width: `${fmt(w)}%`,
    height: `${fmt(h)}%`,
    left: `${fmt((100 - w) / 2)}%`,
    top: `${fmt((100 - h) / 2)}%`,
    transform: `rotate(${fmt(g.rotation + g.straighten)}deg)${mirror}`,
  };
}
