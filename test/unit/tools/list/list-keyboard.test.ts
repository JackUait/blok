/**
 * Unit tests for list-keyboard handleIndent & handleOutdent
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleOutdent, handleEnter } from '../../../../src/tools/list/list-keyboard';
import { ListDepthValidator } from '../../../../src/tools/list/depth-validator';
import type { KeyboardContext } from '../../../../src/tools/list/list-keyboard';
import type { ListItemData } from '../../../../src/tools/list/types';

/** Minimal mock that satisfies BlocksAPI for the depth validator */
const createMockBlock = (options: { id?: string; name?: string; depth?: number } = {}) => {
  const { id = `block-${Math.random()}`, name = 'list', depth = 0 } = options;

  const roleItem = document.createElement('div');
  roleItem.setAttribute('role', 'listitem');
  if (depth > 0) {
    roleItem.style.marginLeft = `${depth * 27}px`;
  }

  return {
    id,
    name,
    holder: {
      querySelector: (selector: string) => {
        if (selector === '[role="listitem"]') return roleItem;
        return null;
      },
    },
  };
};

/**
 * Single-block list-item indentation (Tab) is now STRUCTURAL — it reparents the
 * item under its preceding sibling via the shared KeyboardNavigation handler,
 * identical to text/headers. That behaviour is covered by
 * test/unit/components/modules/blockEvents/composers/keyboardNavigation.test.ts.
 * The flat `handleIndent` (data.depth mutation) it replaced has been removed.
 */

