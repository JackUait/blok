/**
 * Unit tests for list-keyboard handleIndent — first-in-group nesting
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleIndent } from '../../../../src/tools/list/list-keyboard';
import { ListDepthValidator } from '../../../../src/tools/list/depth-validator';
import type { KeyboardContext } from '../../../../src/tools/list/list-keyboard';
import type { ListItemData } from '../../../../src/tools/list/types';

/** Minimal mock that satisfies BlocksAPI for the depth validator */
const createMockBlock = (options: { name?: string; depth?: number } = {}) => {
  const { name = 'list', depth = 0 } = options;

  const roleItem = document.createElement('div');
  roleItem.setAttribute('role', 'listitem');
  if (depth > 0) {
    roleItem.style.marginLeft = `${depth * 27}px`;
  }

  return {
    id: `block-${Math.random()}`,
    name,
    holder: {
      querySelector: (selector: string) => {
        if (selector === '[role="listitem"]') return roleItem;
        return null;
      },
    },
  };
};

describe('handleIndent — first-in-group nesting', () => {
  let data: ListItemData;
  let syncContentFromDOM: () => void;
  let updatedBlock: { id: string; holder: HTMLElement };

  beforeEach(() => {
    vi.clearAllMocks();
    data = { text: 'item', style: 'unordered', depth: 0 };
    syncContentFromDOM = vi.fn<() => void>();

    // Build a holder with a contenteditable child so setCaretToBlockContent
    // resolves synchronously and doesn't fire a stale requestAnimationFrame.
    const holder = document.createElement('div');
    const contentEl = document.createElement('div');
    contentEl.setAttribute('contenteditable', 'true');
    holder.appendChild(contentEl);
    updatedBlock = { id: 'updated', holder };
  });

  const buildContext = (overrides: {
    currentBlockIndex: number;
    blocks: ReturnType<typeof createMockBlock>[];
    depth?: number;
  }): { context: KeyboardContext; depthValidator: ListDepthValidator } => {
    const { currentBlockIndex, blocks, depth = 0 } = overrides;
    data.depth = depth;

    const blocksAPI = {
      getBlockByIndex: (i: number) => blocks[i] ?? undefined,
      getBlockIndex: () => currentBlockIndex,
      getBlocksCount: () => blocks.length,
      getCurrentBlockIndex: () => currentBlockIndex,
    };

    const api = {
      blocks: {
        ...blocksAPI,
        update: vi.fn().mockResolvedValue(updatedBlock),
      },
      caret: {
        setToBlock: vi.fn(),
        updateLastCaretAfterPosition: vi.fn(),
      },
    } as unknown as KeyboardContext['api'];

    const context: KeyboardContext = {
      api,
      blockId: 'test-block',
      data,
      element: document.createElement('div'),
      getContentElement: () => document.createElement('div'),
      syncContentFromDOM,
      getDepth: () => data.depth ?? 0,
    };

    const depthValidator = new ListDepthValidator(blocksAPI);

    return { context, depthValidator };
  };

  it('indents a list item at block index 0 (first block in editor)', async () => {
    const { context, depthValidator } = buildContext({
      currentBlockIndex: 0,
      blocks: [createMockBlock({ depth: 0 })],
    });

    await handleIndent(context, depthValidator);

    expect(context.api.blocks.update).toHaveBeenCalledWith('test-block', expect.objectContaining({ depth: 1 }));
    expect(data.depth).toBe(1);
  });

  it('indents a list item whose previous block is a paragraph (first in group)', async () => {
    const { context, depthValidator } = buildContext({
      currentBlockIndex: 1,
      blocks: [
        createMockBlock({ name: 'paragraph' }),
        createMockBlock({ depth: 0 }),
      ],
    });

    await handleIndent(context, depthValidator);

    expect(context.api.blocks.update).toHaveBeenCalledWith('test-block', expect.objectContaining({ depth: 1 }));
    expect(data.depth).toBe(1);
  });

  it('indents a first-in-group item once (depth 0 → 1) but blocks further nesting', async () => {
    // First indent: 0 → 1
    const { context: ctx1, depthValidator: dv1 } = buildContext({
      currentBlockIndex: 0,
      blocks: [createMockBlock({ depth: 0 })],
      depth: 0,
    });

    await handleIndent(ctx1, dv1);
    expect(data.depth).toBe(1);

    // Second indent: 1 → blocked (first-in-group max is 1)
    const { context: ctx2, depthValidator: dv2 } = buildContext({
      currentBlockIndex: 0,
      blocks: [createMockBlock({ depth: 1 })],
      depth: 1,
    });

    await handleIndent(ctx2, dv2);
    expect(data.depth).toBe(1); // unchanged
  });
});
