import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { BlockWriteBuffer } from '../../../../../src/components/modules/yjs/write-buffer';

/**
 * Capture-clock rewind law for the write buffer.
 *
 * A trailing flush lands up to `windowMs` after the typing it carries, so the
 * buffer re-anchors the undo captureTimeout at the typing time. Two rules the
 * multi-window barrier must honour:
 *   - ONE rewind per `flushAll`, to the NEWEST typing across the windows that
 *     wrote (iteration order is window creation order, not recency).
 *   - No rewind at all when nothing was actually written.
 */
const WINDOW_MS = 400;

describe('BlockWriteBuffer — trailing-flush capture-clock rewind', () => {
  let buffer: BlockWriteBuffer;
  let rewinds: number[];

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    rewinds = [];
    buffer = new BlockWriteBuffer(WINDOW_MS);
    buffer.onTrailingFlush((lastEnqueueAt) => {
      rewinds.push(lastEnqueueAt);
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  /** Open a window (leading dispatch) and buffer a follow-up write into it. */
  const armWindow = (blockId: string, wrote: boolean): void => {
    const flush = (): boolean => wrote;

    buffer.enqueue(blockId, { text: 'a' }, flush);
    buffer.enqueue(blockId, { text: 'ab' }, flush);
  };

  it('rewinds once to the NEWEST typing across windows, not the last-iterated one', () => {
    vi.setSystemTime(1_000);
    armWindow('older', true);

    // The second window is created LATER but iterated LAST-but-one in
    // creation order — the clock must not end up at its enqueue time.
    vi.setSystemTime(1_120);
    armWindow('newer', true);

    vi.setSystemTime(1_020);
    armWindow('newest-created-last', true);

    buffer.flushAll();

    expect(rewinds).toEqual([1_120]);
  });

  it('does not rewind at all when every flush wrote nothing', () => {
    vi.setSystemTime(1_000);
    armWindow('noop-a', false);
    vi.setSystemTime(1_050);
    armWindow('noop-b', false);

    buffer.flushAll();

    expect(rewinds).toEqual([]);
  });

  it('ignores windows that wrote nothing when picking the rewind target', () => {
    vi.setSystemTime(1_000);
    armWindow('wrote', true);
    vi.setSystemTime(1_300);
    armWindow('noop', false);

    buffer.flushAll();

    expect(rewinds).toEqual([1_000]);
  });

  it('still rewinds for a single window closed by its own trailing timer', () => {
    vi.setSystemTime(1_000);
    armWindow('solo', true);

    vi.advanceTimersByTime(WINDOW_MS);

    expect(rewinds).toEqual([1_000]);
  });

  it('does not rewind when the timer-closed window wrote nothing', () => {
    vi.setSystemTime(1_000);
    armWindow('solo-noop', false);

    vi.advanceTimersByTime(WINDOW_MS);

    expect(rewinds).toEqual([]);
  });
});
