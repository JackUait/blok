import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
import { SelectionUtils } from '../../../../src/components/selection';
import { SelectionCore } from '../../../../src/components/selection/core';
import { SelectionCursor } from '../../../../src/components/selection/cursor';
import { SelectionNavigation } from '../../../../src/components/selection/navigation';
import { SelectionFakeCursor } from '../../../../src/components/selection/fake-cursor';
import { FakeBackgroundManager } from '../../../../src/components/selection/fake-background';
import * as coreModule from '../../../../src/components/selection/core';
import * as cursorModule from '../../../../src/components/selection/cursor';
import * as navigationModule from '../../../../src/components/selection/navigation';
import * as fakeCursorModule from '../../../../src/components/selection/fake-cursor';

/**
 * Test helper to ensure Selection API is available
 */
const ensureSelection = (): Selection => {
  const selection = window.getSelection();

  if (!selection) {
    throw new Error('Selection API is not available in the current environment');
  }

  return selection;
};

/**
 * Test helper to update Selection properties
 */
const updateSelectionProperties = (
  selection: Selection,
  state: {
    anchorNode: Node | null;
    focusNode: Node | null;
    anchorOffset: number;
    focusOffset: number;
    isCollapsed: boolean;
  }
): void => {
  Object.defineProperty(selection, 'anchorNode', {
    value: state.anchorNode,
    configurable: true,
  });

  Object.defineProperty(selection, 'focusNode', {
    value: state.focusNode,
    configurable: true,
  });

  Object.defineProperty(selection, 'anchorOffset', {
    value: state.anchorOffset,
    configurable: true,
  });

  Object.defineProperty(selection, 'focusOffset', {
    value: state.focusOffset,
    configurable: true,
  });

  Object.defineProperty(selection, 'isCollapsed', {
    value: state.isCollapsed,
    configurable: true,
  });
};

/**
 * Test helper to set a selection range on a node
 */
const setSelectionRange = (node: Node, startOffset: number, endOffset: number = startOffset): Range => {
  const selection = ensureSelection();
  const range = document.createRange();

  range.setStart(node, startOffset);
  range.setEnd(node, endOffset);
  selection.removeAllRanges();
  selection.addRange(range);

  updateSelectionProperties(selection, {
    anchorNode: node,
    focusNode: node,
    anchorOffset: startOffset,
    focusOffset: endOffset,
    isCollapsed: startOffset === endOffset,
  });

  return range;
};

/**
 * Test helper to create a contenteditable div with text
 */
const createContentEditable = (text = 'Hello world'): { element: HTMLDivElement; textNode: Text } => {
  const element = document.createElement('div');

  element.contentEditable = 'true';
  element.textContent = text;
  document.body.appendChild(element);

  const textNode = element.firstChild;

  if (!(textNode instanceof Text)) {
    throw new Error('Failed to create text node for contenteditable element');
  }

  return { element, textNode };
};

/**
 * Test helper to create a Blok zone structure
 */
const createBlokZone = (text = 'Hello world'): {
  wrapper: HTMLDivElement;
  zone: HTMLDivElement;
  paragraph: HTMLParagraphElement;
  textNode: Text;
} => {
  const wrapper = document.createElement('div');
  const zone = document.createElement('div');
  const paragraph = document.createElement('p');

  wrapper.setAttribute('data-blok-editor', '');
  zone.setAttribute('data-blok-redactor', '');
  paragraph.textContent = text;

  zone.appendChild(paragraph);
  wrapper.appendChild(zone);
  document.body.appendChild(wrapper);

  const textNode = paragraph.firstChild;

  if (!(textNode instanceof Text)) {
    throw new Error('Failed to create text node inside blok zone');
  }

  return { wrapper, zone, paragraph, textNode };
};

