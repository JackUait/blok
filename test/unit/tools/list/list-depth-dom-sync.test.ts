/**
 * Regression: Tab / Shift+Tab on a FLAT-carrier list item must move the RENDERED
 * item, not only the model.
 *
 * `handleIndent`/`handleOutdent` write the new depth into the tool's own live
 * `_data` before asking core to apply it. Core prefers a tool's in-place
 * `setData` over recomposing the Block, and `setListItemData` decides whether to
 * touch the DOM by diffing the incoming depth against that same live `_data` —
 * so a pre-mutated carrier makes the diff a no-op, `adjustDepthTo` (the ONLY
 * writer of `data-list-depth` / the indent / the bullet) never runs, and the
 * saved document silently disagrees with what the user sees.
 *
 * These tests deliberately do NOT mock `api.blocks.update`: the existing keyboard
 * tests do, which is exactly why the divergence slipped through. The harness
 * below replays what `blockManager/block-mutation.ts` does — merge the patch over
 * the block's current saved data, then hand it to the tool's `setData` — and
 * asserts the RENDERED consequence.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ListItem } from '../../../../src/tools/list';
import { INDENT_PER_LEVEL } from '../../../../src/tools/list/constants';
import type { ListItemData } from '../../../../src/tools/list/types';

interface HarnessBlock {
  id: string;
  name: string;
  parentId: string | null;
  holder: HTMLElement;
  tool: ListItem;
}

/**
 * Lets every chained microtask of the fire-and-forget `void this.handleOutdent()`
 * drain before assertions run.
 */
const flushPendingHandlers = async (): Promise<void> => {
  await new Promise<void>(resolve => {
    setTimeout(resolve, 0);
  });
};

/**
 * Build a document of FLAT-carrier list items (no parentId — so the tool takes
 * its own `handleIndent`/`handleOutdent` path rather than the shared structural
 * Tab handler), each backed by a REAL `ListItem` rendered into its own holder.
 *
 * @param depths - the flat `data.depth` of each item, in document order
 * @param focusedIndex - index of the item the keystroke is delivered to
 */
const buildFlatList = (depths: number[], focusedIndex: number): { blocks: HarnessBlock[] } => {
  const blocks: HarnessBlock[] = [];

  const update = async (id: string, patch: Partial<ListItemData>): Promise<HarnessBlock> => {
    const target = blocks.find(block => block.id === id);

    if (!target) {
      throw new Error(`update() called for unknown block "${id}"`);
    }

    /**
     * Mirrors `blockManager/block-mutation.ts`: core merges the patch over the
     * block's CURRENT saved data and offers it to the tool's in-place setData.
     */
    const mergedData: ListItemData = { ...target.tool.save(), ...patch };

    if (!target.tool.setData(mergedData)) {
      /**
       * Core recomposes the Block when the tool declines. These fixtures never
       * change style, so the in-place branch is always the one under test — a
       * declined update means the fixture drifted from the real flow.
       */
      throw new Error(`setData() declined the in-place update for "${id}"`);
    }

    return target;
  };

  const api = {
    blocks: {
      getById: (id: string): HarnessBlock | null => blocks.find(block => block.id === id) ?? null,
      getBlockByIndex: (index: number): HarnessBlock | undefined => blocks[index] ?? undefined,
      getBlockIndex: (id: string): number | undefined => {
        const index = blocks.findIndex(block => block.id === id);

        return index >= 0 ? index : undefined;
      },
      getBlocksCount: (): number => blocks.length,
      getCurrentBlockIndex: (): number => focusedIndex,
      update,
    },
    caret: { setToBlock: vi.fn(), updateLastCaretAfterPosition: vi.fn() },
    i18n: { t: (key: string): string => key },
    events: { on: vi.fn(), off: vi.fn() },
  } as never;

  depths.forEach((depth, index) => {
    const id = `item-${index}`;
    const holder = document.createElement('div');
    const tool = new ListItem({
      data: { text: `item ${index}`, style: 'unordered', depth },
      config: {},
      api,
      readOnly: false,
      block: { id } as never,
    });

    // Registered before render() so index lookups from the tool resolve correctly.
    blocks.push({ id, name: 'list', parentId: null, holder, tool });

    holder.appendChild(tool.render());
    document.body.appendChild(holder);
  });

  return { blocks };
};

/**
 * Reads the depth the USER sees: the wrapper attribute plus the indent, both
 * written exclusively by `adjustDepthTo`.
 */
const readRenderedDepth = (block: HarnessBlock): { attribute: string | null; marginLeft: string } => {
  const wrapper = block.holder.firstElementChild;
  const listItem = wrapper?.querySelector('[role="listitem"]');

  return {
    attribute: wrapper?.getAttribute('data-list-depth') ?? null,
    marginLeft: listItem instanceof HTMLElement ? listItem.style.marginLeft : '',
  };
};

const pressTab = async (block: HarnessBlock, options: { shiftKey: boolean }): Promise<void> => {
  const contentEl = block.holder.querySelector('[data-blok-testid="list-content-container"]');

  if (!(contentEl instanceof HTMLElement)) {
    throw new Error('list content element was not rendered');
  }

  contentEl.dispatchEvent(new KeyboardEvent('keydown', {
    key: 'Tab',
    shiftKey: options.shiftKey,
    bubbles: true,
    cancelable: true,
  }));

  await flushPendingHandlers();
};

beforeEach(() => {
  vi.clearAllMocks();
  document.body.innerHTML = '';
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('flat-carrier list depth — model and DOM must not diverge', () => {
  it('Shift+Tab outdents the RENDERED item, not just the saved data', async () => {
    const { blocks } = buildFlatList([0, 1], 1);
    const target = blocks[1];

    await pressTab(target, { shiftKey: true });

    expect(readRenderedDepth(target)).toEqual({ attribute: '0', marginLeft: '' });
  });

  it('Tab indents the RENDERED item, not just the saved data', async () => {
    const { blocks } = buildFlatList([0, 1, 1], 2);
    const target = blocks[2];

    await pressTab(target, { shiftKey: false });

    expect(readRenderedDepth(target)).toEqual({
      attribute: '2',
      marginLeft: `${2 * INDENT_PER_LEVEL}px`,
    });
  });

  it('keeps save() and the rendered depth in agreement after Shift+Tab', async () => {
    const { blocks } = buildFlatList([0, 1], 1);
    const target = blocks[1];

    await pressTab(target, { shiftKey: true });

    expect(target.tool.save().depth ?? 0).toBe(0);
    expect(readRenderedDepth(target).attribute).toBe('0');
  });

  it('keeps save() and the rendered depth in agreement after Tab', async () => {
    const { blocks } = buildFlatList([0, 1, 1], 2);
    const target = blocks[2];

    await pressTab(target, { shiftKey: false });

    expect(target.tool.save().depth ?? 0).toBe(2);
    expect(readRenderedDepth(target).attribute).toBe('2');
  });
});
