/**
 * Unit tests for list-keyboard handleIndent & handleOutdent
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleOutdent, handleEnter, handleIndent, toggleChecklistChecked } from '../../../../src/tools/list/list-keyboard';
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
 * Structurally-nested list items (those with a list parentId) indent via the
 * shared KeyboardNavigation handler, identical to text/headers — covered by
 * test/unit/components/modules/blockEvents/composers/keyboardNavigation.test.ts.
 *
 * FLAT-carrier items (top-level / drag-nested, getStructuralListDepth() === null)
 * still indent via this `handleIndent` (data.depth mutation). Its Notion-parity
 * first-in-group guard is covered below.
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

/**
 * Notion parity: keyboard Tab on a flat-carrier list item indents it ONLY when
 * there is a preceding LIST sibling to nest under (mirroring the structural
 * getPrecedingSibling guard). A FIRST-in-group item — the first block, or a list
 * item whose previous block is not a list — has nothing to nest under, so Tab is a
 * strict no-op.
 *
 * Regression: the flat `handleIndent` derived its cap from `getMaxAllowedDepth`,
 * which returns 1 for first-in-group items, so the first bullet of every list
 * could be wrongly indented to an orphaned depth 1. Notion makes that a no-op.
 */
describe('handleIndent — Notion-parity first-in-group guard', () => {
  let data: ListItemData;
  let syncContentFromDOM: () => void;

  beforeEach(() => {
    vi.clearAllMocks();
    data = { text: 'item', style: 'unordered', depth: 0 };
    syncContentFromDOM = vi.fn<() => void>();
  });

  const buildIndentContext = (overrides: {
    currentBlockIndex: number;
    blocks: ReturnType<typeof createMockBlock>[];
    depth?: number;
  }): { context: KeyboardContext; depthValidator: ListDepthValidator; update: ReturnType<typeof vi.fn> } => {
    const { currentBlockIndex, blocks, depth = 0 } = overrides;
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

    const holder = document.createElement('div');
    const contentEl = document.createElement('div');
    contentEl.setAttribute('contenteditable', 'true');
    holder.appendChild(contentEl);
    const update = vi.fn().mockResolvedValue({ id: blocks[currentBlockIndex]?.id ?? 'b', holder });

    const api = {
      blocks: { ...blocksAPI, update },
      caret: { setToBlock: vi.fn(), updateLastCaretAfterPosition: vi.fn() },
    } as unknown as KeyboardContext['api'];

    const context: KeyboardContext = {
      api,
      blockId: blocks[currentBlockIndex]?.id ?? 'test-block',
      data,
      element: document.createElement('div'),
      getContentElement: () => contentEl,
      syncContentFromDOM,
      getDepth: () => data.depth ?? 0,
    };

    return { context, depthValidator: new ListDepthValidator(blocksAPI), update };
  };

  it('is a no-op for the FIRST block (index 0) — no preceding sibling to nest under', async () => {
    const { context, depthValidator, update } = buildIndentContext({
      currentBlockIndex: 0,
      blocks: [createMockBlock({ id: 'a', depth: 0 }), createMockBlock({ id: 'b', depth: 0 })],
      depth: 0,
    });

    await handleIndent(context, depthValidator);

    expect(update).not.toHaveBeenCalled();
    expect(data.depth).toBe(0);
  });

  /**
   * Notion parity (M-2): when the previous block is NON-list, this FLAT handleIndent
   * is a no-op — but the tool no longer swallows the Tab. The handleKeyDown router
   * leaves the event un-prevented so the shared structural handler nests the item
   * under the preceding paragraph/heading (covered by the Tab-routing test). So this
   * function being a no-op is a DEFERRAL to that handler, not a global Tab no-op.
   */
  it('defers (no flat depth bump) for a first-in-group item whose previous block is NOT a list', async () => {
    const { context, depthValidator, update } = buildIndentContext({
      currentBlockIndex: 1,
      blocks: [createMockBlock({ id: 'p', name: 'paragraph' }), createMockBlock({ id: 'a', depth: 0 })],
      depth: 0,
    });

    await handleIndent(context, depthValidator);

    expect(update).not.toHaveBeenCalled();
    expect(data.depth).toBe(0);
  });

  it('indents a SECOND list item one level (preceding list sibling exists)', async () => {
    const { context, depthValidator, update } = buildIndentContext({
      currentBlockIndex: 1,
      blocks: [createMockBlock({ id: 'a', depth: 0 }), createMockBlock({ id: 'b', depth: 0 })],
      depth: 0,
    });

    await handleIndent(context, depthValidator);

    expect(update).toHaveBeenCalledWith('b', expect.objectContaining({ depth: 1 }));
  });
});

/**
 * Notion parity (m-9): Enter at the END of a CHECKED to-do creates a new UNCHECKED
 * to-do — the checked state must NOT carry over. Text and depth still preserve.
 */
