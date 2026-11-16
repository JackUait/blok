import { afterEach, expect, it, vi } from 'vitest';
import { forEachRenderSlice } from '../../../../src/components/utils/render-slices';

afterEach(() => vi.unstubAllGlobals());

it('yields between bounded batches and preserves document order', async () => {
  const visited: number[] = [];
  const checkpoints: number[] = [];
  vi.stubGlobal('scheduler', {
    yield: () => {
      checkpoints.push(visited.length);
      return Promise.resolve();
    },
  });
  await forEachRenderSlice(Array.from({ length: 70 }, (_, i) => i), value => {
    visited.push(value);
  });
  expect(visited).toEqual(Array.from({ length: 70 }, (_, i) => i));
  expect(checkpoints.length).toBeGreaterThanOrEqual(2);
  expect(checkpoints[0]).toBeLessThanOrEqual(25);
  expect(checkpoints.at(-1)).toBeLessThan(70);
});

it('stops after cancellation at a yield boundary', async () => {
  const visited: number[] = [];
  const state = { cancelled: false };
  vi.stubGlobal('scheduler', {
    yield: () => {
      state.cancelled = true;
      return Promise.resolve();
    },
  });
  await forEachRenderSlice(Array.from({ length: 80 }, (_, i) => i), value => {
    visited.push(value);
  }, () => state.cancelled);
  expect(visited.length).toBeGreaterThan(0);
  expect(visited.length).toBeLessThanOrEqual(25);
});

it('falls back to a timer on browsers without scheduler.yield', async () => {
  vi.stubGlobal('scheduler', undefined);
  const visited: number[] = [];
  await forEachRenderSlice(Array.from({ length: 26 }, (_, i) => i), value => {
    visited.push(value);
  });
  expect(visited).toHaveLength(26);
});
