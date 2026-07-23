import { describe, it, expect } from 'vitest';
import { isBlockType } from '../../../src/tools/is-block-type';
import type { OutputBlockData } from '../../../types/data-formats/output-data';

/**
 * The narrowing power of `isBlockType` is covered at the type level by
 * test/unit/types/block-data-map-typecheck.ts. This verifies the runtime
 * predicate: a plain `type` identity comparison, true only on an exact match.
 */
describe('isBlockType', () => {
  const header: OutputBlockData = { id: 'h1', type: 'header', data: { text: 'Hi', level: 2 } };

  it('returns true when the block type matches', () => {
    expect(isBlockType(header, 'header')).toBe(true);
  });

  it('returns false when the block type differs', () => {
    expect(isBlockType(header, 'paragraph')).toBe(false);
  });

  it('narrows so mapped data is readable without a cast', () => {
    if (isBlockType(header, 'header')) {
      // `level` is typed as number by BlokBlockDataMap — no `as HeaderData`.
      expect(header.data.level).toBe(2);
    } else {
      throw new Error('expected header block to narrow');
    }
  });
});
