import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { BlockWriteBuffer } from '../../../../../src/components/modules/yjs/write-buffer';

/**
 * Mutation-coverage tests for `src/components/modules/yjs/write-buffer.ts`.
 *
 * Equivalence proof for the mutants deliberately left alive:
 *
 * - L137 `openWindow === undefined` replaced by `false`, and the same guard with
 *   its body emptied. `closeWindow` has two callers. The trailing timer only
 *   fires while its window is open, because every close clears that window's
 *   timer in the same step that deletes it. `flushAll` iterates a snapshot of
 *   the live keys, and the only code that deletes a key is `closeWindow`
 *   itself — reachable during the iteration solely through a nested `flushAll`,
 *   which the in-flight dispatch guard turns into a no-op. So the lookup never
 *   misses and the guard body is unreachable.
 */

const WINDOW_MS = 400;

describe('write-buffer mutants', () => {
  /** Records the entries every flush receives, so dispatch count and payload are both observable. */
  const recorder = (
    wrote = true
  ): { calls: Array<Record<string, unknown>>; flush: (entries: ReadonlyMap<string, unknown>) => boolean } => {
    const calls: Array<Record<string, unknown>> = [];

    return {
      calls,
      flush: (entries: ReadonlyMap<string, unknown>): boolean => {
        calls.push(Object.fromEntries(entries));

        return wrote;
      },
    };
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(1_000);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('dispatches the first write of an idle block immediately', () => {
    const buffer = new BlockWriteBuffer(WINDOW_MS);
    const { calls, flush } = recorder();

    buffer.enqueue('b1', { text: 'a' }, flush);

    expect(calls).toEqual([{ text: 'a' }]);
  });

  it('survives a trailing flush with no listener registered', () => {
    const buffer = new BlockWriteBuffer(WINDOW_MS);
    const { calls, flush } = recorder();

    buffer.enqueue('b1', { text: 'a' }, flush);
    buffer.enqueue('b1', { text: 'ab' }, flush);

    vi.advanceTimersByTime(WINDOW_MS);

    expect(calls).toEqual([{ text: 'a' }, { text: 'ab' }]);
  });

  it('survives a barrier flush with no listener registered', () => {
    const buffer = new BlockWriteBuffer(WINDOW_MS);
    const { calls, flush } = recorder();

    buffer.enqueue('b1', { text: 'a' }, flush);
    buffer.enqueue('b1', { text: 'ab' }, flush);

    buffer.flushAll();

    expect(calls).toEqual([{ text: 'a' }, { text: 'ab' }]);
  });

  it('ignores a barrier raised from inside a dispatch', () => {
    const buffer = new BlockWriteBuffer(WINDOW_MS);
    const calls: Array<Record<string, unknown>> = [];
    let reentered = false;
    const flush = (entries: ReadonlyMap<string, unknown>): boolean => {
      calls.push(Object.fromEntries(entries));

      if (!reentered) {
        reentered = true;
        // The dispatch in flight IS the flush this barrier would perform;
        // draining here would close the window that was just opened.
        buffer.flushAll();
      }

      return true;
    };

    buffer.enqueue('b1', { text: 'a' }, flush);
    buffer.enqueue('b1', { text: 'ab' }, flush);

    expect(calls).toEqual([{ text: 'a' }]);

    vi.advanceTimersByTime(WINDOW_MS);

    expect(calls).toEqual([{ text: 'a' }, { text: 'ab' }]);
  });

  it('does not dispatch again when the barrier finds nothing buffered', () => {
    const buffer = new BlockWriteBuffer(WINDOW_MS);
    const rewinds: number[] = [];
    const { calls, flush } = recorder();

    buffer.onTrailingFlush((lastEnqueueAt) => rewinds.push(lastEnqueueAt));
    buffer.enqueue('b1', { text: 'a' }, flush);

    buffer.flushAll();

    expect(calls).toEqual([{ text: 'a' }]);
    expect(rewinds).toEqual([]);
  });

  it('opens a fresh window for a block the barrier already drained', () => {
    const buffer = new BlockWriteBuffer(WINDOW_MS);
    const { calls, flush } = recorder();

    buffer.enqueue('b1', { text: 'a' }, flush);
    buffer.flushAll();
    buffer.enqueue('b1', { text: 'ab' }, flush);

    expect(calls).toEqual([{ text: 'a' }, { text: 'ab' }]);
  });

  it('cancels the trailing timer it drains, so it cannot close a later window early', () => {
    const buffer = new BlockWriteBuffer(WINDOW_MS);
    const { calls, flush } = recorder();

    buffer.enqueue('b1', { text: 'a' }, flush);
    buffer.enqueue('b1', { text: 'ab' }, flush);
    buffer.flushAll();

    vi.advanceTimersByTime(100);

    buffer.enqueue('b1', { text: 'abc' }, flush);
    buffer.enqueue('b1', { text: 'abcd' }, flush);

    // Past the drained window deadline, still inside the new one.
    vi.advanceTimersByTime(WINDOW_MS - 90);

    expect(calls).toEqual([{ text: 'a' }, { text: 'ab' }, { text: 'abc' }]);

    vi.advanceTimersByTime(100);

    expect(calls).toEqual([{ text: 'a' }, { text: 'ab' }, { text: 'abc' }, { text: 'abcd' }]);
  });
});
