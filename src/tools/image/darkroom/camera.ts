import type { ImageCrop } from '../../../../types/tools/image';
import { MIN } from '../crop-math';
import { clampCentre, coverScale } from '../geometry';
import { rubberBand } from '../spring';

export interface Size { w: number; h: number }
export interface Box { x: number; y: number; w: number; h: number }
export interface Point { x: number; y: number }
export interface Insets { top: number; right: number; bottom: number; left: number }

/** Photo point (u, v) in natural px sits at stage (tx + s·u, ty + s·v). */
export interface Camera { s: number; tx: number; ty: number }

export function rectAspect(r: ImageCrop, n: Size): number {
  return (r.w * n.w) / (r.h * n.h);
}

/** crop-math's applyRatio works in percent space; 16:9 in pixels is 16/9 · h/w there. */
export function percentRatio(pixelRatio: number, n: Size): number {
  return (pixelRatio * n.h) / n.w;
}

export function fitFrame(aspect: number, stage: Size, pad: Insets): Box {
  const availW = Math.max(1, stage.w - pad.left - pad.right);
  const availH = Math.max(1, stage.h - pad.top - pad.bottom);
  const w = Math.min(availW, availH * aspect);
  const h = w / aspect;

  return { x: pad.left + (availW - w) / 2, y: pad.top + (availH - h) / 2, w, h };
}

export function rectToCamera(r: ImageCrop, n: Size, frame: Box): Camera {
  const s = frame.w / ((r.w / 100) * n.w);

  return { s, tx: frame.x - (r.x / 100) * n.w * s, ty: frame.y - (r.y / 100) * n.h * s };
}

export function cameraToRect(c: Camera, n: Size, frame: Box): ImageCrop {
  return {
    x: ((frame.x - c.tx) / c.s / n.w) * 100,
    y: ((frame.y - c.ty) / c.s / n.h) * 100,
    w: (frame.w / c.s / n.w) * 100,
    h: (frame.h / c.s / n.h) * 100,
  };
}

export function rectToFrame(r: ImageCrop, n: Size, c: Camera): Box {
  return {
    x: c.tx + (r.x / 100) * n.w * c.s,
    y: c.ty + (r.y / 100) * n.h * c.s,
    w: (r.w / 100) * n.w * c.s,
    h: (r.h / 100) * n.h * c.s,
  };
}

/** `n` is the oriented size O; `theta` is the straighten turn in degrees. */
export function scaleLimits(n: Size, frame: Box, theta = 0): { min: number; max: number } {
  const min = coverScale(frame, n, theta);
  const max = Math.min(frame.w / ((MIN / 100) * n.w), frame.h / ((MIN / 100) * n.h));

  return { min, max: Math.max(min, max) };
}

/** Nearest camera at the same scale whose frame the turned content covers. */
const coveredPan = (c: Camera, n: Size, frame: Box, theta: number): Camera => {
  const centre = { x: (frame.x + frame.w / 2 - c.tx) / c.s, y: (frame.y + frame.h / 2 - c.ty) / c.s };
  const held = clampCentre(centre, { w: frame.w / c.s, h: frame.h / c.s }, n, theta);

  if (held === centre) return c;

  return { s: c.s, tx: frame.x + frame.w / 2 - held.x * c.s, ty: frame.y + frame.h / 2 - held.y * c.s };
};

const stretch = (v: number, rest: number, dimension: number): number => {
  const over = v - rest;

  return rest + Math.sign(over) * rubberBand(Math.abs(over), dimension);
};

export function clampCamera(c: Camera, n: Size, frame: Box, theta = 0): Camera {
  const { min, max } = scaleLimits(n, frame, theta);

  return coveredPan({ ...c, s: Math.min(max, Math.max(min, c.s)) }, n, frame, theta);
}

export function rubberCamera(c: Camera, n: Size, frame: Box, theta = 0): Camera {
  const rest = coveredPan(c, n, frame, theta);

  return { s: c.s, tx: stretch(c.tx, rest.tx, frame.w), ty: stretch(c.ty, rest.ty, frame.h) };
}

export function zoomAt(c: Camera, factor: number, p: Point, n: Size, frame: Box, theta = 0): Camera {
  if (!Number.isFinite(factor) || factor <= 0) return c;
  const { min, max } = scaleLimits(n, frame, theta);
  const s = Math.min(max, Math.max(min, c.s * factor));
  const k = s / c.s;

  return clampCamera({ s, tx: p.x - (p.x - c.tx) * k, ty: p.y - (p.y - c.ty) * k }, n, frame, theta);
}
