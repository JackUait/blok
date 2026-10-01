import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { applyRatio, FULL_RECT } from '../../../../../src/tools/image/crop-math';
import { coverCrop, coverScale } from '../../../../../src/tools/image/geometry';
import {
  cameraToRect, clampCamera, fitFrame, percentRatio, rectAspect, rectToCamera,
  rectToFrame, rubberCamera, scaleLimits, zoomAt,
} from '../../../../../src/tools/image/darkroom/camera';

const N = { w: 800, h: 534 };
const STAGE = { w: 1200, h: 800 };
const PAD = { top: 72, right: 32, bottom: 96, left: 32 };

describe('darkroom camera', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('1:1 on a non-square photo is a square in pixels', () => {
    const square = applyRatio(FULL_RECT, percentRatio(1, N));

    expect(rectAspect(square, N)).toBeCloseTo(1, 6);
    expect(square.h).toBe(100);
  });

  it('fits the frame to the stage at the crop aspect, centred inside the insets', () => {
    const f = fitFrame(16 / 9, STAGE, PAD);

    expect(f.w / f.h).toBeCloseTo(16 / 9, 6);
    expect(f.x + f.w / 2).toBeCloseTo(PAD.left + (STAGE.w - PAD.left - PAD.right) / 2, 6);
    expect(f.w <= STAGE.w - PAD.left - PAD.right + 1e-9).toBe(true);
    expect(f.h <= STAGE.h - PAD.top - PAD.bottom + 1e-9).toBe(true);
  });

  it.each([
    { x: 0, y: 0, w: 100, h: 100 },
    { x: 10, y: 20, w: 50, h: 30 },
    { x: 94, y: 94, w: 6, h: 6 },
  ])('rect → camera → rect round-trips %o', (r) => {
    const frame = fitFrame(rectAspect(r, N), STAGE, PAD);
    const back = cameraToRect(rectToCamera(r, N, frame), N, frame);

    expect(back.x).toBeCloseTo(r.x, 6);
    expect(back.y).toBeCloseTo(r.y, 6);
    expect(back.w).toBeCloseTo(r.w, 6);
    expect(back.h).toBeCloseTo(r.h, 6);
  });

  it('rectToFrame places the rect where the camera shows it', () => {
    const r = { x: 10, y: 20, w: 50, h: 30 };
    const frame = fitFrame(rectAspect(r, N), STAGE, PAD);
    const placed = rectToFrame(r, N, rectToCamera(r, N, frame));

    expect(placed.x).toBeCloseTo(frame.x, 6);
    expect(placed.w).toBeCloseTo(frame.w, 6);
  });

  it('zoom-out stops where the photo still covers the frame; zoom-in stops at a 5% crop', () => {
    const frame = fitFrame(rectAspect(FULL_RECT, N), STAGE, PAD);
    const { min, max } = scaleLimits(N, frame);
    const cam = rectToCamera(FULL_RECT, N, frame);

    expect(min).toBeCloseTo(cam.s, 6);
    expect(cameraToRect({ ...cam, s: max }, N, frame).w).toBeCloseTo(5, 6);
  });

  it('zoomAt keeps the image point under the pointer fixed', () => {
    const frame = fitFrame(rectAspect(FULL_RECT, N), STAGE, PAD);
    const cam = rectToCamera(FULL_RECT, N, frame);
    const p = { x: frame.x + frame.w * 0.25, y: frame.y + frame.h * 0.5 };
    const z = zoomAt(cam, 2, p, N, frame);
    const imageU = (p.x - cam.tx) / cam.s;

    expect((p.x - z.tx) / z.s).toBeCloseTo(imageU, 6);
    expect(z.s).toBeCloseTo(cam.s * 2, 6);
  });

  it.each([0 / 0, 0, -1, Infinity])('zoomAt ignores a broken factor %s', (factor) => {
    const frame = fitFrame(rectAspect(FULL_RECT, N), STAGE, PAD);
    const cam = rectToCamera(FULL_RECT, N, frame);

    expect(zoomAt(cam, factor, { x: 10, y: 10 }, N, frame)).toEqual(cam);
  });

  it('clampCamera never leaves an empty edge inside the frame', () => {
    const frame = fitFrame(rectAspect(FULL_RECT, N), STAGE, PAD);
    const cam = rectToCamera(FULL_RECT, N, frame);
    const c = clampCamera({ ...cam, tx: cam.tx + 500 }, N, frame);

    expect(c.tx).toBeCloseTo(frame.x, 6);
  });

  it('rubberCamera stretches past the edge by less than the push', () => {
    const frame = fitFrame(rectAspect(FULL_RECT, N), STAGE, PAD);
    const cam = rectToCamera(FULL_RECT, N, frame);
    const r = rubberCamera({ ...cam, tx: frame.x + 200 }, N, frame);

    expect(r.tx).toBeGreaterThan(frame.x);
    expect(r.tx).toBeLessThan(frame.x + 200);
  });
});

