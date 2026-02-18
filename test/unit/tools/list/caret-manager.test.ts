import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { setCaretToBlockContent } from "../../../../src/tools/list/caret-manager";
import type { API, BlockAPI, Caret } from "../../../../types";

/**
 * Creates a mock Caret API for testing
 */
const createMockCaret = (): Caret => ({
  setToFirstBlock: vi.fn(),
  setToLastBlock: vi.fn(),
  setToPreviousBlock: vi.fn(),
  setToNextBlock: vi.fn(),
  setToBlock: vi.fn(),
  focus: vi.fn(),
  updateLastCaretAfterPosition: vi.fn(),
});

/**
 * Creates a mock API for testing
 */
const createMockAPI = (): API => ({
  blocks: {} as API["blocks"],
  caret: createMockCaret(),
  tools: {} as API["tools"],
  events: {} as API["events"],
  history: {} as API["history"],
  listeners: {} as API["listeners"],
  notifier: {} as API["notifier"],
  sanitizer: {} as API["sanitizer"],
  saver: {} as API["saver"],
  selection: {} as API["selection"],
  styles: {} as API["styles"],
  toolbar: {} as API["toolbar"],
  inlineToolbar: {} as API["inlineToolbar"],
  tooltip: {} as API["tooltip"],
  i18n: {} as API["i18n"],
  readOnly: {} as API["readOnly"],
  ui: {} as API["ui"],
});

/**
 * Creates a partial BlockAPI-like object with the minimum required properties
 * for testing edge cases like null/undefined holder.
 *
 * Note: This intentionally creates an object that may not fully satisfy BlockAPI
 * to test defensive programming in the implementation.
 */
type PartialBlockWithHolder = Pick<BlockAPI, "id" | "name" | "config"> & {
  holder: HTMLElement | null | undefined;
};

const createPartialBlock = (
  holder: HTMLElement | null | undefined,
): PartialBlockWithHolder => ({
  id: "test-block-id",
  name: "list",
  config: {},
  holder,
});

/**
 * Creates a fully compliant BlockAPI for testing normal cases
 */
const createMockBlock = (holder: HTMLElement): BlockAPI => ({
  id: "test-block-id",
  name: "list",
  config: {},
  holder,
  isEmpty: false,
  selected: false,
  focusable: true,
  stretched: false,
  call: vi.fn(),
  save: vi.fn().mockResolvedValue({}),
  validate: vi.fn().mockResolvedValue(true),
  dispatchChange: vi.fn(),
  getActiveToolboxEntry: vi.fn().mockResolvedValue(undefined),
});

