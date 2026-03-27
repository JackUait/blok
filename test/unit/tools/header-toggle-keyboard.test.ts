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
