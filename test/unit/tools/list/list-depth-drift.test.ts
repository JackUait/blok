/**
 * Regression: numeric `data.depth` must never DRIFT from the structural block
 * tree once a list item has a structural (list) parent.
 *
 * Notion models nesting depth as PURELY the ancestor count in the block tree.
 * Blok additionally carries a flat numeric `data.depth` for drag/paste of items
 * that are not yet structurally parented. When an item IS structurally nested,
 * the tree is the single source of truth: `getDepth()` (reported), `save()`
 * (serialized) and the rendered indent MUST follow the structure even when the
 * stored `data.depth` disagrees.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ListItem } from '../../../../src/tools/list';
import type { ListItemData } from '../../../../src/tools/list/types';
import { INDENT_PER_LEVEL } from '../../../../src/tools/list/constants';

interface BlockStub {
  id: string;
  name: string;
  parentId: string | null;
  holder: HTMLElement;
}

const makeBlockStub = (id: string, name: string, parentId: string | null = null): BlockStub => {
  const holder = document.createElement('div');
  const roleItem = document.createElement('div');
  roleItem.setAttribute('role', 'listitem');
  holder.appendChild(roleItem);
  return { id, name, parentId, holder };
};

/**
 * Build a structurally-nested ListItem: `current` is a list block whose parent
 * chain is `parent` (a list) → root. Its flat `data.depth` is seeded to
 * `flatDepth` so we can prove reported/serialized/rendered depth follow the tree
 * (structural depth 1) and NOT the stale flat carrier.
 */
const buildStructurallyNestedItem = (flatDepth: number): { tool: ListItem } => {
  const parent = makeBlockStub('parent', 'list', null);
  const current = makeBlockStub('current', 'list', 'parent');

  const blocks: BlockStub[] = [parent, current];

  const blocksAPI = {
    getById: (id: string): BlockStub | null => blocks.find(b => b.id === id) ?? null,
    getBlockIndex: (id: string): number | undefined => {
      const idx = blocks.findIndex(b => b.id === id);
      return idx >= 0 ? idx : undefined;
    },
    getCurrentBlockIndex: (): number => 1,
    getBlockByIndex: (i: number): BlockStub | undefined => blocks[i] ?? undefined,
    getBlocksCount: (): number => blocks.length,
    update: vi.fn().mockResolvedValue(current),
  };

  const api = {
    blocks: blocksAPI,
    i18n: { t: (key: string): string => key },
    events: { on: vi.fn(), off: vi.fn() },
  } as never;

  const data: ListItemData = { text: 'item', style: 'unordered', depth: flatDepth };

  const tool = new ListItem({
    data,
    config: {},
    api,
    readOnly: false,
    block: { id: 'current' } as never,
  });

  return { tool };
};

beforeEach(() => {
  vi.clearAllMocks();
  document.body.innerHTML = '';
});

describe('ListItem structural-depth drift proofing', () => {
  it('save() serializes the STRUCTURAL depth, ignoring a stale higher data.depth', () => {
    const { tool } = buildStructurallyNestedItem(3);
    tool.render();

    const saved = tool.save();

    // Structural depth is 1 (one list ancestor); the stale flat carrier said 3.
    expect(saved.depth).toBe(1);
  });

  it('save() serializes the STRUCTURAL depth, ignoring a stale lower data.depth', () => {
    const { tool } = buildStructurallyNestedItem(0);
    tool.render();

    const saved = tool.save();

    // Structurally nested (depth 1) even though the flat carrier said 0.
    expect(saved.depth).toBe(1);
  });

  it('renders the indent at the STRUCTURAL depth, not the stale data.depth', () => {
    const { tool } = buildStructurallyNestedItem(3);
    const element = tool.render();
    document.body.appendChild(element);

    const listItem = element.querySelector('[role="listitem"]');
    const marginLeft = (listItem as HTMLElement | null)?.style.marginLeft ?? '';

    // Structural depth 1 => one indent level, NOT 3 * INDENT.
    expect(marginLeft).toBe(`${1 * INDENT_PER_LEVEL}px`);
  });
});
