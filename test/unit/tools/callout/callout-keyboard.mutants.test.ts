/**
 * Guards for the two index checks in the callout first-child Backspace path.
 *
 * Equivalent mutant (proven, not assumed):
 *   `calloutIndex !== undefined && calloutIndex > 0` with the left operand
 *   forced to `true`. The only value failing `x !== undefined` is `undefined`
 *   itself, and `undefined > 0` is false, so `x > 0` and
 *   `x !== undefined && x > 0` agree for every input. No test can separate them.
 */

import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';

import { handleCalloutFirstChildBackspace } from '../../../../src/tools/callout/callout-keyboard';
import type { API } from '../../../../types';

interface Harness {
  api: API;
  convert: Mock<(id: string, type: string) => Promise<void>>;
  remove: Mock<(index?: number, setCaret?: boolean) => Promise<void>>;
  setToBlock: Mock<(target: number, position?: string) => boolean>;
}

const createHarness = (childCount: number, indexOf: (id: string) => number | undefined): Harness => {
  const convert: Mock<(id: string, type: string) => Promise<void>> = vi.fn().mockResolvedValue(undefined);
  const remove: Mock<(index?: number, setCaret?: boolean) => Promise<void>> = vi.fn().mockResolvedValue(undefined);
  const setToBlock: Mock<(target: number, position?: string) => boolean> = vi.fn().mockReturnValue(true);
  const getChildren: Mock<(parentId: string) => unknown[]> = vi
    .fn()
    .mockImplementation(() => Array.from({ length: childCount }, (_, i) => ({ id: `child-${i}` })));
  const getBlockIndex: Mock<(id: string) => number | undefined> = vi.fn().mockImplementation(indexOf);

  const api = {
    blocks: {
      convert,
      delete: remove,
      getChildren,
      getBlockIndex,
    },
    caret: { setToBlock },
  } as unknown as API;

  return {
    api,
    convert,
    remove,
    setToBlock,
  };
};

describe('handleCalloutFirstChildBackspace mutants', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('skips the delete when the first child has no index', async () => {
    const harness = createHarness(3, (id) => (id === 'callout-id' ? 5 : undefined));

    await handleCalloutFirstChildBackspace({
      api: harness.api,
      calloutBlockId: 'callout-id',
      firstChildBlockId: 'child-0',
      event: new KeyboardEvent('keydown', { key: 'Backspace' }),
    });

    // blocks.delete() with no index defaults to the current block index, so an
    // unguarded call here removes a different block.
    expect(harness.remove).not.toHaveBeenCalled();
    expect(harness.setToBlock).toHaveBeenCalledWith(4, 'end');
  });

  it('leaves the caret alone when the callout is the first block in the document', async () => {
    const harness = createHarness(2, (id) => (id === 'callout-id' ? 0 : 1));

    await handleCalloutFirstChildBackspace({
      api: harness.api,
      calloutBlockId: 'callout-id',
      firstChildBlockId: 'child-0',
      event: new KeyboardEvent('keydown', { key: 'Backspace' }),
    });

    // Index 0 has no predecessor: -1 would be an out-of-range caret move.
    expect(harness.setToBlock).not.toHaveBeenCalled();
    expect(harness.remove).toHaveBeenCalledWith(1);
    expect(harness.convert).not.toHaveBeenCalled();
  });
});
