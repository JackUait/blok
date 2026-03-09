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
        insert: vi.fn().mockReturnValue({ id: 'new-block-id' }),
        setBlockParent: vi.fn(),
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
            insert: vi.fn().mockReturnValue({ id: 'new-block-id' }),
            setBlockParent: vi.fn(),
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

      expect(context.api.blocks.insert).toHaveBeenCalledWith('paragraph', { text: '' }, {}, 1, true);
      expect(context.api.blocks.setBlockParent).toHaveBeenCalledWith('new-block-id', 'test-block-id');
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
