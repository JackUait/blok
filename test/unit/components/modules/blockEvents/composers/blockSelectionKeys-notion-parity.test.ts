import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BlockSelectionKeys } from '../../../../../../src/components/modules/blockEvents/composers/blockSelectionKeys';
import type { BlokModules } from '../../../../../../src/types-internal/blok-modules';
import type { Block } from '../../../../../../src/components/block';

/**
 * Notion-parity coverage for multi-select list keyboard ops (findings M-8, M-9, m-12):
 *
 * - M-9: multi-select Tab on list items reparents STRUCTURALLY (setBlockParent),
 *        matching single-item Tab, instead of bumping a flat `data.depth`.
 * - M-8: multi-select Shift+Tab outdents each item with a parent INDIVIDUALLY,
 *        leaving items already at the document root (leftmost) in place.
 * - m-12: Cmd/Ctrl+Enter toggles `checked` on every selected checklist item via
 *        the public block update API.
 */

interface ListBlockOptions {
  id: string;
  parentId?: string | null;
  depth?: number;
  style?: string;
  checked?: boolean;
  name?: string;
}

const createListBlock = (options: ListBlockOptions): Block => {
  const holder = document.createElement('div');
  const depthMarker = document.createElement('span');

  depthMarker.setAttribute('data-list-depth', String(options.depth ?? 0));
  holder.appendChild(depthMarker);

  // Only the checklist (to-do) style renders a checkbox; mirror that so the
  // synchronous checklist detection in handleToggleCheckbox behaves realistically.
  if ((options.style ?? 'unordered') === 'checklist') {
    const checkbox = document.createElement('input');

    checkbox.type = 'checkbox';
    checkbox.checked = Boolean(options.checked);
    holder.appendChild(checkbox);
  }

  const block = {
    id: options.id,
    name: options.name ?? 'list',
    holder,
    parentId: options.parentId ?? null,
    contentIds: [] as string[],
    selected: false,
    save: vi.fn(() => Promise.resolve({
      id: options.id,
      tool: 'list',
      data: {
        text: options.id,
        style: options.style ?? 'unordered',
        ...(options.checked !== undefined ? { checked: options.checked } : {}),
      },
      time: 0,
      tunes: {},
    })),
  } as unknown as Block;

  return block;
};

const createBlok = (blocks: Block[], selectedBlocks: Block[], extra: Partial<BlokModules['BlockManager']> = {}): {
  blok: BlokModules;
  setBlockParent: ReturnType<typeof vi.fn>;
  update: ReturnType<typeof vi.fn>;
} => {
  const setBlockParent = vi.fn();
  const update = vi.fn((block: Block) => Promise.resolve(block));

  const blok = {
    BlockSelection: {
      anyBlockSelected: selectedBlocks.length > 0,
      selectedBlocks,
      clearCache: vi.fn(),
    } as unknown as BlokModules['BlockSelection'],
    BlockManager: {
      blocks,
      getBlockIndex: vi.fn((block: Block) => blocks.indexOf(block)),
      getBlockByIndex: vi.fn((index: number) => blocks[index] ?? null),
      getBlockById: vi.fn((id: string) => blocks.find((b) => b.id === id)),
      setBlockParent,
      update,
      ...extra,
    } as unknown as BlokModules['BlockManager'],
  } as unknown as BlokModules;

  return { blok, setBlockParent, update };
};

const tabEvent = (shiftKey: boolean): KeyboardEvent => ({
  key: 'Tab',
  shiftKey,
  preventDefault: vi.fn(),
} as unknown as KeyboardEvent);