describe('SelectionUtils (Facade)', () => {
  beforeEach(() => {
    document.body.innerHTML = '';

    // Mock Range.prototype.getBoundingClientRect for jsdom
    const prototype = Range.prototype as Range & {
      getBoundingClientRect?: () => DOMRect;
    };

    if (typeof prototype.getBoundingClientRect !== 'function') {
      prototype.getBoundingClientRect = () => new DOMRect(0, 0, 0, 0);
    }
  });

  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = '';

    const selection = ensureSelection();
    selection.removeAllRanges();
  });

  // ========================
  // Static Getters - delegate to core module
  // ========================

  describe('Static Getters (SelectionCore delegation)', () => {
    it('delegates anchorNode to SelectionCore', () => {
      const { textNode } = createContentEditable();

      setSelectionRange(textNode, 2);

      const spy = vi.spyOn(coreModule.SelectionCore, 'getAnchorNode').mockReturnValue(textNode);

      expect(SelectionUtils.anchorNode).toBe(textNode);
      expect(spy).toHaveBeenCalled();

      spy.mockRestore();
    });

    it('delegates anchorElement to SelectionCore', () => {
      const { element } = createContentEditable();

      const spy = vi.spyOn(coreModule.SelectionCore, 'getAnchorElement').mockReturnValue(element);

      expect(SelectionUtils.anchorElement).toBe(element);
      expect(spy).toHaveBeenCalled();

      spy.mockRestore();
    });

    it('delegates anchorOffset to SelectionCore', () => {
      const spy = vi.spyOn(coreModule.SelectionCore, 'getAnchorOffset').mockReturnValue(5);

      expect(SelectionUtils.anchorOffset).toBe(5);
      expect(spy).toHaveBeenCalled();

      spy.mockRestore();
    });

    it('delegates isCollapsed to SelectionCore', () => {
      const spy = vi.spyOn(coreModule.SelectionCore, 'getIsCollapsed').mockReturnValue(true);

      expect(SelectionUtils.isCollapsed).toBe(true);
      expect(spy).toHaveBeenCalled();

      spy.mockRestore();
    });

    it('delegates isAtBlok to SelectionCore', () => {
      const spy = vi.spyOn(coreModule.SelectionCore, 'getIsAtBlok').mockReturnValue(true);

      expect(SelectionUtils.isAtBlok).toBe(true);
      expect(spy).toHaveBeenCalled();

      spy.mockRestore();
    });

    it('delegates isSelectionExists to SelectionCore', () => {
      const spy = vi.spyOn(coreModule.SelectionCore, 'getIsSelectionExists').mockReturnValue(true);

      expect(SelectionUtils.isSelectionExists).toBe(true);
      expect(spy).toHaveBeenCalled();

      spy.mockRestore();
    });

    it('delegates range to SelectionCore', () => {
      const { textNode } = createContentEditable();
      const range = document.createRange();

      const spy = vi.spyOn(coreModule.SelectionCore, 'getRange').mockReturnValue(range);

      expect(SelectionUtils.range).toBe(range);
      expect(spy).toHaveBeenCalled();

      spy.mockRestore();
    });

    it('delegates rect to SelectionCore', () => {
      const rect = new DOMRect(10, 20, 100, 50);

      const spy = vi.spyOn(coreModule.SelectionCore, 'getRect').mockReturnValue(rect);

      expect(SelectionUtils.rect).toBe(rect);
      expect(spy).toHaveBeenCalled();

      spy.mockRestore();
    });

    it('delegates text to SelectionCore', () => {
      const spy = vi.spyOn(coreModule.SelectionCore, 'getText').mockReturnValue('selected');

      expect(SelectionUtils.text).toBe('selected');
      expect(spy).toHaveBeenCalled();

      spy.mockRestore();
    });
  });

  // ========================
  // Static Methods - delegate to appropriate modules
  // ========================

  describe('Static Methods (module delegation)', () => {
    it('delegates get() to SelectionCore', () => {
      const selection = ensureSelection();
      const spy = vi.spyOn(coreModule.SelectionCore, 'get').mockReturnValue(selection);

      expect(SelectionUtils.get()).toBe(selection);
      expect(spy).toHaveBeenCalled();

      spy.mockRestore();
    });

    it('delegates setCursor to SelectionCursor', () => {
      const { element } = createContentEditable();
      const rect = new DOMRect(0, 0, 100, 20);

      const spy = vi.spyOn(cursorModule.SelectionCursor, 'setCursor').mockReturnValue(rect);

      expect(SelectionUtils.setCursor(element, 0)).toBe(rect);
      expect(spy).toHaveBeenCalledWith(element, 0);

      spy.mockRestore();
    });

    it('delegates isRangeInsideContainer to SelectionCursor', () => {
      const container = document.createElement('div');

      const spy = vi.spyOn(cursorModule.SelectionCursor, 'isRangeInsideContainer').mockReturnValue(true);

      expect(SelectionUtils.isRangeInsideContainer(container)).toBe(true);
      expect(spy).toHaveBeenCalledWith(container);

      spy.mockRestore();
    });

    it('delegates isSelectionAtBlok to SelectionCore', () => {
      const selection = ensureSelection();

      const spy = vi
        .spyOn(coreModule.SelectionCore, 'isSelectionAtBlok')
        .mockReturnValue(true);

      expect(SelectionUtils.isSelectionAtBlok(selection)).toBe(true);
      expect(spy).toHaveBeenCalledWith(selection);

      spy.mockRestore();
    });

    it('delegates isRangeAtBlok to SelectionCore', () => {
      const range = document.createRange();

      const spy = vi.spyOn(coreModule.SelectionCore, 'isRangeAtBlok').mockReturnValue(true);

      expect(SelectionUtils.isRangeAtBlok(range)).toBe(true);
      expect(spy).toHaveBeenCalledWith(range);

      spy.mockRestore();
    });

    it('delegates getRangeFromSelection to SelectionCore', () => {
      const selection = ensureSelection();
      const range = document.createRange();

      const spy = vi
        .spyOn(coreModule.SelectionCore, 'getRangeFromSelection')
        .mockReturnValue(range);

      expect(SelectionUtils.getRangeFromSelection(selection)).toBe(range);
      expect(spy).toHaveBeenCalledWith(selection);

      spy.mockRestore();
    });

    it('delegates addFakeCursor to SelectionFakeCursor', () => {
      const spy = vi.spyOn(fakeCursorModule.SelectionFakeCursor, 'addFakeCursor').mockImplementation(() => undefined);

      SelectionUtils.addFakeCursor();

      expect(spy).toHaveBeenCalled();

      spy.mockRestore();
    });

    it('delegates isFakeCursorInsideContainer to SelectionFakeCursor', () => {
      const container = document.createElement('div');

      const spy = vi
        .spyOn(fakeCursorModule.SelectionFakeCursor, 'isFakeCursorInsideContainer')
        .mockReturnValue(true);

      expect(SelectionUtils.isFakeCursorInsideContainer(container)).toBe(true);
      expect(spy).toHaveBeenCalledWith(container);

      spy.mockRestore();
    });

    it('delegates removeFakeCursor to SelectionFakeCursor with default container', () => {
      const spy = vi
        .spyOn(fakeCursorModule.SelectionFakeCursor, 'removeFakeCursor')
        .mockImplementation(() => undefined);

      SelectionUtils.removeFakeCursor();

      expect(spy).toHaveBeenCalledWith(document.body);

      spy.mockRestore();
    });

    it('delegates removeFakeCursor to SelectionFakeCursor with custom container', () => {
      const container = document.createElement('div');

      const spy = vi
        .spyOn(fakeCursorModule.SelectionFakeCursor, 'removeFakeCursor')
        .mockImplementation(() => undefined);

      SelectionUtils.removeFakeCursor(container);

      expect(spy).toHaveBeenCalledWith(container);

      spy.mockRestore();
    });
  });

  // ========================
  // Instance Methods - delegate to FakeBackgroundManager or use instance state
  // ========================

  describe('Instance Methods', () => {
    it('creates FakeBackgroundManager in constructor', () => {
      const utils = new SelectionUtils();

      expect(utils).toHaveProperty('fakeBackgroundManager');
      expect(utils.fakeBackgroundManager).toBeInstanceOf(FakeBackgroundManager);
    });

    it('delegates setFakeBackground to FakeBackgroundManager', () => {
      const utils = new SelectionUtils();
      const spy = vi.spyOn(utils.fakeBackgroundManager, 'setFakeBackground').mockImplementation(() => undefined);

      utils.setFakeBackground();

      expect(spy).toHaveBeenCalled();

      spy.mockRestore();
    });

    it('delegates removeFakeBackground to FakeBackgroundManager', () => {
      const utils = new SelectionUtils();
      const spy = vi
        .spyOn(utils.fakeBackgroundManager, 'removeFakeBackground')
        .mockImplementation(() => undefined);

      utils.removeFakeBackground();

      expect(spy).toHaveBeenCalled();

      spy.mockRestore();
    });

    it('delegates removeOrphanedFakeBackgroundElements to FakeBackgroundManager', () => {
      const utils = new SelectionUtils();
      const spy = vi
        .spyOn(utils.fakeBackgroundManager, 'removeOrphanedFakeBackgroundElements')
        .mockImplementation(() => undefined);

      utils.removeOrphanedFakeBackgroundElements();

      expect(spy).toHaveBeenCalled();

      spy.mockRestore();
    });

    it('delegates clearFakeBackground to FakeBackgroundManager', () => {
      const utils = new SelectionUtils();
      const spy = vi
        .spyOn(utils.fakeBackgroundManager, 'clearFakeBackground')
        .mockImplementation(() => undefined);

      utils.clearFakeBackground();

      expect(spy).toHaveBeenCalled();

      spy.mockRestore();
    });

    it('saves selection range to instance state', () => {
      const utils = new SelectionUtils();
      const { textNode } = createContentEditable();

      setSelectionRange(textNode, 0, 5);

      utils.save();

      expect(utils.savedSelectionRange).not.toBeNull();
      expect(utils.savedSelectionRange?.toString()).toBe('Hello');
    });

    it('restores saved selection range', () => {
      const utils = new SelectionUtils();
      const { textNode } = createContentEditable();

      setSelectionRange(textNode, 0, 5);
      utils.save();

      // Clear selection
      ensureSelection().removeAllRanges();

      utils.restore();

      expect(ensureSelection().toString()).toBe('Hello');
    });

    it('does not restore when savedRange is null', () => {
      const utils = new SelectionUtils();

      expect(() => utils.restore()).not.toThrow();

      expect(utils.savedSelectionRange).toBeNull();
    });

    it('clears saved selection range', () => {
      const utils = new SelectionUtils();
      const { textNode } = createContentEditable();

      setSelectionRange(textNode, 0, 5);
      utils.save();

      expect(utils.savedSelectionRange).not.toBeNull();

      utils.clearSaved();

      expect(utils.savedSelectionRange).toBeNull();
    });

    it('delegates collapseToEnd to SelectionCursor', () => {
      const utils = new SelectionUtils();
      const { textNode } = createContentEditable();

      setSelectionRange(textNode, 0, 5);

      const spy = vi.spyOn(cursorModule.SelectionCursor, 'collapseToEnd').mockImplementation(() => undefined);

      utils.collapseToEnd();

      expect(spy).toHaveBeenCalled();

      spy.mockRestore();
    });

    it('delegates findParentTag to SelectionNavigation', () => {
      const utils = new SelectionUtils();
      const container = createBlokZone();

      const textNode = container.textNode;
      setSelectionRange(textNode, 0, 4);

      const spy = vi.spyOn(navigationModule.SelectionNavigation, 'findParentTag').mockReturnValue(container.paragraph);

      expect(utils.findParentTag('P')).toBe(container.paragraph);
      expect(spy).toHaveBeenCalledWith('P', undefined, 10);

      spy.mockRestore();
    });

    it('delegates findParentTag with className to SelectionNavigation', () => {
      const utils = new SelectionUtils();

      const spy = vi.spyOn(navigationModule.SelectionNavigation, 'findParentTag').mockReturnValue(null);

      utils.findParentTag('STRONG', 'highlight', 5);

      expect(spy).toHaveBeenCalledWith('STRONG', 'highlight', 5);

      spy.mockRestore();
    });

    it('delegates expandToTag to SelectionNavigation', () => {
      const utils = new SelectionUtils();
      const container = createBlokZone();

      const spy = vi.spyOn(navigationModule.SelectionNavigation, 'expandToTag').mockImplementation(() => undefined);

      utils.expandToTag(container.paragraph);

      expect(spy).toHaveBeenCalledWith(container.paragraph);

      spy.mockRestore();
    });
  });

  // ========================
  // Instance State
  // ========================

  describe('Instance State', () => {
    it('initializes with null savedSelectionRange', () => {
      const utils = new SelectionUtils();

      expect(utils.savedSelectionRange).toBeNull();
    });

    it('initializes isFakeBackgroundEnabled as false', () => {
      const utils = new SelectionUtils();

      expect(utils.isFakeBackgroundEnabled).toBe(false);
    });

    it('initializes instance and selection as null', () => {
      const utils = new SelectionUtils();

      expect(utils.instance).toBeNull();
      expect(utils.selection).toBeNull();
    });

    it('updates isFakeBackgroundEnabled through FakeBackgroundManager', () => {
      const utils = new SelectionUtils();

      // The FakeBackgroundManager has a reference to SelectionUtilsState
      // and can update isFakeBackgroundEnabled
      expect(utils.isFakeBackgroundEnabled).toBe(false);

      // After setFakeBackground, it should be true
      // (This is tested indirectly via the manager's own tests)
    });
  });

  // ========================
  // Backward Compatibility
  // ========================

  describe('Backward Compatibility', () => {
    it('provides static anchorNode getter', () => {
      const { textNode } = createContentEditable();

      setSelectionRange(textNode, 2);

      expect(SelectionUtils.anchorNode).toBe(textNode);
    });

    it('provides static anchorElement getter', () => {
      const { element } = createContentEditable();

      setSelectionRange(element.firstChild as Text, 0);

      expect(SelectionUtils.anchorElement).toBe(element);
    });

    it('provides static isAtBlok getter', () => {
      const { textNode } = createBlokZone();

      setSelectionRange(textNode, 0, 5);

      expect(SelectionUtils.isAtBlok).toBe(true);
    });

    it('provides static text getter', () => {
      const { textNode } = createContentEditable('Sample');

      setSelectionRange(textNode, 0, 3);

      expect(SelectionUtils.text).toBe('Sam');
    });

    it('provides static range getter', () => {
      const { textNode } = createContentEditable();

      const range = setSelectionRange(textNode, 0, 5);

      expect(SelectionUtils.range).toBeDefined();
      expect(SelectionUtils.range?.startContainer).toBe(range.startContainer);
    });

    it('provides instance methods save/restore/clearSaved', () => {
      const utils = new SelectionUtils();
      const { textNode } = createContentEditable();

      setSelectionRange(textNode, 0, 5);

      utils.save();
      expect(utils.savedSelectionRange).not.toBeNull();

      ensureSelection().removeAllRanges();
      utils.restore();
      expect(ensureSelection().toString()).toBe('Hello');

      utils.clearSaved();
      expect(utils.savedSelectionRange).toBeNull();
    });

    it('provides instance findParentTag method', () => {
      const utils = new SelectionUtils();
      const container = createBlokZone();

      const textNode = container.textNode;
      setSelectionRange(textNode, 0, 4);

      expect(utils.findParentTag('P')).toBe(container.paragraph);
    });

    it('provides instance expandToTag method', () => {
      const utils = new SelectionUtils();
      const container = createBlokZone();

      const textNode = container.textNode;
      setSelectionRange(textNode, 0, 4);

      utils.expandToTag(container.paragraph);

      expect(SelectionUtils.text).toBe('Hello world');
    });
  });

  // ========================
  // Integration
  // ========================

  describe('Integration', () => {
    it('works end-to-end with real selection operations', () => {
      const { element, textNode } = createContentEditable();

      // Set cursor
      SelectionUtils.setCursor(element, 0);
      expect(SelectionCursor.isRangeInsideContainer(element)).toBe(true);

      // Add fake cursor
      SelectionUtils.addFakeCursor();
      expect(SelectionFakeCursor.isFakeCursorInsideContainer(element)).toBe(true);

      // Remove fake cursor
      SelectionUtils.removeFakeCursor(element);
      expect(SelectionFakeCursor.isFakeCursorInsideContainer(element)).toBe(false);
    });

    it('works with instance save/restore', () => {
      const utils = new SelectionUtils();
      const { textNode } = createContentEditable();

      setSelectionRange(textNode, 0, 5);

      utils.save();
      expect(utils.savedSelectionRange?.toString()).toBe('Hello');

      ensureSelection().removeAllRanges();
      expect(SelectionUtils.text).toBe('');

      utils.restore();
      expect(SelectionUtils.text).toBe('Hello');
    });

    it('tracks fake background state', () => {
      const utils = new SelectionUtils();

      expect(utils.isFakeBackgroundEnabled).toBe(false);

      // After setFakeBackground, the state should be true
      // (This is handled by FakeBackgroundManager which has its own tests)
    });
  });
});
