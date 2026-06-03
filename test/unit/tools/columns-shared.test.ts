import { describe, it, expect, vi } from 'vitest';
import { isInsideColumn, COLUMN_TOOL, unwrapColumnListIfCollapsed } from '../../../src/tools/columns-shared';
import type { API } from '../../../types';

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

describe('unwrapColumnListIfCollapsed', () => {
  it('promotes the surviving column blocks and deletes both wrappers when 1 column remains', async () => {
    const survivingChild = { id: 'p1' };
    const remainingColumn = { id: 'colA' };

    const getChildren = vi.fn()
      .mockReturnValueOnce([remainingColumn])        // column_list has 1 column
      .mockReturnValueOnce([survivingChild]);        // that column has 1 paragraph
    // delete() is index-based; resolve ids to indices on demand
    const indexById: Record<string, number> = { colA: 8, 'cl-1': 7 };
    const getBlockIndex = vi.fn().mockImplementation((id: string) => indexById[id]);
    const setBlockParent = vi.fn();
    const remove = vi.fn().mockResolvedValue(undefined);

    const api = {
      blocks: { getChildren, getBlockIndex, setBlockParent, delete: remove },
    } as unknown as API;

    const didUnwrap = await unwrapColumnListIfCollapsed(api, 'cl-1');

    expect(didUnwrap).toBe(true);
    // surviving paragraph promoted to root (null parent)
    expect(setBlockParent).toHaveBeenCalledWith('p1', null);
    // both wrappers deleted by index (column first, then list)
    expect(remove).toHaveBeenCalledWith(8);
    expect(remove).toHaveBeenCalledWith(7);
  });

  it('does nothing when 2+ columns remain', async () => {
    const getChildren = vi.fn().mockReturnValue([{ id: 'a' }, { id: 'b' }]);
    const setBlockParent = vi.fn();
    const remove = vi.fn().mockResolvedValue(undefined);
    const api = {
      blocks: { getChildren, getBlockIndex: vi.fn(), setBlockParent, delete: remove },
    } as unknown as API;

    expect(await unwrapColumnListIfCollapsed(api, 'cl-1')).toBe(false);
    expect(remove).not.toHaveBeenCalled();
  });
});