describe('handleOutdent — child depth cascading', () => {
  let data: ListItemData;
  let syncContentFromDOM: () => void;
  let updatedBlock: { id: string; holder: HTMLElement };

  beforeEach(() => {
    vi.clearAllMocks();
    data = { text: 'parent item', style: 'unordered', depth: 1 };
    syncContentFromDOM = vi.fn<() => void>();

    const holder = document.createElement('div');
    const contentEl = document.createElement('div');
    contentEl.setAttribute('contenteditable', 'true');
    holder.appendChild(contentEl);
    updatedBlock = { id: 'parent-block', holder };
  });

  const buildOutdentContext = (overrides: {
    currentBlockIndex: number;
    blocks: ReturnType<typeof createMockBlock>[];
    depth?: number;
  }): { context: KeyboardContext; depthValidator: ListDepthValidator } => {
    const { currentBlockIndex, blocks, depth = 1 } = overrides;
    data.depth = depth;

    const blocksAPI = {
      getBlockByIndex: (i: number) => blocks[i] ?? undefined,
      getBlockIndex: (id: string) => {
        const idx = blocks.findIndex(b => b.id === id);
        return idx >= 0 ? idx : undefined;
      },
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
      blockId: blocks[currentBlockIndex]?.id ?? 'test-block',
      data,
      element: document.createElement('div'),
      getContentElement: () => document.createElement('div'),
      syncContentFromDOM,
      getDepth: () => data.depth ?? 0,
    };

    const depthValidator = new ListDepthValidator(blocksAPI);

    return { context, depthValidator };
  };

  it('reduces descendant depths by 1 when outdenting a parent', async () => {
    const childBlock = createMockBlock({ id: 'child', depth: 2 });
    const grandchildBlock = createMockBlock({ id: 'grandchild', depth: 3 });
    const child2Block = createMockBlock({ id: 'child2', depth: 2 });

    const { context, depthValidator } = buildOutdentContext({
      currentBlockIndex: 0,
      blocks: [
        createMockBlock({ id: 'parent', depth: 1 }),
        childBlock,
        grandchildBlock,
        child2Block,
      ],
      depth: 1,
    });

    await handleOutdent(context, depthValidator);

    // Parent should be updated to depth 0
    expect(context.api.blocks.update).toHaveBeenCalledWith(
      'parent',
      expect.objectContaining({ depth: 0 })
    );

    // All descendants should be reduced by 1
    expect(context.api.blocks.update).toHaveBeenCalledWith(
      'child',
      expect.objectContaining({ depth: 1 })
    );
    expect(context.api.blocks.update).toHaveBeenCalledWith(
      'grandchild',
      expect.objectContaining({ depth: 2 })
    );
    expect(context.api.blocks.update).toHaveBeenCalledWith(
      'child2',
      expect.objectContaining({ depth: 1 })
    );
  });

  it('stops cascading at blocks with depth <= original parent depth', async () => {
    const childBlock = createMockBlock({ id: 'child', depth: 2 });
    const siblingBlock = createMockBlock({ id: 'sibling', depth: 1 });

    const { context, depthValidator } = buildOutdentContext({
      currentBlockIndex: 0,
      blocks: [
        createMockBlock({ id: 'parent', depth: 1 }),
        childBlock,
        siblingBlock,
      ],
      depth: 1,
    });

    await handleOutdent(context, depthValidator);

    // Parent updated
    expect(context.api.blocks.update).toHaveBeenCalledWith(
      'parent',
      expect.objectContaining({ depth: 0 })
    );

    // Child updated
    expect(context.api.blocks.update).toHaveBeenCalledWith(
      'child',
      expect.objectContaining({ depth: 1 })
    );

    // Sibling NOT updated
    expect(context.api.blocks.update).not.toHaveBeenCalledWith(
      'sibling',
      expect.anything()
    );
  });

  it('stops cascading at non-list blocks', async () => {
    const childBlock = createMockBlock({ id: 'child', depth: 2 });
    const paragraphBlock = createMockBlock({ id: 'para', name: 'paragraph', depth: 0 });
    const listAfterPara = createMockBlock({ id: 'after-para', depth: 2 });

    const { context, depthValidator } = buildOutdentContext({
      currentBlockIndex: 0,
      blocks: [
        createMockBlock({ id: 'parent', depth: 1 }),
        childBlock,
        paragraphBlock,
        listAfterPara,
      ],
      depth: 1,
    });

    await handleOutdent(context, depthValidator);

    // Parent updated
    expect(context.api.blocks.update).toHaveBeenCalledWith(
      'parent',
      expect.objectContaining({ depth: 0 })
    );

    // Child before paragraph updated
    expect(context.api.blocks.update).toHaveBeenCalledWith(
      'child',
      expect.objectContaining({ depth: 1 })
    );

    // List item after paragraph NOT updated
    expect(context.api.blocks.update).not.toHaveBeenCalledWith(
      'after-para',
      expect.anything()
    );
  });

  it('does nothing when already at depth 0', async () => {
    const { context, depthValidator } = buildOutdentContext({
      currentBlockIndex: 0,
      blocks: [createMockBlock({ id: 'root-item', depth: 0 })],
      depth: 0,
    });

    await handleOutdent(context, depthValidator);

    expect(context.api.blocks.update).not.toHaveBeenCalled();
  });

  it('only updates the parent when there are no children', async () => {
    const siblingBlock = createMockBlock({ id: 'sibling', depth: 1 });

    const { context, depthValidator } = buildOutdentContext({
      currentBlockIndex: 0,
      blocks: [
        createMockBlock({ id: 'leaf', depth: 1 }),
        siblingBlock,
      ],
      depth: 1,
    });

    await handleOutdent(context, depthValidator);

    expect(context.api.blocks.update).toHaveBeenCalledTimes(1);
    expect(context.api.blocks.update).toHaveBeenCalledWith(
      'leaf',
      expect.objectContaining({ depth: 0 })
    );
  });

  it('cascades at deeper nesting levels (depth 2 parent)', async () => {
    const childBlock = createMockBlock({ id: 'child', depth: 3 });
    const grandchildBlock = createMockBlock({ id: 'grandchild', depth: 4 });
    const siblingBlock = createMockBlock({ id: 'sibling', depth: 2 });

    const { context, depthValidator } = buildOutdentContext({
      currentBlockIndex: 0,
      blocks: [
        createMockBlock({ id: 'parent', depth: 2 }),
        childBlock,
        grandchildBlock,
        siblingBlock,
      ],
      depth: 2,
    });

    await handleOutdent(context, depthValidator);

    // Parent reduced from 2 to 1
    expect(context.api.blocks.update).toHaveBeenCalledWith(
      'parent',
      expect.objectContaining({ depth: 1 })
    );

    // Descendants reduced by 1
    expect(context.api.blocks.update).toHaveBeenCalledWith(
      'child',
      expect.objectContaining({ depth: 2 })
    );
    expect(context.api.blocks.update).toHaveBeenCalledWith(
      'grandchild',
      expect.objectContaining({ depth: 3 })
    );

    // Sibling at depth 2 NOT updated
    expect(context.api.blocks.update).not.toHaveBeenCalledWith(
      'sibling',
      expect.anything()
    );
  });
});

