/**
 * Regression tests for Backspace at the START of a list item.
 *
 * Notion parity (M-3): Backspace at offset 0 of a NON-EMPTY list item converts it
 * to a plain PARAGRAPH in place, KEEPING its current indent — a structurally
 * nested item stays nested under the same parent (convert/replace preserves
 * parentId). It does NOT outdent and does NOT merge; a later Backspace then merges
 * like a paragraph. This supersedes the earlier "nested item outdents" lock — top
 * AND nested items now converge on the same convert-to-paragraph behavior.
 *
 * Notion parity (m-10): a modifier-held Backspace (Cmd/Ctrl/Alt) is a word/line
 * delete, not a list op. At offset 0 native delete is a no-op, so the marker stays
 * intact and convert/outdent must NOT fire.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleBackspace } from '../../../../src/tools/list/list-keyboard';
import type { KeyboardContext } from '../../../../src/tools/list/list-keyboard';
import type { ListItemData } from '../../../../src/tools/list/types';

const createKeyboardEvent = (modifiers: Partial<Pick<KeyboardEvent, 'metaKey' | 'ctrlKey' | 'altKey'>> = {}): KeyboardEvent => {
  return {
    metaKey: false,
    ctrlKey: false,
    altKey: false,
    ...modifiers,
    preventDefault: vi.fn(),
    stopPropagation: vi.fn(),
  } as unknown as KeyboardEvent;
};

/**
 * A converted-block stub with the holder shape setCaretToBlockContent reads.
 */
const createConvertedBlock = (id: string): { id: string; holder: HTMLElement } => {
  const holder = document.createElement('div');
  const innerContent = document.createElement('div');
  innerContent.setAttribute('contenteditable', 'true');
  holder.appendChild(innerContent);

  return { id, holder };
};

/**
 * Build a content element with a collapsed caret at the very START of its text,
 * wired into the live document selection so `isAtStart`/`isEntireContentSelected`
 * (which read real Ranges) resolve correctly.
 */
const buildContentWithCaretAtStart = (text: string): HTMLElement => {
  const contentEl = document.createElement('div');
  contentEl.contentEditable = 'true';
  contentEl.textContent = text;
  document.body.appendChild(contentEl);

  const range = document.createRange();
  const textNode = contentEl.firstChild ?? contentEl;
  range.setStart(textNode, 0);
  range.collapse(true);

  const selection = window.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);

  return contentEl;
};

beforeEach(() => {
  vi.clearAllMocks();
  document.body.innerHTML = '';
});