describe('darkroom camera with straighten', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // The frame (stage px) seen through the camera, turned back into O's un-turned content.
  const covered = (cam: { s: number; tx: number; ty: number }, frame: { x: number; y: number; w: number; h: number }, o: { w: number; h: number }, theta: number): boolean => {
    const t = (theta * Math.PI) / 180;
    const corners = [[frame.x, frame.y], [frame.x + frame.w, frame.y], [frame.x, frame.y + frame.h], [frame.x + frame.w, frame.y + frame.h]];

    return corners.every(([sx, sy]) => {
      const dx = (sx - cam.tx) / cam.s - o.w / 2;
      const dy = (sy - cam.ty) / cam.s - o.h / 2;
      const lx = dx * Math.cos(t) + dy * Math.sin(t) + o.w / 2;
      const ly = -dx * Math.sin(t) + dy * Math.cos(t) + o.h / 2;

      return lx >= -1e-6 && lx <= o.w + 1e-6 && ly >= -1e-6 && ly <= o.h + 1e-6;
    });
  };

  it.each([10, -10, 45, -45])('min scale is the cover scale at %s degrees', (theta) => {
    const frame = fitFrame(16 / 9, STAGE, PAD);

    expect(scaleLimits(N, frame, theta).min).toBeCloseTo(coverScale(frame, N, theta), 9);
  });

  it.each([10, -25, 45])('clampCamera keeps the frame covered by content turned %s degrees', (theta) => {
    const frame = fitFrame(rectAspect({ x: 20, y: 20, w: 50, h: 50 }, N), STAGE, PAD);
    const cam = rectToCamera({ x: 20, y: 20, w: 50, h: 50 }, N, frame);
    const pushed = clampCamera({ ...cam, s: cam.s * 0.5, tx: cam.tx + 900, ty: cam.ty - 700 }, N, frame, theta);

    expect(covered(pushed, frame, N, theta)).toBe(true);
  });

  it('clampCamera leaves a covered camera alone', () => {
    const r = coverCrop({ x: 30, y: 30, w: 30, h: 30 }, N, 10);
    const frame = fitFrame(rectAspect(r, N), STAGE, PAD);
    const cam = rectToCamera(r, N, frame);
    const c = clampCamera(cam, N, frame, 10);

    expect(c.s).toBeCloseTo(cam.s, 9);
    expect(c.tx).toBeCloseTo(cam.tx, 9);
    expect(c.ty).toBeCloseTo(cam.ty, 9);
  });

  it('rubberCamera stretches past the turned edge by less than the push and springs back covered', () => {
    const r = coverCrop(FULL_RECT, N, 15);
    const frame = fitFrame(rectAspect(r, N), STAGE, PAD);
    const cam = rectToCamera(r, N, frame);
    const push = { ...cam, tx: cam.tx + 300 };
    const rubber = rubberCamera(push, N, frame, 15);
    const rest = clampCamera(rubber, N, frame, 15);

    expect(rubber.tx).toBeGreaterThan(rest.tx);
    expect(rubber.tx).toBeLessThan(push.tx);
    expect(covered(rest, frame, N, 15)).toBe(true);
  });

  it('zoomAt cannot zoom out past the turned cover', () => {
    const r = coverCrop(FULL_RECT, N, 20);
    const frame = fitFrame(rectAspect(r, N), STAGE, PAD);
    const cam = rectToCamera(r, N, frame);
    const z = zoomAt(cam, 0.1, { x: frame.x, y: frame.y }, N, frame, 20);

    expect(z.s).toBeCloseTo(coverScale(frame, N, 20), 9);
    expect(covered(z, frame, N, 20)).toBe(true);
  });

  it('a rotated photo round-trips through its oriented size', () => {
    const o = { w: N.h, h: N.w };
    const r = { x: 10, y: 15, w: 40, h: 30 };
    const frame = fitFrame(rectAspect(r, o), STAGE, PAD);
    const back = cameraToRect(rectToCamera(r, o, frame), o, frame);

    expect(frame.w / frame.h).toBeCloseTo((0.4 * N.h) / (0.3 * N.w), 9);
    expect(back.x).toBeCloseTo(r.x, 9);
    expect(back.h).toBeCloseTo(r.h, 9);
  });
});
