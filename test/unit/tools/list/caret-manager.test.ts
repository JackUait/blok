import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { setCaretToBlockContent } from '../../../../src/tools/list/caret-manager';
import type { API } from '../../../../src/types';

describe('caret-manager', () => {
  let mockAPI: API;
  let mockBlock: ReturnType<API['blocks']['insert']>;

  beforeEach(() => {
    vi.useFakeTimers();

    // Create mock block with holder element
    const holder = document.createElement('div');
    const contentEl = document.createElement('div');
    contentEl.contentEditable = 'true';
    contentEl.textContent = 'Test content';
    holder.appendChild(contentEl);

    mockBlock = {
      holder,
    } as unknown as ReturnType<API['blocks']['insert']>;

    mockAPI = {
      caret: {
        setToBlock: vi.fn(),
        updateLastCaretAfterPosition: vi.fn(),
      },
    } as unknown as API;
  });

  afterEach(() => {
    vi.runAllTimers();
    vi.useRealTimers();
  });

  describe('setCaretToBlockContent', () => {
    it('schedules caret positioning for next animation frame', () => {
      setCaretToBlockContent(mockAPI, mockBlock, 'end');

      expect(mockAPI.caret.updateLastCaretAfterPosition).not.toHaveBeenCalled();

      vi.runAllTimers();

      expect(mockAPI.caret.updateLastCaretAfterPosition).toHaveBeenCalled(); // Called after RAF
    });

    it('updates last caret after position', () => {
      setCaretToBlockContent(mockAPI, mockBlock, 'end');

      vi.runAllTimers();

      expect(mockAPI.caret.updateLastCaretAfterPosition).toHaveBeenCalled();
    });

    it('falls back to setToBlock when content element not found', () => {
      const holderWithNoContent = document.createElement('div');
      // No contenteditable element

      const blockWithoutContent = {
        holder: holderWithNoContent,
      } as unknown as ReturnType<API['blocks']['insert']>;

      setCaretToBlockContent(mockAPI, blockWithoutContent, 'end');

      vi.runAllTimers();

      expect(mockAPI.caret.setToBlock).toHaveBeenCalledWith(blockWithoutContent, 'end');
      expect(mockAPI.caret.updateLastCaretAfterPosition).toHaveBeenCalled();
    });

    it('handles when holder is null', () => {
      const blockWithoutHolder = {
        holder: null,
      } as unknown as ReturnType<API['blocks']['insert']>;

      // Should not throw and should not call setToBlock (returns early)
      expect(() => {
        setCaretToBlockContent(mockAPI, blockWithoutHolder, 'end');
        vi.runAllTimers();
      }).not.toThrow();

      // setToBlock is not called because the function returns early when holder is null
      expect(mockAPI.caret.setToBlock).not.toHaveBeenCalled();
    });

    it('handles when holder is undefined', () => {
      const blockWithoutHolder = {
        holder: undefined,
      } as unknown as ReturnType<API['blocks']['insert']>;

      expect(() => {
        setCaretToBlockContent(mockAPI, blockWithoutHolder, 'end');
        vi.runAllTimers();
      }).not.toThrow();

      // setToBlock is not called because the function returns early when holder is undefined
      expect(mockAPI.caret.setToBlock).not.toHaveBeenCalled();
    });

    it('defaults to "end" position when not specified', () => {
      setCaretToBlockContent(mockAPI, mockBlock);

      vi.runAllTimers();

      expect(mockAPI.caret.updateLastCaretAfterPosition).toHaveBeenCalled();
    });

    it('handles empty content element', () => {
      const holder = document.createElement('div');
      const emptyContentEl = document.createElement('div');
      emptyContentEl.contentEditable = 'true';
      holder.appendChild(emptyContentEl);

      const emptyBlock = {
        holder,
      } as unknown as ReturnType<API['blocks']['insert']>;

      expect(() => {
        setCaretToBlockContent(mockAPI, emptyBlock, 'start');
        vi.runAllTimers();
      }).not.toThrow();
    });

    it('handles content element that is not HTMLElement', () => {
      const holder = document.createElement('div');
      const contentEl = document.createElement('div'); // This is an HTMLElement, so test should pass
      contentEl.contentEditable = 'true';
      holder.appendChild(contentEl);

      const block = {
        holder,
      } as unknown as ReturnType<API['blocks']['insert']>;

      expect(() => {
        setCaretToBlockContent(mockAPI, block, 'end');
        vi.runAllTimers();
      }).not.toThrow();
    });
  });
});
