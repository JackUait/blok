import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { blocksWithMarker, createCleanup, waitUntil, waitForStable } from '../../evals/agent/runner/live-room-helpers';

describe('live room helpers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('waitForStable returns once two reads in a row match', async () => {
    const reads = ['a', 'b', 'b'];
    const read = vi.fn(async () => reads.shift() ?? 'b');

    await expect(waitForStable(read, { intervalMs: 1, timeoutMs: 1000 })).resolves.toBe('b');
    expect(read).toHaveBeenCalledTimes(3);
  });

  it('waitForStable gives up loudly instead of returning a moving value', async () => {
    let n = 0;

    await expect(waitForStable(async () => n++, { intervalMs: 1, timeoutMs: 20 })).rejects.toThrow(/did not settle/);
  });

  it('blocksWithMarker unions the sampled block ids', () => {
    expect(blocksWithMarker([[], ['s1'], ['s1', 's2']])).toEqual(['s1', 's2']);
  });

  it('waitUntil resolves true as soon as the condition holds', async () => {
    const answers = [false, false, true];
    const check = vi.fn(async () => answers.shift() ?? true);

    await expect(waitUntil(check, { intervalMs: 1, timeoutMs: 1000 })).resolves.toBe(true);
    expect(check).toHaveBeenCalledTimes(3);
  });

  it('waitUntil resolves false at the deadline instead of throwing, so the grader judges', async () => {
    await expect(waitUntil(async () => false, { intervalMs: 1, timeoutMs: 20 })).resolves.toBe(false);
  });

  it('cleanup stops everything in reverse order, even when one stop throws', async () => {
    const order: string[] = [];
    const cleanup = createCleanup();

    cleanup.add(async () => {
      order.push('server');
    });
    cleanup.add(async () => {
      order.push('browser');
      throw new Error('browser gone');
    });
    cleanup.add(async () => {
      order.push('agent');
    });

    await expect(cleanup.run()).rejects.toThrow(/browser gone/);
    expect(order).toEqual(['agent', 'browser', 'server']);
  });

  it('cleanup runs each stop once', async () => {
    const stop = vi.fn(async () => undefined);
    const cleanup = createCleanup();

    cleanup.add(stop);
    await cleanup.run();
    await cleanup.run();

    expect(stop).toHaveBeenCalledTimes(1);
  });
});