describe('handleBackspace — non-empty item converts to a paragraph in place', () => {
  it('converts a STRUCTURALLY nested item to a paragraph (no outdent, keeps parentId via convert)', async () => {
    // Tree: root(list) > parent(list) > nested(list). Backspace at the start of
    // `nested` converts it to a paragraph that STAYS nested under `parent` —
    // convert()/replace() preserves parentId. It must NOT reparent to grandparent.
    const tree: Record<string, { id: string; name: string; parentId: string | null }> = {
      root: { id: 'root', name: 'list', parentId: null },
      parent: { id: 'parent', name: 'list', parentId: 'root' },
      nested: { id: 'nested', name: 'list', parentId: 'parent' },
    };

    const setBlockParent = vi.fn();
    const convert = vi.fn().mockResolvedValue(createConvertedBlock('nested'));
    const api = {
      blocks: {
        getById: (id: string) => tree[id] ?? null,
        setBlockParent,
        convert,
        update: vi.fn(),
      },
      caret: {
        setToBlock: vi.fn(),
        updateLastCaretAfterPosition: vi.fn(),
      },
    } as unknown as KeyboardContext['api'];

    const contentEl = buildContentWithCaretAtStart('nested item');
    const element = document.createElement('div');
    element.appendChild(contentEl);

    const data: ListItemData = { text: 'nested item', style: 'unordered' };

    const context: KeyboardContext = {
      api,
      blockId: 'nested',
      data,
      element,
      getContentElement: () => contentEl,
      syncContentFromDOM: vi.fn(),
      getDepth: () => 2,
    };

    await handleBackspace(context, createKeyboardEvent());

    // Converted to a paragraph in place; NOT reparented/outdented.
    expect(convert).toHaveBeenCalledWith('nested', 'paragraph', { text: 'nested item' });
    expect(setBlockParent).not.toHaveBeenCalled();
  });

  it('converts a FLAT (drag-nested) item to a paragraph (no flat-depth outdent)', async () => {
    const convert = vi.fn().mockResolvedValue(createConvertedBlock('flat'));
    const update = vi.fn();
    const api = {
      blocks: {
        // A FLAT item: depth lives on data.depth, parentId is null.
        getById: (id: string) => ({ id, name: 'list', parentId: null }),
        setBlockParent: vi.fn(),
        convert,
        update,
        getBlockIndex: () => 0,
        getBlockByIndex: () => undefined,
        getBlocksCount: () => 1,
        getCurrentBlockIndex: () => 0,
      },
      caret: {
        setToBlock: vi.fn(),
        updateLastCaretAfterPosition: vi.fn(),
      },
    } as unknown as KeyboardContext['api'];

    const contentEl = buildContentWithCaretAtStart('flat item');
    const element = document.createElement('div');
    element.appendChild(contentEl);

    const data: ListItemData = { text: 'flat item', style: 'unordered', depth: 1 };

    const context: KeyboardContext = {
      api,
      blockId: 'flat',
      data,
      element,
      getContentElement: () => contentEl,
      syncContentFromDOM: vi.fn(),
      getDepth: () => 1,
    };

    await handleBackspace(context, createKeyboardEvent());

    // Converts to a paragraph; the old flat-depth outdent (update depth-1) is gone.
    expect(convert).toHaveBeenCalledWith('flat', 'paragraph', { text: 'flat item' });
    expect(update).not.toHaveBeenCalled();
  });

  it('converts a TOP-LEVEL item to a paragraph (preserving content)', async () => {
    const setBlockParent = vi.fn();
    const convert = vi.fn().mockResolvedValue(createConvertedBlock('top'));
    const api = {
      blocks: {
        getById: (id: string) => ({ id, name: 'list', parentId: null }),
        setBlockParent,
        convert,
        update: vi.fn(),
      },
      caret: {
        setToBlock: vi.fn(),
        updateLastCaretAfterPosition: vi.fn(),
      },
    } as unknown as KeyboardContext['api'];

    const contentEl = buildContentWithCaretAtStart('top item');
    const element = document.createElement('div');
    element.appendChild(contentEl);

    const data: ListItemData = { text: 'top item', style: 'unordered', depth: 0 };

    const context: KeyboardContext = {
      api,
      blockId: 'top',
      data,
      element,
      getContentElement: () => contentEl,
      syncContentFromDOM: vi.fn(),
      getDepth: () => 0,
    };

    await handleBackspace(context, createKeyboardEvent());

    expect(convert).toHaveBeenCalledWith('top', 'paragraph', { text: 'top item' });
    expect(setBlockParent).not.toHaveBeenCalled();
  });
});

/**
 * BUG 2: a PARTIAL text selection that starts at offset 0 (e.g. selecting just
 * "hello" from "hello world") + Backspace must delete the selected text
 * natively — it must NOT convert the whole item to a paragraph. The old code
 * only checked isAtStart (true for any selection anchored at 0) without first
 * ruling out a non-collapsed selection, so it swallowed the delete and converted
 * using the FULL text.
 */
