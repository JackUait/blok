/**
 * Regression tests for BUG #11 — Backspace at the START of a NESTED list item
 * OUTDENTS it one level (Notion), mirroring the Enter-on-empty outdent path,
 * instead of always converting it to a (visually indented) paragraph. Only a
 * top-level item converts to a paragraph.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleBackspace } from '../../../../src/tools/list/list-keyboard';
import type { KeyboardContext } from '../../../../src/tools/list/list-keyboard';
import type { ListItemData } from '../../../../src/tools/list/types';

const createKeyboardEvent = (): KeyboardEvent => {
  return {
    preventDefault: vi.fn(),
    stopPropagation: vi.fn(),
  } as unknown as KeyboardEvent;
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

describe('handleBackspace — nested list item outdents instead of converting', () => {
  it('outdents a STRUCTURALLY nested item by reparenting to the grandparent (no convert)', async () => {
    // Tree: root(list) > parent(list) > nested(list). Backspace at the start of
    // `nested` promotes it to be a child of `root` (its grandparent).
    const tree: Record<string, { id: string; name: string; parentId: string | null }> = {
      root: { id: 'root', name: 'list', parentId: null },
      parent: { id: 'parent', name: 'list', parentId: 'root' },
      nested: { id: 'nested', name: 'list', parentId: 'parent' },
    };

    const setBlockParent = vi.fn();
    const convert = vi.fn();
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

    // Reparented to the grandparent ('root') — NOT converted to a paragraph.
    expect(setBlockParent).toHaveBeenCalledWith('nested', 'root');
    expect(convert).not.toHaveBeenCalled();
  });

  it('outdents a FLAT (drag-nested) item via the depth carrier (no convert)', async () => {
    const holder = document.createElement('div');
    const innerContent = document.createElement('div');
    innerContent.setAttribute('contenteditable', 'true');
    holder.appendChild(innerContent);
    const updatedBlock = { id: 'flat', holder };

    const convert = vi.fn();
    const update = vi.fn().mockResolvedValue(updatedBlock);
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

    // Flat outdent decrements the depth carrier; it must NOT convert to paragraph.
    expect(update).toHaveBeenCalledWith('flat', expect.objectContaining({ depth: 0 }));
    expect(convert).not.toHaveBeenCalled();
  });

  it('converts a TOP-LEVEL item to a paragraph (preserving content)', async () => {
    const holder = document.createElement('div');
    const innerContent = document.createElement('div');
    innerContent.setAttribute('contenteditable', 'true');
    holder.appendChild(innerContent);
    const convertedBlock = { id: 'top', holder };

    const setBlockParent = vi.fn();
    const convert = vi.fn().mockResolvedValue(convertedBlock);
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

    // At the top level the item converts to a paragraph, keeping its text.
    expect(convert).toHaveBeenCalledWith('top', 'paragraph', { text: 'top item' });
    expect(setBlockParent).not.toHaveBeenCalled();
  });
});