describe('handleEnter — cascades outdent on empty nested item', () => {
  let syncContentFromDOM: () => void;
  let updatedBlock: { id: string; holder: HTMLElement };

  beforeEach(() => {
    vi.clearAllMocks();
    syncContentFromDOM = vi.fn<() => void>();

    const holder = document.createElement('div');
    const contentEl = document.createElement('div');
    contentEl.setAttribute('contenteditable', 'true');
    holder.appendChild(contentEl);
    updatedBlock = { id: 'parent-block', holder };
  });

  it('cascades depth reduction to children when Enter on empty nested item', async () => {
    const childBlock = createMockBlock({ id: 'child', depth: 2 });

    const blocks = [
      createMockBlock({ id: 'empty-nested', depth: 1 }),
      childBlock,
    ];

    const blocksAPI = {
      getBlockByIndex: (i: number) => blocks[i] ?? undefined,
      getBlockIndex: (id: string) => {
        const idx = blocks.findIndex(b => b.id === id);
        return idx >= 0 ? idx : undefined;
      },
      getBlocksCount: () => blocks.length,
      getCurrentBlockIndex: () => 0,
    };

    const api = {
      blocks: {
        ...blocksAPI,
        // A FLAT (drag-nested) item: depth lives on data.depth, parentId is null.
        // Such items still outdent via the flat cascade.
        getById: (id: string) => ({ id, name: 'list', parentId: null }),
        update: vi.fn().mockResolvedValue(updatedBlock),
        convert: vi.fn().mockResolvedValue(updatedBlock),
      },
      caret: {
        setToBlock: vi.fn(),
        updateLastCaretAfterPosition: vi.fn(),
      },
    } as unknown as KeyboardContext['api'];

    // Empty content element simulates an empty list item
    const contentEl = document.createElement('div');
    contentEl.innerHTML = '';

    const element = document.createElement('div');
    element.appendChild(contentEl);

    const data: ListItemData = { text: '', style: 'unordered', depth: 1 };
    const depthValidator = new ListDepthValidator(blocksAPI);

    const context: KeyboardContext = {
      api,
      blockId: 'empty-nested',
      data,
      element,
      getContentElement: () => contentEl,
      syncContentFromDOM,
      getDepth: () => data.depth ?? 0,
    };

    await handleEnter(context, depthValidator);

    // Parent should be outdented from 1→0
    expect(api.blocks.update).toHaveBeenCalledWith(
      'empty-nested',
      expect.objectContaining({ depth: 0 })
    );

    // Child should cascade from 2→1
    expect(api.blocks.update).toHaveBeenCalledWith(
      'child',
      expect.objectContaining({ depth: 1 })
    );
  });

  it('outdents a STRUCTURALLY nested empty item by reparenting to the grandparent', async () => {
    // Tree: root(list) > parent(list) > empty-nested(list). Pressing Enter on the
    // empty item promotes it to be a child of root (its grandparent) — structural
    // outdent via parentId, not a flat data.depth decrement.
    const tree: Record<string, { id: string; name: string; parentId: string | null }> = {
      root: { id: 'root', name: 'list', parentId: null },
      parent: { id: 'parent', name: 'list', parentId: 'root' },
      'empty-nested': { id: 'empty-nested', name: 'list', parentId: 'parent' },
    };

    const setBlockParent = vi.fn();
    const api = {
      blocks: {
        getById: (id: string) => tree[id] ?? null,
        setBlockParent,
        update: vi.fn(),
        convert: vi.fn(),
      },
      caret: {
        setToBlock: vi.fn(),
        updateLastCaretAfterPosition: vi.fn(),
      },
    } as unknown as KeyboardContext['api'];

    const contentEl = document.createElement('div');
    contentEl.innerHTML = '';

    const element = document.createElement('div');
    element.appendChild(contentEl);

    const data: ListItemData = { text: '', style: 'unordered' };

    const context: KeyboardContext = {
      api,
      blockId: 'empty-nested',
      data,
      element,
      getContentElement: () => contentEl,
      syncContentFromDOM,
      getDepth: () => 2,
    };

    await handleEnter(context);

    // Reparented to the grandparent ('root'), not converted or flat-decremented.
    expect(setBlockParent).toHaveBeenCalledWith('empty-nested', 'root');
    expect(api.blocks.convert).not.toHaveBeenCalled();
  });
});
