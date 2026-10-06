import { describe, expect, it } from 'vitest';
import { flatten, luminanceGrid, pickTone, regionLuminance, relativeLuminance, type Rgb } from '../../../../src/tools/image/tone';

const WHITE: Rgb = { r: 255, g: 255, b: 255 };
const BLACK: Rgb = { r: 0, g: 0, b: 0 };

type Px = [number, number, number, number];

const pixels = (rows: Px[][]): Uint8ClampedArray => new Uint8ClampedArray(rows.flat().flat());

describe('tone', () => {
  it('a light area gets paper and a dark one graphite', () => {
    expect(pickTone(relativeLuminance({ r: 240, g: 240, b: 240 }))).toBe('paper');
    expect(pickTone(relativeLuminance({ r: 20, g: 20, b: 20 }))).toBe('graphite');
  });

  it('switches where paper and graphite have equal contrast', () => {
    const paper = relativeLuminance(WHITE);
    const graphite = relativeLuminance({ r: 0x25, g: 0x25, b: 0x25 });
    const t = Math.sqrt((paper + 0.05) * (graphite + 0.05)) - 0.05;

    expect(t).toBeCloseTo(0.218, 3);
    expect(pickTone(t + 0.001)).toBe('paper');
    expect(pickTone(t - 0.001)).toBe('graphite');
  });

  it('a transparent pixel takes the colour of the page behind it', () => {
    const clear = pixels([[[255, 255, 255, 0]]]);

    expect(luminanceGrid(clear, 1, 1, BLACK).luminance[0]).toBeCloseTo(0, 5);
    expect(luminanceGrid(clear, 1, 1, WHITE).luminance[0]).toBeCloseTo(1, 5);
  });

  it('sky over ground: the top strip and the bottom corner read differently', () => {
    const W: Px = [255, 255, 255, 255];
    const K: Px = [10, 10, 10, 255];
    const grid = luminanceGrid(pixels([[W, W, W, W], [W, W, W, W], [K, K, K, K], [K, K, K, K]]), 4, 4, WHITE);

    const top = regionLuminance(grid, { x: 0.25, y: 0, w: 0.5, h: 0.2 });
    const corner = regionLuminance(grid, { x: 0, y: 0.8, w: 0.3, h: 0.2 });

    expect(top === null ? null : pickTone(top)).toBe('paper');
    expect(corner === null ? null : pickTone(corner)).toBe('graphite');
  });

  it('averages every cell the region covers', () => {
    const W: Px = [255, 255, 255, 255];
    const K: Px = [0, 0, 0, 255];
    const grid = luminanceGrid(pixels([[W, K]]), 2, 1, WHITE);

    expect(regionLuminance(grid, { x: 0, y: 0, w: 1, h: 1 })).toBeCloseTo(0.5, 5);
    expect(regionLuminance(grid, { x: 0, y: 0, w: 0.5, h: 1 })).toBeCloseTo(1, 5);
    expect(regionLuminance(grid, { x: 0.5, y: 0, w: 0.5, h: 1 })).toBeCloseTo(0, 5);
  });

  it('a region with no size or outside the picture reads nothing', () => {
    const grid = luminanceGrid(pixels([[[255, 255, 255, 255]]]), 1, 1, WHITE);

    expect(regionLuminance(grid, { x: 0, y: 0, w: 0, h: 1 })).toBeNull();
    expect(regionLuminance(grid, { x: 1.2, y: 0, w: 0.1, h: 1 })).toBeNull();
    expect(regionLuminance(grid, { x: 0, y: -0.5, w: 1, h: 0.4 })).toBeNull();
  });

  it('a faint white card over a near-black page still reads as dark', () => {
    const page = flatten([{ r: 255, g: 255, b: 255, a: 0.04 }], { r: 12, g: 12, b: 12 });

    expect(pickTone(relativeLuminance(page))).toBe('graphite');
  });

  it('stacks layers innermost on top', () => {
    const red = { r: 255, g: 0, b: 0, a: 1 };
    const blueHalf = { r: 0, g: 0, b: 255, a: 0.5 };

    expect(flatten([blueHalf, red], WHITE)).toEqual({ r: 127.5, g: 0, b: 127.5 });
    // An opaque layer on top hides everything under it.
    expect(flatten([red, blueHalf], WHITE)).toEqual({ r: 255, g: 0, b: 0 });
  });

  it('with no painted layer the base shows through', () => {
    expect(flatten([], BLACK)).toEqual(BLACK);
  });
});
