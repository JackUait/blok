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
  });
});
