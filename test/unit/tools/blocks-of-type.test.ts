import { describe, it, expect } from 'vitest';
import { blocksOfType } from '../../../src/tools/blocks-of-type';
import type { OutputData } from '../../../types';

/**
 * The type-level narrowing of `blocksOfType` is covered alongside `isBlockType`
 * in test/unit/types/block-data-map-typecheck.ts. This verifies the runtime:
 * a null-tolerant filter over a saved document's blocks by `type`.
 */
describe('blocksOfType', () => {
  const doc: OutputData = {
    blocks: [
      { id: 'h1', type: 'header', data: { text: 'One', level: 2 } },
      { id: 'p1', type: 'paragraph', data: { text: 'Body' } },
      { id: 'h2', type: 'header', data: { text: 'Two', level: 3 } },
    ],
  };

  it('returns every block of the requested type in document order', () => {
    const headers = blocksOfType(doc, 'header');

    expect(headers.map((block) => block.id)).toEqual(['h1', 'h2']);
  });

  it('returns an empty array when no block matches', () => {
    expect(blocksOfType(doc, 'divider')).toEqual([]);
  });

  it('is null-tolerant: nullish and blockless documents yield an empty array', () => {
    expect(blocksOfType(null, 'header')).toEqual([]);
    expect(blocksOfType(undefined, 'header')).toEqual([]);
    expect(blocksOfType({ blocks: [] }, 'header')).toEqual([]);
  });
});
