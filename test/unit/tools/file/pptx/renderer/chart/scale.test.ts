// Derived from @aiden0z/pptx-renderer 1.4.0 (Apache-2.0); modified for Blok. See NOTICE.
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import {
  areaValueAxis,
  autoValueAxis,
  desiredTickCount,
  niceAxisInterval,
  niceAxisMax,
} from '../../../../../../../src/tools/file/pptx/renderer/chart/scale';

describe('chart value axis scale', () => {
  beforeEach(() => { vi.clearAllMocks(); });
  afterEach(() => { vi.restoreAllMocks(); });

  it('rounds the major unit to 1, 2 or 5 times a power of ten', () => {
    expect(niceAxisInterval(61, 28, 10)).toBe(10);
    expect(niceAxisInterval(1520, 300, 8)).toBe(200);
    expect(niceAxisInterval(0, 0, 8)).toBe(1);
  });

  it('puts the maximum one step above the data', () => {
    expect(niceAxisMax(60, 0, 10)).toBe(70);
    expect(niceAxisMax(61, 0, 10)).toBe(70);
  });

  it('starts at zero with one tick of headroom (oracle 0001, 0007)', () => {
    expect(autoValueAxis({ values: [45, 61, 28], desiredTicks: 10 })).toEqual({ min: 0, max: 70, major: 10 });
    expect(autoValueAxis({ values: [1200, 1520, 300], desiredTicks: 8 })).toEqual({ min: 0, max: 1600, major: 200 });
  });

  it('skips the extra tick when only one tick fits', () => {
    expect(autoValueAxis({ values: [2, 4, 3], desiredTicks: 1 })).toEqual({ min: 0, max: 5, major: 5 });
  });

  it('adds a tick when the data sits within a quarter step of the top', () => {
    expect(autoValueAxis({ values: [120, 135, 148], desiredTicks: 8 })).toEqual({ min: 0, max: 160, major: 20 });
  });

  it('goes below zero for negative data', () => {
    const axis = autoValueAxis({ values: [-15, 30], desiredTicks: 10 });

    expect(axis.min).toBeLessThan(-15);
    expect(axis.max).toBeGreaterThan(30);
    expect(Math.abs(axis.min % axis.major)).toBe(0);
  });

  it('starts above zero when the minimum is at least 5/6 of the maximum', () => {
    expect(autoValueAxis({ values: [2310, 2205, 2140, 2480, 2390, 2275], desiredTicks: 8 }))
      .toEqual({ min: 1950, max: 2500, major: 50 });
    expect(autoValueAxis({ values: [4120, 3480], desiredTicks: 10 })).toEqual({ min: 3100, max: 4200, major: 100 });
  });

  it('stays at zero below the 5/6 line, for stacked data and for constant data', () => {
    expect(autoValueAxis({ values: [82, 85, 79, 91, 88, 94, 87, 96], desiredTicks: 8 }).min).toBe(0);
    expect(autoValueAxis({ values: [4790, 4595], desiredTicks: 8, stacked: true }).min).toBe(0);
    expect(autoValueAxis({ values: [2140, 2140], desiredTicks: 8 }).min).toBe(0);
  });

  it('keeps explicit min, max and major unit from the axis', () => {
    expect(autoValueAxis({ values: [5, 50], desiredTicks: 8, min: 0, max: 100, major: 25 }))
      .toEqual({ min: 0, max: 100, major: 25 });
    expect(autoValueAxis({ values: [5, 50], desiredTicks: 10, max: 200 })).toMatchObject({ min: 0, max: 200 });
  });

  it('picks a coarser major unit when the axis fixes both ends (oracle 0022)', () => {
    expect(autoValueAxis({ values: [-3, 5], desiredTicks: 10, min: -4, max: 6 })).toEqual({ min: -4, max: 6, major: 2 });
  });

  it('gives area charts eight ticks and a full step of headroom when stacked (oracle 0014, 0015)', () => {
    expect(areaValueAxis({ values: [90, 105, 110, 115], desiredTicks: 3, stacked: true })).toEqual({ min: 0, max: 140, major: 20 });
    expect(areaValueAxis({ values: [80, 95, 110, 125, 148, 60, 91], desiredTicks: 3 })).toEqual({ min: 0, max: 160, major: 20 });
  });

  it('never returns a zero or negative span', () => {
    const axis = autoValueAxis({ values: [], desiredTicks: 8 });

    expect(axis.max).toBeGreaterThan(axis.min);
    expect(axis.major).toBeGreaterThan(0);
  });

  it('limits the tick count so labels do not overlap', () => {
    expect(desiredTickCount(182 - 64, 24, true)).toBe(1);
    expect(desiredTickCount(500, 24, true)).toBe(8);
    expect(desiredTickCount(2000, 13, true)).toBe(10);
    expect(desiredTickCount(2000, 13, false)).toBe(8);
  });
});
