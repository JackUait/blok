import { describe, expect, it, vi } from 'vitest';

import { Blocks } from '../../../../../src/components/blocks';
import { BlockRepository } from '../../../../../src/components/modules/blockManager/repository';
import type { Block } from '../../../../../src/components/block';
import type { BlocksStore } from '../../../../../src/components/modules/blockManager/types';

/**
 * The model twin of the toolbar's pointer→block resolution
 * (src/components/modules/uiControllers/hovered-block-resolution.ts). Both must
 * name the same block for a row, otherwise the ⠿ handle and the lasso disagree.
 */
const createBlock = (options: {
  id: string;
  name?: string;
  parentId?: string | null;
  ownsChildren?: boolean;
}): Block => {
  const holder = document.createElement('div');

  holder.setAttribute('data-blok-element', '');

  return {
    id: options.id,
    name: options.name ?? 'paragraph',
    holder,
    parentId: options.parentId ?? null,
    contentIds: [],
    tool: { ownsChildren: options.ownsChildren ?? false },
    call: vi.fn(),
  } as unknown as Block;
};

const createRepository = (blocks: Block[]): BlockRepository => {
  const store = new Blocks(document.createElement('div'));

  for (const block of blocks) {
    store.push(block);
  }

  const repository = new BlockRepository();

  repository.initialize(store as unknown as BlocksStore);

  return repository;
};

describe('BlockRepository — selection units', () => {
  describe('getSelectionSiblingRange', () => {
    /**
     * Document: p0, toggle(table, p1, callout(inner), p3), list, p2 — the shape
     * that made a Shift+Click inside a toggle select the whole section.
     */
    const seedToggleDocument = (): Record<string, Block> => {
      const blockList = {
        p0: createBlock({ id: 'p0' }),
        toggle: createBlock({ id: 'toggle', name: 'header' }),
        table: createBlock({ id: 'table', name: 'table', parentId: 'toggle', ownsChildren: true }),
        cell: createBlock({ id: 'cell', parentId: 'table' }),
        p1: createBlock({ id: 'p1', parentId: 'toggle' }),
        callout: createBlock({ id: 'callout', name: 'callout', parentId: 'toggle' }),
        inner: createBlock({ id: 'inner', parentId: 'callout' }),
        p3: createBlock({ id: 'p3', parentId: 'toggle' }),
        p2: createBlock({ id: 'p2' }),
      };

      return blockList;
    };

    const idsOf = (blockList: Block[]): string[] => blockList.map((block) => block.id);

    it('selects the sibling run inside a container, never the container itself', () => {
      const seeded = seedToggleDocument();
      const repository = createRepository(Object.values(seeded));

      expect(idsOf(repository.getSelectionSiblingRange(seeded.p1, seeded.callout)))
        .toEqual(['p1', 'callout']);
    });

    it('lifts an endpoint out of its container when the other endpoint is outside', () => {
      const seeded = seedToggleDocument();
      const repository = createRepository(Object.values(seeded));

      expect(idsOf(repository.getSelectionSiblingRange(seeded.p1, seeded.p2)))
        .toEqual(['toggle', 'p2']);
    });

    it('represents a whole subtree by its container when one endpoint contains the other', () => {
      const seeded = seedToggleDocument();
      const repository = createRepository(Object.values(seeded));

      expect(idsOf(repository.getSelectionSiblingRange(seeded.toggle, seeded.p3))).toEqual(['toggle']);
      expect(idsOf(repository.getSelectionSiblingRange(seeded.p3, seeded.toggle))).toEqual(['toggle']);
    });

    it('resolves a table cell endpoint to the table', () => {
      const seeded = seedToggleDocument();
      const repository = createRepository(Object.values(seeded));

      expect(idsOf(repository.getSelectionSiblingRange(seeded.cell, seeded.p1)))
        .toEqual(['table', 'p1']);
    });

    it('expands column layout containers into the blocks they hold', () => {
      const row = createBlock({ id: 'row', name: 'column_list', ownsChildren: true });
      const left = createBlock({ id: 'left', name: 'column', parentId: 'row' });
      const leftChild = createBlock({ id: 'left-child', parentId: 'left' });
      const right = createBlock({ id: 'right', name: 'column', parentId: 'row' });
      const rightChild = createBlock({ id: 'right-child', parentId: 'right' });

      const repository = createRepository([row, left, leftChild, right, rightChild]);

      expect(idsOf(repository.getSelectionSiblingRange(leftChild, rightChild)))
        .toEqual(['left-child', 'right-child']);
    });
  });

  describe('resolveToSelectableBlock', () => {
    it('resolves a table cell block to the table, not to the top-level ancestor', () => {
      const toggle = createBlock({ id: 'toggle', name: 'header' });
      const table = createBlock({ id: 'table', name: 'table', parentId: 'toggle', ownsChildren: true });
      const cell = createBlock({ id: 'cell', parentId: 'table' });

      const repository = createRepository([toggle, table, cell]);

      expect(repository.resolveToSelectableBlock(cell)).toBe(table);
    });

    it('leaves a table nested in a toggle heading as its own unit', () => {
      const toggle = createBlock({ id: 'toggle', name: 'header' });
      const table = createBlock({ id: 'table', name: 'table', parentId: 'toggle', ownsChildren: true });

      const repository = createRepository([toggle, table]);

      expect(repository.resolveToSelectableBlock(table)).toBe(table);
    });

    it('leaves a plain child of a toggle heading as its own unit', () => {
      const toggle = createBlock({ id: 'toggle', name: 'header' });
      const child = createBlock({ id: 'child', parentId: 'toggle' });

      const repository = createRepository([toggle, child]);

      expect(repository.resolveToSelectableBlock(child)).toBe(child);
    });

    it('leaves a block inside a column as its own unit', () => {
      const row = createBlock({ id: 'row', name: 'column_list', ownsChildren: true });
      const column = createBlock({ id: 'column', name: 'column', parentId: 'row' });
      const child = createBlock({ id: 'child', parentId: 'column' });

      const repository = createRepository([row, column, child]);

      expect(repository.resolveToSelectableBlock(child)).toBe(child);
    });
  });

  describe('isSelectionUnit', () => {
    it('accepts a table nested in a toggle heading', () => {
      const toggle = createBlock({ id: 'toggle', name: 'header' });
      const table = createBlock({ id: 'table', name: 'table', parentId: 'toggle', ownsChildren: true });

      const repository = createRepository([toggle, table]);

      expect(repository.isSelectionUnit(table)).toBe(true);
    });

    it('rejects a table cell block', () => {
      const table = createBlock({ id: 'table', name: 'table', ownsChildren: true });
      const cell = createBlock({ id: 'cell', parentId: 'table' });

      const repository = createRepository([table, cell]);

      expect(repository.isSelectionUnit(cell)).toBe(false);
    });

    /**
     * Column layout mirrors BlockHoverController.isColumnContainer — neither a
     * column nor its row ever owns a toolbar, so neither may be selected either.
     */
    it('rejects the column layout containers and accepts the blocks inside them', () => {
      const row = createBlock({ id: 'row', name: 'column_list', ownsChildren: true });
      const column = createBlock({ id: 'column', name: 'column', parentId: 'row' });
      const child = createBlock({ id: 'child', parentId: 'column' });

      const repository = createRepository([row, column, child]);

      expect(repository.isSelectionUnit(row)).toBe(false);
      expect(repository.isSelectionUnit(column)).toBe(false);
      expect(repository.isSelectionUnit(child)).toBe(true);
    });
  });
});
