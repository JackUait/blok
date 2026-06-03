import { describe, it, expect } from 'vitest';
import { isInsideColumn, COLUMN_TOOL } from '../../../src/tools/columns-shared';

interface FakeBlock {
  id: string;
  name: string;
  parentId: string | null;
}

const makeTree = (blocks: FakeBlock[]) => {
  const byId = new Map(blocks.map(b => [b.id, b]));

  return (id: string): { name: string; parentId: string | null } | undefined => {
    const b = byId.get(id);

    return b ? { name: b.name, parentId: b.parentId } : undefined;
  };
};

describe('isInsideColumn', () => {
  it('returns true when an ancestor is a column block', () => {
    const lookup = makeTree([
      { id: 'cl', name: 'column_list', parentId: null },
      { id: 'c1', name: COLUMN_TOOL, parentId: 'cl' },
      { id: 'p1', name: 'paragraph', parentId: 'c1' },
    ]);
    expect(isInsideColumn('p1', lookup)).toBe(true);
  });

  it('returns false for a root-level block', () => {
    const lookup = makeTree([
      { id: 'p1', name: 'paragraph', parentId: null },
    ]);
    expect(isInsideColumn('p1', lookup)).toBe(false);
  });

  it('is cycle-safe', () => {
    const lookup = makeTree([
      { id: 'a', name: 'paragraph', parentId: 'b' },
      { id: 'b', name: 'paragraph', parentId: 'a' },
    ]);
    expect(isInsideColumn('a', lookup)).toBe(false);
  });
});
