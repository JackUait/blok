import { describe, it, expect, beforeEach, afterEach, beforeAll, vi } from 'vitest';
import SelectionUtils from '../../../src/components/selection';
import * as utils from '../../../src/components/utils';

const ensureSelection = (): Selection => {
  const selection = window.getSelection();

  if (!selection) {
    throw new Error('Selection API is not available in the current environment');
  }

  return selection;
};

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

const createContentEditable = (text = 'Hello world'): { element: HTMLDivElement; textNode: Text } => {
  const element = document.createElement('div');

  element.contentEditable = 'true';
  element.textContent = text;
  document.body.appendChild(element);

  const textNode = element.firstChild;

  if (!(textNode instanceof Text)) {
    throw new Error('Failed to create text node for contenteditable element');
  }

  return { element,
    textNode };
};

const createEditorZone = (text = 'Hello world'): {
  wrapper: HTMLDivElement;
  zone: HTMLDivElement;
  paragraph: HTMLParagraphElement;
  textNode: Text;
} => {
  const wrapper = document.createElement('div');
  const zone = document.createElement('div');
  const paragraph = document.createElement('p');

  wrapper.className = 'codex-editor';
  zone.className = 'codex-editor__redactor';
  paragraph.textContent = text;

  zone.appendChild(paragraph);
  wrapper.appendChild(zone);
  document.body.appendChild(wrapper);

  const textNode = paragraph.firstChild;

  if (!(textNode instanceof Text)) {
    throw new Error('Failed to create text node inside editor zone');
  }

  return { wrapper,
    zone,
    paragraph,
    textNode };
};

