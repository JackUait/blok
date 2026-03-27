import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import type { API } from '../../../../types';
import type { ToggleKeyboardContext } from '../../../../src/tools/toggle/toggle-keyboard';
import type { ToggleItemData } from '../../../../src/tools/toggle/types';

/**
 * Mock isCaretAtStartOfInput from caret utilities.
 * We control its return value per test.
 */
const mockIsCaretAtStartOfInput = vi.fn<(input: HTMLElement) => boolean>();

vi.mock('../../../../src/components/utils/caret', () => ({
  isCaretAtStartOfInput: (...args: [HTMLElement]) => mockIsCaretAtStartOfInput(...args),
}));

/**
 * Factory to create a mock ToggleKeyboardContext
 */
const createMockContext = (overrides: Partial<ToggleKeyboardContext> = {}): ToggleKeyboardContext => {
  const contentElement = document.createElement('div');

  return {
    api: {
      blocks: {
        splitBlock: vi.fn(),
        convert: vi.fn().mockResolvedValue({ holder: document.createElement('div') }),
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
    data: { text: '' } as ToggleItemData,
    element: document.createElement('div'),
    getContentElement: () => contentElement,
    syncContentFromDOM: vi.fn(),
    isOpen: false,
    setOpen: vi.fn(),
    ...overrides,
  };
};

describe('Toggle Keyboard Handlers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('handleToggleEnter', () => {
    it('calls syncContentFromDOM and splitBlock with correct arguments', async () => {
      const { handleToggleEnter } = await import('../../../../src/tools/toggle/toggle-keyboard');

      const contentElement = document.createElement('div');
      contentElement.setAttribute('contenteditable', 'true');
      contentElement.textContent = 'hello';
      document.body.appendChild(contentElement);

      const context = createMockContext({
        getContentElement: () => contentElement,
      });

      // Set up a selection at position 0 so splitBlock can split content
      const range = document.createRange();
      range.setStart(contentElement.childNodes[0], 0);
      range.setEnd(contentElement.childNodes[0], 0);
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);

      await handleToggleEnter(context);

      expect(context.syncContentFromDOM).toHaveBeenCalledOnce();
      expect(context.api.blocks.splitBlock).toHaveBeenCalledOnce();
      expect(context.api.blocks.splitBlock).toHaveBeenCalledWith(
        'test-block-id',
        { text: '' },
        'toggle',
        { text: 'hello' },
        1
      );

      contentElement.remove();
    });

    it('sets caret to new child block when toggle is open and caret is at end', async () => {
      const { handleToggleEnter } = await import('../../../../src/tools/toggle/toggle-keyboard');

      const mockSetToBlock = vi.fn();
      const mockInsertInsideParent = vi.fn().mockReturnValue({ id: 'new-block-id' });
      const contentElement = document.createElement('div');
      contentElement.setAttribute('contenteditable', 'true');
      // Empty content so afterContent will be ''
      contentElement.textContent = '';
      document.body.appendChild(contentElement);

      const context = createMockContext({
        getContentElement: () => contentElement,
        isOpen: true,
        api: {
          blocks: {
            splitBlock: vi.fn(),
            convert: vi.fn().mockResolvedValue({ holder: document.createElement('div') }),
            getBlockIndex: vi.fn().mockReturnValue(0),
            getCurrentBlockIndex: vi.fn().mockReturnValue(0),
            insertInsideParent: mockInsertInsideParent,
            getChildren: vi.fn().mockReturnValue([]),
          },
          caret: { setToBlock: mockSetToBlock },
        } as unknown as API,
      });

      // Selection at end of empty content element
      const range = document.createRange();
      range.selectNodeContents(contentElement);
      range.collapse(false);
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);

      await handleToggleEnter(context);

      // insertInsideParent should be called with (parentId, insertIndex)
      expect(mockInsertInsideParent).toHaveBeenCalledWith('test-block-id', 1);
      expect(mockSetToBlock).toHaveBeenCalledWith('new-block-id', 'start');

      contentElement.remove();
    });

    it('inserts child after last descendant when toggle already has children', async () => {
      const { handleToggleEnter } = await import('../../../../src/tools/toggle/toggle-keyboard');

      const mockSetToBlock = vi.fn();
      const mockInsertInsideParent = vi.fn().mockReturnValue({ id: 'new-block-id' });
      const mockGetBlockIndex = vi.fn().mockImplementation((id: string) => {
        const indices: Record<string, number> = {
          'test-block-id': 5,
          'child-1': 6,
          'child-2': 7,
          'child-3': 8,
        };

        return indices[id];
      });
      const mockGetChildren = vi.fn().mockImplementation((parentId: string) => {
        if (parentId === 'test-block-id') {
          return [{ id: 'child-1' }, { id: 'child-2' }, { id: 'child-3' }];
        }

        return [];
      });

      const contentElement = document.createElement('div');
      contentElement.setAttribute('contenteditable', 'true');
      contentElement.textContent = 'Toggle heading';
      document.body.appendChild(contentElement);

      const context = createMockContext({
        getContentElement: () => contentElement,
        isOpen: true,
        api: {
          blocks: {
            splitBlock: vi.fn(),
            convert: vi.fn().mockResolvedValue({ holder: document.createElement('div') }),
            getBlockIndex: mockGetBlockIndex,
            getCurrentBlockIndex: vi.fn().mockReturnValue(5),
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

      await handleToggleEnter(context);

      // Should insert AFTER the last child (index 8), not after toggle (index 5)
      expect(mockInsertInsideParent).toHaveBeenCalledWith('test-block-id', 9);
      expect(mockSetToBlock).toHaveBeenCalledWith('new-block-id', 'start');

      contentElement.remove();
    });

    it('inserts child after deepest last descendant when last child has nested children', async () => {
      const { handleToggleEnter } = await import('../../../../src/tools/toggle/toggle-keyboard');

      const mockSetToBlock = vi.fn();
      const mockInsertInsideParent = vi.fn().mockReturnValue({ id: 'new-block-id' });
      const mockGetBlockIndex = vi.fn().mockImplementation((id: string) => {
        const indices: Record<string, number> = {
          'test-block-id': 5,
          'child-1': 6,
          'child-2': 7,  // nested toggle
          'grandchild-1': 8,
          'grandchild-2': 9,
        };

        return indices[id];
      });
      const mockGetChildren = vi.fn().mockImplementation((parentId: string) => {
        if (parentId === 'test-block-id') {
          return [{ id: 'child-1' }, { id: 'child-2' }];
        }
        if (parentId === 'child-2') {
          return [{ id: 'grandchild-1' }, { id: 'grandchild-2' }];
        }

        return [];
      });

      const contentElement = document.createElement('div');
      contentElement.setAttribute('contenteditable', 'true');
      contentElement.textContent = 'Toggle heading';
      document.body.appendChild(contentElement);

      const context = createMockContext({
        getContentElement: () => contentElement,
        isOpen: true,
        api: {
          blocks: {
            splitBlock: vi.fn(),
            convert: vi.fn().mockResolvedValue({ holder: document.createElement('div') }),
            getBlockIndex: mockGetBlockIndex,
            getCurrentBlockIndex: vi.fn().mockReturnValue(5),
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

      await handleToggleEnter(context);

      // Should insert AFTER the deepest last descendant (grandchild-2 at index 9)
      expect(mockInsertInsideParent).toHaveBeenCalledWith('test-block-id', 10);
      expect(mockSetToBlock).toHaveBeenCalledWith('new-block-id', 'start');

      contentElement.remove();
    });
  });

  describe('handleToggleBackspace', () => {
    it('converts to paragraph when content is empty and caret is at start', async () => {
      const { handleToggleBackspace } = await import('../../../../src/tools/toggle/toggle-keyboard');
      const context = createMockContext({
        data: { text: '' },
      });

      mockIsCaretAtStartOfInput.mockReturnValue(true);

      const event = new KeyboardEvent('keydown', { key: 'Backspace' });
      const preventDefaultSpy = vi.spyOn(event, 'preventDefault');

      await handleToggleBackspace(context, event);

      expect(preventDefaultSpy).toHaveBeenCalledOnce();
      expect(context.api.blocks.convert).toHaveBeenCalledWith(
        'test-block-id',
        'paragraph',
        { text: '' }
      );
    });

    it('does NOT convert when caret is not at start (text exists)', async () => {
      const { handleToggleBackspace } = await import('../../../../src/tools/toggle/toggle-keyboard');
      const contentElement = document.createElement('div');
      contentElement.textContent = 'some text';

      const context = createMockContext({
        data: { text: 'some text' },
        getContentElement: () => contentElement,
      });

      mockIsCaretAtStartOfInput.mockReturnValue(false);

      const event = new KeyboardEvent('keydown', { key: 'Backspace' });
      const preventDefaultSpy = vi.spyOn(event, 'preventDefault');

      await handleToggleBackspace(context, event);

      expect(preventDefaultSpy).not.toHaveBeenCalled();
      expect(context.api.blocks.convert).not.toHaveBeenCalled();
    });

    it('does nothing when blockId is undefined', async () => {
      const { handleToggleBackspace } = await import('../../../../src/tools/toggle/toggle-keyboard');
      const context = createMockContext({
        blockId: undefined,
        data: { text: '' },
      });

      mockIsCaretAtStartOfInput.mockReturnValue(true);

      const event = new KeyboardEvent('keydown', { key: 'Backspace' });
      const preventDefaultSpy = vi.spyOn(event, 'preventDefault');

      await handleToggleBackspace(context, event);

      expect(preventDefaultSpy).not.toHaveBeenCalled();
      expect(context.api.blocks.convert).not.toHaveBeenCalled();
    });

    it('does nothing when content element is null', async () => {
      const { handleToggleBackspace } = await import('../../../../src/tools/toggle/toggle-keyboard');
      const context = createMockContext({
        data: { text: '' },
        getContentElement: () => null,
      });

      const event = new KeyboardEvent('keydown', { key: 'Backspace' });
      const preventDefaultSpy = vi.spyOn(event, 'preventDefault');

      await handleToggleBackspace(context, event);

      expect(preventDefaultSpy).not.toHaveBeenCalled();
      expect(context.api.blocks.convert).not.toHaveBeenCalled();
    });

    it('syncs content from DOM before checking emptiness (Bug 16)', async () => {
      const { handleToggleBackspace } = await import('../../../../src/tools/toggle/toggle-keyboard');

      const contentElement = document.createElement('div');
      contentElement.innerHTML = '';

      /**
       * Simulate stale data: data.text is non-empty but DOM is actually empty.
       * Without syncContentFromDOM, the handler would read stale data.text and
       * skip the convert, leaving the user stuck in a toggle block.
       */
      const context = createMockContext({
        data: { text: 'stale content' },
        getContentElement: () => contentElement,
        syncContentFromDOM: vi.fn(() => {
          // When called, syncs the empty DOM to data.text
          context.data.text = contentElement.innerHTML;
        }),
      });

      mockIsCaretAtStartOfInput.mockReturnValue(true);

      const event = new KeyboardEvent('keydown', { key: 'Backspace' });

      await handleToggleBackspace(context, event);

      expect(context.syncContentFromDOM).toHaveBeenCalledOnce();
      expect(context.api.blocks.convert).toHaveBeenCalledWith(
        'test-block-id',
        'paragraph',
        { text: '' }
      );
    });
  });
});
