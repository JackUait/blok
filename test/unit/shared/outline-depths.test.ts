import { describe, expect, it } from 'vitest';

import { outlineDepths } from '../../../src/shared/outline-depths';

describe('outlineDepths', () => {
  it('nests each level under the nearest higher level before it', () => {
    expect(outlineDepths([1, 2, 3, 2, 1])).toEqual([0, 1, 2, 1, 0]);
  });

  it('collapses a skipped level: an H3 right under an H1 sits one step in', () => {
    expect(outlineDepths([1, 3])).toEqual([0, 1]);
  });

  it('does not let an earlier, deeper sibling push a later heading two steps in', () => {
    // Notion's own rule gives [0, 1, 1, 3] here: the H3 stays counted for the H4.
    expect(outlineDepths([1, 3, 2, 4])).toEqual([0, 1, 1, 2]);
  });

  it('starts at the outermost level the document uses, not at H1', () => {
    expect(outlineDepths([2, 3, 3, 2])).toEqual([0, 1, 1, 0]);
  });

  it('puts a heading higher than everything before it back at the margin', () => {
    expect(outlineDepths([3, 2, 1])).toEqual([0, 0, 0]);
  });

  it('returns nothing for no headings', () => {
    expect(outlineDepths([])).toEqual([]);
  });
});