describe('handleBackspace — partial selection at offset 0 deletes normally (BUG 2)', () => {
  /**
   * Build the item's `element` wrapper with an inner content element carrying a
   * NON-collapsed selection over the first `selectedLength` chars (anchored at
   * offset 0). The selection is applied AFTER the node is in its final DOM
   * position — reparenting a selected node collapses the selection in jsdom.
   */
  const buildElementWithLeadingSelection = (
    text: string,
    selectedLength: number
  ): { element: HTMLElement; contentEl: HTMLElement } => {
    const element = document.createElement('div');
    const contentEl = document.createElement('div');
    contentEl.contentEditable = 'true';
    contentEl.textContent = text;
    element.appendChild(contentEl);
    document.body.appendChild(element);

    const textNode = contentEl.firstChild ?? contentEl;
    const range = document.createRange();
    range.setStart(textNode, 0);
    range.setEnd(textNode, selectedLength);

    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);

    return { element, contentEl };
  };

  it('does NOT convert to a paragraph and does NOT preventDefault when a partial leading selection exists', async () => {
    const convert = vi.fn();
    const update = vi.fn();
    const api = {
      blocks: {
        getById: (id: string) => ({ id, name: 'list', parentId: null }),
        setBlockParent: vi.fn(),
        convert,
        update,
      },
      caret: { setToBlock: vi.fn(), updateLastCaretAfterPosition: vi.fn() },
    } as unknown as KeyboardContext['api'];

    // Select just "hello" out of "hello world" (offsets 0..5).
    const { element, contentEl } = buildElementWithLeadingSelection('hello world', 5);

    const data: ListItemData = { text: 'hello world', style: 'unordered', depth: 0 };

    const context: KeyboardContext = {
      api,
      blockId: 'item',
      data,
      element,
      getContentElement: () => contentEl,
      syncContentFromDOM: vi.fn(),
      getDepth: () => 0,
    };

    const event = createKeyboardEvent();

    await handleBackspace(context, event);

    // Native deletion proceeds: no convert, no preventDefault.
    expect(convert).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
    expect(event.preventDefault).not.toHaveBeenCalled();
  });

  it('still converts to a paragraph on a COLLAPSED caret at offset 0', async () => {
    const convert = vi.fn().mockResolvedValue(createConvertedBlock('item'));
    const api = {
      blocks: {
        getById: (id: string) => ({ id, name: 'list', parentId: null }),
        setBlockParent: vi.fn(),
        convert,
        update: vi.fn(),
      },
      caret: { setToBlock: vi.fn(), updateLastCaretAfterPosition: vi.fn() },
    } as unknown as KeyboardContext['api'];

    const contentEl = buildContentWithCaretAtStart('hello world');
    const element = document.createElement('div');
    element.appendChild(contentEl);

    const data: ListItemData = { text: 'hello world', style: 'unordered', depth: 0 };

    const context: KeyboardContext = {
      api,
      blockId: 'item',
      data,
      element,
      getContentElement: () => contentEl,
      syncContentFromDOM: vi.fn(),
      getDepth: () => 0,
    };

    const event = createKeyboardEvent();

    await handleBackspace(context, event);

    expect(convert).toHaveBeenCalledWith('item', 'paragraph', { text: 'hello world' });
    expect(event.preventDefault).toHaveBeenCalled();
  });
});

describe('handleBackspace — m-10 modifier-held Backspace bails (marker intact)', () => {
  const buildModifierContext = (): { context: KeyboardContext; convert: ReturnType<typeof vi.fn>; update: ReturnType<typeof vi.fn> } => {
    const convert = vi.fn();
    const update = vi.fn();
    const api = {
      blocks: {
        getById: (id: string) => ({ id, name: 'list', parentId: null }),
        setBlockParent: vi.fn(),
        convert,
        update,
      },
      caret: { setToBlock: vi.fn(), updateLastCaretAfterPosition: vi.fn() },
    } as unknown as KeyboardContext['api'];

    const contentEl = buildContentWithCaretAtStart('hello');
    const element = document.createElement('div');
    element.appendChild(contentEl);

    const data: ListItemData = { text: 'hello', style: 'unordered', depth: 0 };

    const context: KeyboardContext = {
      api,
      blockId: 'b',
      data,
      element,
      getContentElement: () => contentEl,
      syncContentFromDOM: vi.fn(),
      getDepth: () => 0,
    };

    return { context, convert, update };
  };

  it.each([
    ['metaKey', { metaKey: true }],
    ['ctrlKey', { ctrlKey: true }],
    ['altKey', { altKey: true }],
  ])('does NOT convert or outdent when %s is held at offset 0', async (_label, modifiers) => {
    const { context, convert, update } = buildModifierContext();
    const event = createKeyboardEvent(modifiers);

    await handleBackspace(context, event);

    // Marker intact: no list op fired. preventDefault stops the shared handler
    // from merging into the previous block.
    expect(convert).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
    expect(event.preventDefault).toHaveBeenCalled();
  });
});
