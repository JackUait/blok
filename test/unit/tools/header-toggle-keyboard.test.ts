import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import type { API } from '../../../types';
import type { HeaderToggleKeyboardContext } from '../../../src/tools/header/header-toggle-keyboard';

/**
 * Factory to create a mock HeaderToggleKeyboardContext
 */
const createMockContext = (overrides: Partial<HeaderToggleKeyboardContext> = {}): HeaderToggleKeyboardContext => {
  const contentElement = document.createElement('div');

  return {
    api: {
      blocks: {
        splitBlock: vi.fn(),
        getBlockIndex: vi.fn().mockReturnValue(0),
        getCurrentBlockIndex: vi.fn().mockReturnValue(0),
        insertInsideParent: vi.fn().mockReturnValue({ id: 'new-block-id' }),
        getChildren: vi.fn().mockReturnValue([]),
      },
      caret: {
        setToBlock: vi.fn(),
      },
    } as unknown as API,
    blockId: 'test-block-id',
    getText: () => '',
    getContentElement: () => contentElement,
    syncContentFromDOM: vi.fn(),
    isOpen: false,
    currentLevel: 2,
    ...overrides,
  };
};

describe('Header Toggle Keyboard Handlers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('handleHeaderToggleEnter', () => {
    it('inserts child after last descendant when toggle heading already has children', async () => {
      const { handleHeaderToggleEnter } = await import('../../../src/tools/header/header-toggle-keyboard');

      const mockSetToBlock = vi.fn();
      const mockInsertInsideParent = vi.fn().mockReturnValue({ id: 'new-block-id' });
      const mockGetBlockIndex = vi.fn().mockImplementation((id: string) => {
        const indices: Record<string, number> = {
          'test-block-id': 3,
          'child-1': 4,
          'child-2': 5,
        };

        return indices[id];
      });
      const mockGetChildren = vi.fn().mockImplementation((parentId: string) => {
        if (parentId === 'test-block-id') {
          return [{ id: 'child-1' }, { id: 'child-2' }];
        }

        return [];
      });

      const contentElement = document.createElement('div');
      contentElement.setAttribute('contenteditable', 'true');
      contentElement.textContent = 'Heading text';
      document.body.appendChild(contentElement);

      const context = createMockContext({
        getContentElement: () => contentElement,
        isOpen: true,
        api: {
          blocks: {
            splitBlock: vi.fn(),
            getBlockIndex: mockGetBlockIndex,
            getCurrentBlockIndex: vi.fn().mockReturnValue(3),
            insertInsideParent: mockInsertInsideParent,
            getChildren: mockGetChildren,
          },
          caret: { setToBlock: mockSetToBlock },
        } as unknown as API,
      });

      // Selection at end of content
      const range = document.createRange();
      range.selectNodeContents(contentElement);
      range.collapse(false);
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);

      await handleHeaderToggleEnter(context);

      // Should insert AFTER the last child (index 5), not after heading (index 3)
      expect(mockInsertInsideParent).toHaveBeenCalledWith('test-block-id', 6);
      expect(mockSetToBlock).toHaveBeenCalledWith('new-block-id', 'start');

      contentElement.remove();
    });

    it('inserts child after deepest last descendant when last child has nested children', async () => {
      const { handleHeaderToggleEnter } = await import('../../../src/tools/header/header-toggle-keyboard');

      const mockSetToBlock = vi.fn();
      const mockInsertInsideParent = vi.fn().mockReturnValue({ id: 'new-block-id' });
      const mockGetBlockIndex = vi.fn().mockImplementation((id: string) => {
        const indices: Record<string, number> = {
          'test-block-id': 3,
          'child-1': 4,
          'child-2': 5,  // nested toggle
          'grandchild-1': 6,
        };

        return indices[id];
      });
      const mockGetChildren = vi.fn().mockImplementation((parentId: string) => {
        if (parentId === 'test-block-id') {
          return [{ id: 'child-1' }, { id: 'child-2' }];
        }
        if (parentId === 'child-2') {
          return [{ id: 'grandchild-1' }];
        }

        return [];
      });

      const contentElement = document.createElement('div');
      contentElement.setAttribute('contenteditable', 'true');
      contentElement.textContent = 'Heading text';
      document.body.appendChild(contentElement);

      const context = createMockContext({
        getContentElement: () => contentElement,
        isOpen: true,
        api: {
          blocks: {
            splitBlock: vi.fn(),
            getBlockIndex: mockGetBlockIndex,
            getCurrentBlockIndex: vi.fn().mockReturnValue(3),
            insertInsideParent: mockInsertInsideParent,
            getChildren: mockGetChildren,
          },
          caret: { setToBlock: mockSetToBlock },
        } as unknown as API,
      });

      // Selection at end of content
      const range = document.createRange();
      range.selectNodeContents(contentElement);
      range.collapse(false);
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);

      await handleHeaderToggleEnter(context);

      // Should insert AFTER the deepest descendant (grandchild-1 at index 6)
      expect(mockInsertInsideParent).toHaveBeenCalledWith('test-block-id', 7);
      expect(mockSetToBlock).toHaveBeenCalledWith('new-block-id', 'start');

      contentElement.remove();
    });

    // FIX D10: a COLLAPSED toggle heading + Enter at end must insert ONE plain
    // paragraph sibling below (Notion), NOT split into a second toggle heading
    // and NOT add a hidden child.
    it('collapsed toggle heading + Enter at end inserts a plain paragraph sibling', async () => {
      const { handleHeaderToggleEnter } = await import('../../../src/tools/header/header-toggle-keyboard');

      const mockSetToBlock = vi.fn();
      const mockInsert = vi.fn().mockReturnValue({ id: 'new-para-id' });
      const mockSplitBlock = vi.fn();
      const mockInsertInsideParent = vi.fn();

      const contentElement = document.createElement('div');
      contentElement.setAttribute('contenteditable', 'true');
      contentElement.textContent = 'Heading text';
      document.body.appendChild(contentElement);

      const context = createMockContext({
        getContentElement: () => contentElement,
        isOpen: false,
        api: {
          blocks: {
            splitBlock: mockSplitBlock,
            getBlockIndex: vi.fn().mockReturnValue(3),
            getCurrentBlockIndex: vi.fn().mockReturnValue(3),
            insert: mockInsert,
            insertInsideParent: mockInsertInsideParent,
            getChildren: vi.fn().mockReturnValue([]),
          },
          caret: { setToBlock: mockSetToBlock },
        } as unknown as API,
      });

      // Selection at end of content
      const range = document.createRange();
      range.selectNodeContents(contentElement);
      range.collapse(false);
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);

      await handleHeaderToggleEnter(context);

      // Plain paragraph sibling inserted right after the collapsed block (index 4),
      // not a toggle split and not a child.
      expect(mockInsert).toHaveBeenCalledWith('paragraph', undefined, undefined, 4, false);
      expect(mockSetToBlock).toHaveBeenCalledWith('new-para-id', 'start');
      expect(mockSplitBlock).not.toHaveBeenCalled();
      expect(mockInsertInsideParent).not.toHaveBeenCalled();

      contentElement.remove();
    });

    it('collapsed toggle heading + Enter mid-text still splits (keeps existing path)', async () => {
      const { handleHeaderToggleEnter } = await import('../../../src/tools/header/header-toggle-keyboard');

      const mockSplitBlock = vi.fn();
      const mockInsert = vi.fn();

      const contentElement = document.createElement('div');
      contentElement.setAttribute('contenteditable', 'true');
      contentElement.textContent = 'Heading text';
      document.body.appendChild(contentElement);

      const context = createMockContext({
        getContentElement: () => contentElement,
        isOpen: false,
        api: {
          blocks: {
            splitBlock: mockSplitBlock,
            getBlockIndex: vi.fn().mockReturnValue(3),
            getCurrentBlockIndex: vi.fn().mockReturnValue(3),
            insert: mockInsert,
            insertInsideParent: vi.fn(),
            getChildren: vi.fn().mockReturnValue([]),
          },
          caret: { setToBlock: vi.fn() },
        } as unknown as API,
      });

      // Caret in the MIDDLE of the text → afterContent is non-empty → split path.
      const textNode = contentElement.firstChild as Text;
      const range = document.createRange();
      range.setStart(textNode, 4);
      range.setEnd(textNode, 4);
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);

      await handleHeaderToggleEnter(context);

      expect(mockSplitBlock).toHaveBeenCalled();
      expect(mockInsert).not.toHaveBeenCalled();

      contentElement.remove();
    });

    it('inserts at currentBlockIndex + 1 when toggle heading has no children', async () => {
      const { handleHeaderToggleEnter } = await import('../../../src/tools/header/header-toggle-keyboard');

      const mockSetToBlock = vi.fn();
      const mockInsertInsideParent = vi.fn().mockReturnValue({ id: 'new-block-id' });

      const contentElement = document.createElement('div');
      contentElement.setAttribute('contenteditable', 'true');
      contentElement.textContent = 'Heading text';
      document.body.appendChild(contentElement);

      const context = createMockContext({
        getContentElement: () => contentElement,
        isOpen: true,
        api: {
          blocks: {
            splitBlock: vi.fn(),
            getBlockIndex: vi.fn().mockReturnValue(3),
            getCurrentBlockIndex: vi.fn().mockReturnValue(3),
            insertInsideParent: mockInsertInsideParent,
            getChildren: vi.fn().mockReturnValue([]),
          },
          caret: { setToBlock: mockSetToBlock },
        } as unknown as API,
      });

      // Selection at end of content
      const range = document.createRange();
      range.selectNodeContents(contentElement);
      range.collapse(false);
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);

      await handleHeaderToggleEnter(context);

      // With no children, falls back to currentBlockIndex + 1
      expect(mockInsertInsideParent).toHaveBeenCalledWith('test-block-id', 4);
      expect(mockSetToBlock).toHaveBeenCalledWith('new-block-id', 'start');

      contentElement.remove();
    });
  });
});
