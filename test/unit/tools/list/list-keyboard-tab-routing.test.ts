/**
 * Notion parity (M-2): Tab on a first-in-group list item whose previous block is a
 * NON-list block (paragraph/heading) must NOT be swallowed by the tool. The tool's
 * flat handleIndent has nothing to nest under, and calling preventDefault would
 * short-circuit the shared structural handler that DOES nest the item under the
 * preceding block. So the tool leaves the Tab un-prevented in that case.
 *
 * When the previous block IS a list AND this item is already carried by a flat
 * `data.depth` (> 0, e.g. drag/authored nesting), the tool keeps owning the Tab
 * (flat indent) and preventDefaults. An un-nested (depth 0) list item instead
 * defers to the shared structural handler so its indent nests under the preceding
 * sibling and survives a save()/reload (Notion parity M-9).
 *
 * This drives the routing decision in ListItem.handleKeyDown directly by dispatching
 * a real keydown on the rendered element and asserting event.defaultPrevented.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ListItem } from '../../../../src/tools/list';
import type { ListItemData } from '../../../../src/tools/list/types';

interface BlockStub {
  id: string;
  name: string;
  parentId: string | null;
  holder: HTMLElement;
}

const makeBlockStub = (id: string, name: string, depth = 0): BlockStub => {
  const holder = document.createElement('div');
  const roleItem = document.createElement('div');
  roleItem.setAttribute('role', 'listitem');
  if (depth > 0) {
    roleItem.style.marginLeft = `${depth * 27}px`;
  }
  holder.appendChild(roleItem);

  return { id, name, parentId: null, holder };
};

/**
 * Build a ListItem whose current block (the second block) sits below `previousName`.
 * `currentDepth` seeds the item's flat `data.depth` carrier (0 = un-nested).
 */
const buildListItem = (previousName: string, currentDepth = 0): ListItem => {
  const previous = makeBlockStub('prev', previousName);
  const current = makeBlockStub('current', 'list', currentDepth);

  const blocks: BlockStub[] = [previous, current];

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

  const data: ListItemData = { text: 'item', style: 'unordered', depth: currentDepth };

  return new ListItem({
    data,
    config: {},
    api,
    readOnly: false,
    block: { id: 'current' } as never,
  });
};

const dispatchTab = (element: HTMLElement): KeyboardEvent => {
  const event = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
  element.dispatchEvent(event);
  return event;
};

beforeEach(() => {
  vi.clearAllMocks();
  document.body.innerHTML = '';
});

describe('ListItem Tab routing — M-2', () => {
  it('does NOT preventDefault Tab when the previous block is a paragraph (defers to shared structural handler)', () => {
    const tool = buildListItem('paragraph');
    const element = tool.render();
    document.body.appendChild(element);

    const event = dispatchTab(element);

    expect(event.defaultPrevented).toBe(false);
  });

  it('does NOT preventDefault Tab when the previous block is a heading', () => {
    const tool = buildListItem('header');
    const element = tool.render();
    document.body.appendChild(element);

    const event = dispatchTab(element);

    expect(event.defaultPrevented).toBe(false);
  });

  it('does NOT preventDefault Tab when the previous block is a list but this item is un-nested (depth 0)', () => {
    const tool = buildListItem('list', 0);
    const element = tool.render();
    document.body.appendChild(element);

    const event = dispatchTab(element);

    // Depth-0 items defer to the shared structural handler so the indent nests
    // under the preceding sibling and survives a save()/reload (M-9).
    expect(event.defaultPrevented).toBe(false);
  });

  it('preventDefaults Tab when the previous block IS a list and this item is already flat-nested (depth > 0)', () => {
    const tool = buildListItem('list', 1);
    const element = tool.render();
    document.body.appendChild(element);

    const event = dispatchTab(element);

    // Flat-carrier items (depth > 0) keep the tool's cap-based flat indent.
    expect(event.defaultPrevented).toBe(true);
  });
});
