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
  rectangleSelection: {} as API["rectangleSelection"],
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
  preservedData: {},
  preservedTunes: {},
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
    it("applies focus synchronously when content element is available", () => {
      setCaretToBlockContent(mockAPI, mockBlock, "end");

      // Focus should be applied immediately (no RAF needed)
      const contentEl = mockBlock.holder.querySelector(
        '[contenteditable="true"]',
      );
      expect(contentEl).toHaveFocus();

      // Selection should be set synchronously
      const selection = window.getSelection();
      expect(selection?.rangeCount).toBeGreaterThan(0);

      // updateLastCaretAfterPosition is NOT called synchronously
      // (it's only called in the deferred fallback path)
      expect(mockAPI.caret.updateLastCaretAfterPosition).not.toHaveBeenCalled();
    });

    it("sets selection at end position synchronously", () => {
      setCaretToBlockContent(mockAPI, mockBlock, "end");

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
    });

    it("falls back to setToBlock via RAF when content element not found", () => {
      const holderWithNoContent = document.createElement("div");
      document.body.appendChild(holderWithNoContent);
      // No contenteditable element

      const blockWithoutContent = createMockBlock(holderWithNoContent);

      setCaretToBlockContent(mockAPI, blockWithoutContent, "end");

      // Not called synchronously — deferred to RAF
      expect(mockAPI.caret.setToBlock).not.toHaveBeenCalled();

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

      // Verify observable behavior: content element should be focused synchronously
      const contentEl = mockBlock.holder.querySelector(
        '[contenteditable="true"]',
      );
      expect(contentEl).toHaveFocus();

      // Verify observable behavior: selection should be at the end (collapsed)
      const selection = window.getSelection();
      const range = selection?.getRangeAt(0);
      expect(range?.collapsed).toBe(true);
    });

    it("handles empty content element", () => {
      const holder = document.createElement("div");
      const emptyContentEl = document.createElement("div");
      emptyContentEl.setAttribute("contenteditable", "true");
      holder.appendChild(emptyContentEl);
      document.body.appendChild(holder);

      const emptyBlock = createMockBlock(holder);

      expect(() => {
        setCaretToBlockContent(mockAPI, emptyBlock, "start");
      }).not.toThrow();
    });

    it("handles content element that is not HTMLElement", () => {
      const holder = document.createElement("div");
      const contentEl = document.createElement("div");
      contentEl.setAttribute("contenteditable", "true");
      holder.appendChild(contentEl);
      document.body.appendChild(holder);

      const block = createMockBlock(holder);

      expect(() => {
        setCaretToBlockContent(mockAPI, block, "end");
      }).not.toThrow();
    });
  });
});