const enterEvent = (modifier: 'meta' | 'ctrl'): KeyboardEvent => ({
  key: 'Enter',
  metaKey: modifier === 'meta',
  ctrlKey: modifier === 'ctrl',
  preventDefault: vi.fn(),
} as unknown as KeyboardEvent);

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('BlockSelectionKeys — Notion parity (M-8, M-9, m-12)', () => {
  describe('M-9 · multi-select Tab reparents structurally', () => {
    it('nests selected list items under the preceding sibling via setBlockParent (not a depth bump)', () => {
      const a = createListBlock({ id: 'a', parentId: null });
      const b = createListBlock({ id: 'b', parentId: null });
      const c = createListBlock({ id: 'c', parentId: null });
      const { blok, setBlockParent, update } = createBlok([a, b, c], [b, c]);

      const keys = new BlockSelectionKeys(blok);
      const result = keys.handleIndent(tabEvent(false));

      expect(result).toBe(true);
      // Both selected items become children of the preceding sibling 'a'.
      expect(setBlockParent).toHaveBeenCalledWith(b, 'a');
      expect(setBlockParent).toHaveBeenCalledWith(c, 'a');
      // No flat depth-bump update — the tree carries the indent now.
      expect(update).not.toHaveBeenCalled();
    });

    it('nests every item but the first under the first when the selection starts at the top of the list', () => {
      const a = createListBlock({ id: 'a', parentId: null });
      const b = createListBlock({ id: 'b', parentId: null });
      const { blok, setBlockParent } = createBlok([a, b], [a, b]);

      const keys = new BlockSelectionKeys(blok);
      const result = keys.handleIndent(tabEvent(false));

      // 'a' is the first item of the list (no preceding sibling) so it cannot
      // indent; it becomes the anchor and 'b' nests under it (Notion parity).
      expect(result).toBe(true);
      expect(setBlockParent).toHaveBeenCalledTimes(1);
      expect(setBlockParent).toHaveBeenCalledWith(b, 'a');
    });
  });

  describe('M-8 · multi-select Shift+Tab outdents per-item', () => {
    it('outdents each item with a parent and leaves a root (depth-0) item in place', () => {
      // a(root) > b(child of a); c is a separate root item.
      const a = createListBlock({ id: 'a', parentId: null });
      const b = createListBlock({ id: 'b', parentId: 'a', depth: 1 });
      const c = createListBlock({ id: 'c', parentId: null });
      const { blok, setBlockParent } = createBlok([a, b, c], [b, c]);

      const keys = new BlockSelectionKeys(blok);
      const result = keys.handleIndent(tabEvent(true));

      expect(result).toBe(true);
      // b outdents to its grandparent (a's parent == root/null); c stays put.
      expect(setBlockParent).toHaveBeenCalledTimes(1);
      expect(setBlockParent).toHaveBeenCalledWith(b, null);
    });

    it('outdents all eligible items when every selected item has a parent', () => {
      const a = createListBlock({ id: 'a', parentId: null });
      const b = createListBlock({ id: 'b', parentId: 'a', depth: 1 });
      const c = createListBlock({ id: 'c', parentId: 'a', depth: 1 });
      const { blok, setBlockParent } = createBlok([a, b, c], [b, c]);

      const keys = new BlockSelectionKeys(blok);
      keys.handleIndent(tabEvent(true));

      expect(setBlockParent).toHaveBeenCalledWith(b, null);
      expect(setBlockParent).toHaveBeenCalledWith(c, null);
    });

    it('does not directly move an item whose ancestor is also selected (it follows the ancestor)', () => {
      // root X > a(child) > b(grandchild); a and b both selected.
      const x = createListBlock({ id: 'x', parentId: null });
      const a = createListBlock({ id: 'a', parentId: 'x', depth: 1 });
      const b = createListBlock({ id: 'b', parentId: 'a', depth: 2 });
      const { blok, setBlockParent } = createBlok([x, a, b], [a, b]);

      const keys = new BlockSelectionKeys(blok);
      keys.handleIndent(tabEvent(true));

      // Only 'a' moves (to x's parent == null); 'b' follows 'a' and is not moved.
      expect(setBlockParent).toHaveBeenCalledTimes(1);
      expect(setBlockParent).toHaveBeenCalledWith(a, null);
    });
  });

  describe('m-12 · Cmd/Ctrl+Enter toggles selected checklist items', () => {
    it('toggles checked for every selected checklist item via the public update API', async () => {
      const checkedItem = createListBlock({ id: 'done', style: 'checklist', checked: true });
      const uncheckedItem = createListBlock({ id: 'todo', style: 'checklist', checked: false });
      const { blok, update } = createBlok([checkedItem, uncheckedItem], [checkedItem, uncheckedItem]);

      const keys = new BlockSelectionKeys(blok);
      const event = enterEvent('meta');
      const result = keys.handleToggleCheckbox(event);

      expect(result).toBe(true);
      expect(event.preventDefault).toHaveBeenCalledTimes(1);

      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(update).toHaveBeenCalledWith(checkedItem, expect.objectContaining({ checked: false }));
      expect(update).toHaveBeenCalledWith(uncheckedItem, expect.objectContaining({ checked: true }));
    });

    it('skips non-checklist list items', async () => {
      const bullet = createListBlock({ id: 'bullet', style: 'unordered' });
      const { blok, update } = createBlok([bullet], [bullet]);

      const keys = new BlockSelectionKeys(blok);
      const result = keys.handleToggleCheckbox(enterEvent('ctrl'));

      await new Promise((resolve) => setTimeout(resolve, 0));

      // No checklist items → nothing to toggle, not handled.
      expect(result).toBe(false);
      expect(update).not.toHaveBeenCalled();
    });

    it('returns false when no blocks are selected', () => {
      const { blok } = createBlok([], []);
      const keys = new BlockSelectionKeys(blok);

      expect(keys.handleToggleCheckbox(enterEvent('meta'))).toBe(false);
    });

    it('ignores a plain Enter (no Cmd/Ctrl modifier)', () => {
      const item = createListBlock({ id: 'todo', style: 'checklist', checked: false });
      const { blok, update } = createBlok([item], [item]);
      const keys = new BlockSelectionKeys(blok);
      const plainEnter = { key: 'Enter', metaKey: false, ctrlKey: false, preventDefault: vi.fn() } as unknown as KeyboardEvent;

      expect(keys.handleToggleCheckbox(plainEnter)).toBe(false);
      expect(update).not.toHaveBeenCalled();
      expect(plainEnter.preventDefault).not.toHaveBeenCalled();
    });
  });
});