describe('SelectionUtils', () => {
  beforeAll(() => {
    const prototype = Range.prototype as Range & {
      getBoundingClientRect?: () => DOMRect;
    };

    if (typeof prototype.getBoundingClientRect !== 'function') {
      prototype.getBoundingClientRect = () => new DOMRect(0, 0, 0, 0);
    }
  });

  const clearSelectionState = (): void => {
    const selection = ensureSelection();

    selection.removeAllRanges();
    updateSelectionProperties(selection, {
      anchorNode: null,
      focusNode: null,
      anchorOffset: 0,
      focusOffset: 0,
      isCollapsed: true,
    });
  };

  beforeEach(() => {
    document.body.innerHTML = '';
    clearSelectionState();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    clearSelectionState();
    document.body.innerHTML = '';
  });

  it('returns anchor node of the current selection', () => {
    const { textNode } = createContentEditable();

    setSelectionRange(textNode, 1);

    expect(SelectionUtils.anchorNode).toBe(textNode);
  });

  it('returns parent element when anchor is a text node', () => {
    const { element, textNode } = createContentEditable();

    setSelectionRange(textNode, 0);

    expect(SelectionUtils.anchorElement).toBe(element);
  });

  it('returns the element itself when anchor node is an element', () => {
    const { element } = createContentEditable();
    const selection = ensureSelection();
    const range = document.createRange();

    range.selectNodeContents(element);
    selection.removeAllRanges();
    selection.addRange(range);

    updateSelectionProperties(selection, {
      anchorNode: element,
      focusNode: element,
      anchorOffset: 0,
      focusOffset: element.childNodes.length,
      isCollapsed: element.childNodes.length === 0,
    });

    expect(SelectionUtils.anchorElement).toBe(element);
  });

  it('detects collapsed selection state', () => {
    const { textNode } = createContentEditable();

    setSelectionRange(textNode, 2);
    expect(SelectionUtils.isCollapsed).toBe(true);

    setSelectionRange(textNode, 0, 4);
    expect(SelectionUtils.isCollapsed).toBe(false);
  });

  it('checks whether selection is inside the editor zone', () => {
    const { textNode } = createEditorZone();

    setSelectionRange(textNode, 0, textNode.textContent?.length ?? 0);
    expect(SelectionUtils.isAtEditor).toBe(true);

    const outside = document.createElement('p');

    outside.textContent = 'Outside';
    document.body.appendChild(outside);

    const outsideText = outside.firstChild;

    if (!(outsideText instanceof Text)) {
      throw new Error('Outside element is missing text node');
    }

    setSelectionRange(outsideText, 0, 3);
    expect(SelectionUtils.isAtEditor).toBe(false);
  });

  it('validates whether a specific range belongs to the editor zone', () => {
    const { textNode } = createEditorZone();
    const insideRange = document.createRange();

    insideRange.setStart(textNode, 0);
    insideRange.setEnd(textNode, 2);

    expect(SelectionUtils.isRangeAtEditor(insideRange)).toBe(true);

    const outsideParagraph = document.createElement('p');

    outsideParagraph.textContent = 'Outer text';
    document.body.appendChild(outsideParagraph);

    const outsideText = outsideParagraph.firstChild;

    if (!(outsideText instanceof Text)) {
      throw new Error('Missing text node for outside range');
    }

    const outsideRange = document.createRange();

    outsideRange.setStart(outsideText, 0);
    outsideRange.setEnd(outsideText, 5);

    expect(SelectionUtils.isRangeAtEditor(outsideRange)).toBe(false);
  });

  it('reports whether any selection exists', () => {
    const { textNode } = createContentEditable();

    setSelectionRange(textNode, 1, 3);
    expect(SelectionUtils.isSelectionExists).toBe(true);

    clearSelectionState();
    expect(SelectionUtils.isSelectionExists).toBe(false);
  });

  it('returns the current selection range', () => {
    const { textNode } = createContentEditable();

    const range = setSelectionRange(textNode, 0, 5);

    expect(SelectionUtils.range).toBeDefined();
    expect(SelectionUtils.range?.startContainer).toBe(range.startContainer);
    expect(SelectionUtils.range?.startOffset).toBe(range.startOffset);
  });

  it('returns range from provided selection object', () => {
    const { textNode } = createContentEditable();

    setSelectionRange(textNode, 0, 4);

    const selection = ensureSelection();

    expect(SelectionUtils.getRangeFromSelection(selection)).toEqual(selection.getRangeAt(0));
    expect(SelectionUtils.getRangeFromSelection(null)).toBeNull();
  });

  it('returns selected text value', () => {
    const { textNode } = createContentEditable('Sample');

    setSelectionRange(textNode, 0, 3);

    expect(SelectionUtils.text).toBe('Sam');
  });

  it('provides access to window selection object', () => {
    expect(SelectionUtils.get()).toBe(window.getSelection());
  });

  it('sets cursor inside a contenteditable element', () => {
    const { element } = createContentEditable();

    SelectionUtils.setCursor(element, 0);

    const range = SelectionUtils.range;

    expect(range).not.toBeNull();
    expect(range?.startContainer).toBe(element);
    expect(range?.startOffset).toBe(0);
  });

  it('sets cursor inside a native input element', () => {
    const input = document.createElement('input');

    input.type = 'text';
    input.value = 'Hello';
    document.body.appendChild(input);

    SelectionUtils.setCursor(input, 2);

    expect(input.selectionStart).toBe(2);
    expect(input.selectionEnd).toBe(2);
  });

  it('checks whether current range is inside a container', () => {
    const { element, textNode } = createContentEditable();

    setSelectionRange(textNode, 0, 1);

    expect(SelectionUtils.isRangeInsideContainer(element)).toBe(true);

    const otherContainer = document.createElement('div');

    document.body.appendChild(otherContainer);

    expect(SelectionUtils.isRangeInsideContainer(otherContainer)).toBe(false);
  });

  it('adds and removes a fake cursor', () => {
    const { element } = createContentEditable();

    SelectionUtils.setCursor(element, 0);
    SelectionUtils.addFakeCursor();

    expect(SelectionUtils.isFakeCursorInsideContainer(element)).toBe(true);
    expect(element.querySelector('.codex-editor__fake-cursor')).not.toBeNull();

    SelectionUtils.removeFakeCursor(element);

    expect(SelectionUtils.isFakeCursorInsideContainer(element)).toBe(false);
  });

  it('manages fake background wrappers around selection', () => {
    const utilsInstance = new SelectionUtils();
    const { zone, paragraph } = createEditorZone('Highlighted text');
    const selection = ensureSelection();
    const range = document.createRange();

    range.setStart(paragraph, 0);
    range.setEnd(paragraph, paragraph.childNodes.length);
    selection.removeAllRanges();
    selection.addRange(range);

    updateSelectionProperties(selection, {
      anchorNode: paragraph,
      focusNode: paragraph,
      anchorOffset: 0,
      focusOffset: paragraph.childNodes.length,
      isCollapsed: false,
    });

    utilsInstance.setFakeBackground();

    const wrappers = zone.querySelectorAll('.codex-editor__fake-background');

    expect(wrappers.length).toBeGreaterThan(0);
    wrappers.forEach((wrapper) => {
      expect((wrapper as HTMLElement).dataset.fakeBackground).toBe('true');
    });
    expect(utilsInstance.isFakeBackgroundEnabled).toBe(true);

    utilsInstance.removeFakeBackground();

    expect(utilsInstance.isFakeBackgroundEnabled).toBe(false);
    expect(paragraph.querySelector('.codex-editor__fake-background')).toBeNull();
    expect(paragraph.textContent).toBe('Highlighted text');
  });

  it('restores selection correctly after using fake background', () => {
    const utilsInstance = new SelectionUtils();
    const { zone, paragraph } = createEditorZone('Text to select');

    // Create a text node and select a part of it
    const textNode = paragraph.firstChild as Text;

    setSelectionRange(textNode, 0, 4); // Select "Text"

    // Save selection
    utilsInstance.save();

    // Set fake background
    utilsInstance.setFakeBackground();

    // Check that fake background is enabled
    expect(utilsInstance.isFakeBackgroundEnabled).toBe(true);
    expect(zone.querySelectorAll('.codex-editor__fake-background').length).toBeGreaterThan(0);

    // Remove fake background
    utilsInstance.removeFakeBackground();
    expect(utilsInstance.isFakeBackgroundEnabled).toBe(false);
    expect(paragraph.querySelector('.codex-editor__fake-background')).toBeNull();

    // Clear current selection to simulate focus change or similar
    window.getSelection()?.removeAllRanges();

    // Restore selection
    utilsInstance.restore();

    // Verify selection is restored
    const currentSelection = window.getSelection();

    expect(currentSelection?.toString()).toBe('Text');
  });

  it('does not enable fake background when selection is collapsed', () => {
    const utilsInstance = new SelectionUtils();
    const { paragraph } = createEditorZone('Single word');
    const selection = ensureSelection();
    const range = document.createRange();

    range.setStart(paragraph, 0);
    range.setEnd(paragraph, 0);
    selection.removeAllRanges();
    selection.addRange(range);

    updateSelectionProperties(selection, {
      anchorNode: paragraph,
      focusNode: paragraph,
      anchorOffset: 0,
      focusOffset: 0,
      isCollapsed: true,
    });

    utilsInstance.setFakeBackground();

    expect(utilsInstance.isFakeBackgroundEnabled).toBe(false);
    expect(document.querySelector('.codex-editor__fake-background')).toBeNull();
  });

  it('saves, restores, and clears selection ranges', () => {
    const utilsInstance = new SelectionUtils();
    const { textNode } = createContentEditable('Saved range example');

    setSelectionRange(textNode, 0, 5);
    const savedText = SelectionUtils.text;

    utilsInstance.save();

    const other = document.createElement('p');

    other.textContent = 'Other content';
    document.body.appendChild(other);

    const otherText = other.firstChild;

    if (!(otherText instanceof Text)) {
      throw new Error('Missing text node in other element');
    }

    setSelectionRange(otherText, 0, 5);
    expect(SelectionUtils.text).toBe('Other');

    utilsInstance.restore();
    expect(SelectionUtils.text).toBe(savedText);

    utilsInstance.clearSaved();
    expect(utilsInstance.savedSelectionRange).toBeNull();
  });

  it('collapses selection to the end of focus node', () => {
    const utilsInstance = new SelectionUtils();
    const { textNode } = createContentEditable('Collapse');

    setSelectionRange(textNode, 0, 3);
    utilsInstance.collapseToEnd();

    const range = SelectionUtils.range;

    expect(range?.collapsed).toBe(true);
    expect(range?.startContainer).toBe(textNode);
    expect(range?.startOffset).toBe(textNode.length);
  });

  it('finds parent tag by name and optional class', () => {
    const utilsInstance = new SelectionUtils();
    const container = document.createElement('div');

    container.innerHTML = '<p><strong class="highlight">Nested text</strong></p>';
    document.body.appendChild(container);

    const strong = container.querySelector('strong');

    if (!(strong instanceof HTMLElement) || !(strong.firstChild instanceof Text)) {
      throw new Error('Expected strong element with a text node');
    }

    setSelectionRange(strong.firstChild, 0, strong.firstChild.length);

    expect(utilsInstance.findParentTag('STRONG')).toBe(strong);
    expect(utilsInstance.findParentTag('STRONG', 'highlight')).toBe(strong);
    expect(utilsInstance.findParentTag('STRONG', 'missing')).toBeNull();
  });

  it('expands selection to cover an entire element', () => {
    const utilsInstance = new SelectionUtils();
    const container = document.createElement('div');

    container.innerHTML = '<p><em>Expanded text</em></p>';
    document.body.appendChild(container);

    const emphasis = container.querySelector('em');

    if (!(emphasis instanceof HTMLElement) || !(emphasis.firstChild instanceof Text)) {
      throw new Error('Expected em element with a text node');
    }

    setSelectionRange(emphasis.firstChild, 0, 4);
    utilsInstance.expandToTag(emphasis);

    expect(SelectionUtils.text).toBe(emphasis.textContent);
  });

  it('returns zero rect when selection is unavailable', () => {
    const getSelectionSpy = vi.spyOn(window, 'getSelection').mockReturnValue(null as unknown as Selection);
    const logSpy = vi.spyOn(utils, 'log').mockImplementation(() => undefined);

    const rect = SelectionUtils.rect;

    expect(rect.x).toBe(0);
    expect(rect.y).toBe(0);
    expect(rect.width).toBe(0);
    expect(rect.height).toBe(0);
    expect(logSpy).toHaveBeenCalled();

    getSelectionSpy.mockRestore();
    logSpy.mockRestore();
  });
});
