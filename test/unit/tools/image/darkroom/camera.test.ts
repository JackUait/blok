import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { applyRatio, FULL_RECT } from '../../../../../src/tools/image/crop-math';
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