describe('handleEnter — new to-do is unchecked even when split from a checked one', () => {
  it('splits a checked checklist item into a new UNCHECKED item (text/depth preserved)', async () => {
    const newBlockHolder = document.createElement('div');
    const inner = document.createElement('div');
    inner.setAttribute('contenteditable', 'true');
    newBlockHolder.appendChild(inner);
    const newBlock = { id: 'new', holder: newBlockHolder };

    const splitBlock = vi.fn().mockReturnValue(newBlock);
    const api = {
      blocks: {
        getBlockIndex: () => 0,
        getCurrentBlockIndex: () => 0,
        splitBlock,
      },
      caret: { setToBlock: vi.fn(), updateLastCaretAfterPosition: vi.fn() },
    } as unknown as KeyboardContext['api'];

    // Caret at the END of "task" so the item is non-empty and splits.
    const contentEl = document.createElement('div');
    contentEl.contentEditable = 'true';
    contentEl.textContent = 'task';
    document.body.appendChild(contentEl);

    const range = document.createRange();
    range.selectNodeContents(contentEl);
    range.collapse(false);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);

    const element = document.createElement('div');
    element.appendChild(contentEl);

    const data: ListItemData = { text: 'task', style: 'checklist', checked: true, depth: 2 };

    const context: KeyboardContext = {
      api,
      blockId: 'current',
      data,
      element,
      getContentElement: () => contentEl,
      syncContentFromDOM: vi.fn(),
      getDepth: () => 2,
    };

    await handleEnter(context);

    // The 4th arg is the NEW block's data — it must be unchecked, same style/depth.
    expect(splitBlock).toHaveBeenCalledWith(
      'current',
      expect.anything(),
      'list',
      expect.objectContaining({ style: 'checklist', checked: false, depth: 2 }),
      1
    );
  });
});

/**
 * Notion parity (m-11): Cmd/Ctrl+Enter toggles a to-do's checkbox IN PLACE — it
 * flips data.checked, syncs the checkbox + strike-through, persists, and does NOT
 * create a new item. Non-checklist styles are ignored (caller falls back to Enter).
 */
describe('toggleChecklistChecked — Cmd/Ctrl+Enter checkbox toggle', () => {
  const buildToggleContext = (style: ListItemData['style'], checked: boolean): {
    context: KeyboardContext;
    update: ReturnType<typeof vi.fn>;
    checkbox: HTMLInputElement;
    contentEl: HTMLElement;
    data: ListItemData;
  } => {
    const update = vi.fn().mockResolvedValue(undefined);
    const api = {
      blocks: { update },
      caret: { setToBlock: vi.fn(), updateLastCaretAfterPosition: vi.fn() },
    } as unknown as KeyboardContext['api'];

    const element = document.createElement('div');
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = checked;
    element.appendChild(checkbox);

    const contentEl = document.createElement('div');
    contentEl.contentEditable = 'true';
    contentEl.textContent = 'task';
    if (checked) {
      contentEl.classList.add('line-through', 'opacity-60');
    }
    element.appendChild(contentEl);

    const data: ListItemData = { text: 'task', style, checked };

    const context: KeyboardContext = {
      api,
      blockId: 'todo',
      data,
      element,
      getContentElement: () => contentEl,
      syncContentFromDOM: vi.fn(),
      getDepth: () => 0,
    };

    return { context, update, checkbox, contentEl, data };
  };

  it('checks an unchecked to-do and persists', async () => {
    const { context, update, checkbox, contentEl, data } = buildToggleContext('checklist', false);

    const handled = await toggleChecklistChecked(context);

    expect(handled).toBe(true);
    expect(data.checked).toBe(true);
    expect(checkbox.checked).toBe(true);
    expect(contentEl.classList.contains('line-through')).toBe(true);
    expect(contentEl.classList.contains('opacity-60')).toBe(true);
    expect(update).toHaveBeenCalledWith('todo', expect.objectContaining({ checked: true }));
  });

  it('unchecks a checked to-do and persists', async () => {
    const { context, update, checkbox, contentEl, data } = buildToggleContext('checklist', true);

    const handled = await toggleChecklistChecked(context);

    expect(handled).toBe(true);
    expect(data.checked).toBe(false);
    expect(checkbox.checked).toBe(false);
    expect(contentEl.classList.contains('line-through')).toBe(false);
    expect(update).toHaveBeenCalledWith('todo', expect.objectContaining({ checked: false }));
  });

  it('is a no-op for non-checklist styles (returns false, no persist)', async () => {
    const { context, update, data } = buildToggleContext('unordered', false);

    const handled = await toggleChecklistChecked(context);

    expect(handled).toBe(false);
    expect(data.checked).toBe(false);
    expect(update).not.toHaveBeenCalled();
  });
});