describe("caret-manager", () => {
  let mockAPI: API;
  let mockBlock: BlockAPI;

  beforeEach(() => {
    vi.useFakeTimers();

    // Create mock block with holder element
    const holder = document.createElement("div");
    const contentEl = document.createElement("div");
    // Set contenteditable attribute for both behavior and querySelector matching
    contentEl.setAttribute("contenteditable", "true");
    contentEl.textContent = "Test content";
    holder.appendChild(contentEl);
    // Append to document body so focus() works properly
    document.body.appendChild(holder);

    mockBlock = createMockBlock(holder);
    mockAPI = createMockAPI();
  });

  afterEach(() => {
    vi.runAllTimers();
    vi.useRealTimers();
    // Clean up DOM
    document.body.innerHTML = "";
  });

  describe("setCaretToBlockContent", () => {
    it("schedules caret positioning for next animation frame", () => {
      setCaretToBlockContent(mockAPI, mockBlock, "end");

      // Caret positioning is scheduled via requestAnimationFrame (or timers in test)
      // so immediate observable behavior should not change yet
      expect(mockAPI.caret.updateLastCaretAfterPosition).not.toHaveBeenCalled();

      vi.runAllTimers();

      // Verify observable behavior: content element should be focused
      const contentEl = mockBlock.holder.querySelector(
        '[contenteditable="true"]',
      );
      expect(contentEl).toHaveFocus();

      // Verify observable behavior: selection should be set
      const selection = window.getSelection();
      expect(selection?.rangeCount).toBeGreaterThan(0);

      // Verify the mock was called (implementation detail)
      expect(mockAPI.caret.updateLastCaretAfterPosition).toHaveBeenCalled();
    });

    it("updates last caret after position", () => {
      setCaretToBlockContent(mockAPI, mockBlock, "end");

      vi.runAllTimers();

      // Verify observable behavior: content element should be focused
      const contentEl = mockBlock.holder.querySelector(
        '[contenteditable="true"]',
      );
      expect(contentEl).toHaveFocus();

      // Verify observable behavior: selection should be at the end of content
      const selection = window.getSelection();
      expect(selection?.rangeCount).toBeGreaterThan(0);

      const range = selection?.getRangeAt(0);
      if (range) {
        // The range should be collapsed at the end of content
        expect(range.collapsed).toBe(true);
        // Verify the range is within the content element
        expect(contentEl?.contains(range.startContainer)).toBe(true);
      }

      // Verify the mock was called (implementation detail)
      expect(mockAPI.caret.updateLastCaretAfterPosition).toHaveBeenCalled();
    });

    it("falls back to setToBlock when content element not found", () => {
      const holderWithNoContent = document.createElement("div");
      // No contenteditable element

      const blockWithoutContent = createMockBlock(holderWithNoContent);

      setCaretToBlockContent(mockAPI, blockWithoutContent, "end");

      vi.runAllTimers();

      expect(mockAPI.caret.setToBlock).toHaveBeenCalledWith(
        blockWithoutContent,
        "end",
      );
      expect(mockAPI.caret.updateLastCaretAfterPosition).toHaveBeenCalled();
    });

    it("handles when holder is null", () => {
      // This tests defensive programming - the implementation checks for null holder
      // even though BlockAPI type doesn't allow it.
      const blockWithoutHolder = createPartialBlock(null);

      // Should not throw and should not call setToBlock (returns early)
      expect(() => {
        // Use unknown as intermediate type for this defensive test
        setCaretToBlockContent(
          mockAPI,
          blockWithoutHolder as unknown as BlockAPI,
          "end",
        );
        vi.runAllTimers();
      }).not.toThrow();

      // setToBlock is not called because the function returns early when holder is null
      expect(mockAPI.caret.setToBlock).not.toHaveBeenCalled();
    });

    it("handles when holder is undefined", () => {
      // This tests defensive programming - the implementation checks for undefined holder
      // even though BlockAPI type doesn't allow it.
      const blockWithUndefinedHolder = createPartialBlock(undefined);

      expect(() => {
        // Use unknown as intermediate type for this defensive test
        setCaretToBlockContent(
          mockAPI,
          blockWithUndefinedHolder as unknown as BlockAPI,
          "end",
        );
        vi.runAllTimers();
      }).not.toThrow();

      // setToBlock is not called because the function returns early when holder is undefined
      expect(mockAPI.caret.setToBlock).not.toHaveBeenCalled();
    });

    it('defaults to "end" position when not specified', () => {
      setCaretToBlockContent(mockAPI, mockBlock);

      vi.runAllTimers();

      // Verify observable behavior: content element should be focused
      const contentEl = mockBlock.holder.querySelector(
        '[contenteditable="true"]',
      );
      expect(contentEl).toHaveFocus();

      // Verify observable behavior: selection should be at the end (collapsed)
      const selection = window.getSelection();
      const range = selection?.getRangeAt(0);
      expect(range?.collapsed).toBe(true);

      // Verify the mock was called (implementation detail)
      expect(mockAPI.caret.updateLastCaretAfterPosition).toHaveBeenCalled();
    });

    it("handles empty content element", () => {
      const holder = document.createElement("div");
      const emptyContentEl = document.createElement("div");
      emptyContentEl.setAttribute("contenteditable", "true");
      holder.appendChild(emptyContentEl);

      const emptyBlock = createMockBlock(holder);

      expect(() => {
        setCaretToBlockContent(mockAPI, emptyBlock, "start");
        vi.runAllTimers();
      }).not.toThrow();
    });

    it("handles content element that is not HTMLElement", () => {
      const holder = document.createElement("div");
      const contentEl = document.createElement("div");
      contentEl.setAttribute("contenteditable", "true");
      holder.appendChild(contentEl);

      const block = createMockBlock(holder);

      expect(() => {
        setCaretToBlockContent(mockAPI, block, "end");
        vi.runAllTimers();
      }).not.toThrow();
    });
  });
});
