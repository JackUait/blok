import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { IconMarker } from '../../../../src/components/icons';
import { MarkerInlineTool } from '../../../../src/components/inline-tools/inline-tool-marker';
import { COLOR_PRESETS } from '../../../../src/components/shared/color-presets';
import type { PopoverItemHtmlParams } from '../../../../types/utils/popover';

/**
 * Convert a hex color string to the rgb() format that CSSOM produces
 */
function hexToRgb(hex: string): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);

  return `rgb(${r}, ${g}, ${b})`;
}

const createMockApi = () => ({
  toolbar: {},
  inlineToolbar: { close: vi.fn() },
  notifier: {},
  i18n: { t: (key: string) => key },
  blocks: {},
  selection: {},
  caret: {},
  tools: {},
});

describe('MarkerInlineTool', () => {
  let tool: MarkerInlineTool;
  let container: HTMLDivElement;

  beforeEach(() => {
    vi.clearAllMocks();
    tool = new MarkerInlineTool({ api: createMockApi() as never, config: undefined });
    container = document.createElement('div');
    container.contentEditable = 'true';
    document.body.appendChild(container);
  });

  afterEach(() => {
    container.remove();
    vi.restoreAllMocks();
  });

  it('exposes inline metadata and sanitizer config', () => {
    expect(MarkerInlineTool.isInline).toBe(true);
    expect(MarkerInlineTool.title).toBe('Color');
    expect(MarkerInlineTool.titleKey).toBe('marker');
    expect(MarkerInlineTool.sanitize).toHaveProperty('mark');
    expect(typeof MarkerInlineTool.sanitize.mark).toBe('function');
  });

  it('renders menu config with marker icon and children', () => {
    const config = tool.render();

    expect(config).toHaveProperty('icon', IconMarker);
    expect(config).toHaveProperty('name', 'marker');
    expect(config).toHaveProperty('isActive');
    expect(config).toHaveProperty('children');
  });

  describe('isActive', () => {
    it('returns false when no selection', () => {
      vi.spyOn(window, 'getSelection').mockReturnValue(null);

      const config = tool.render();
      const isActive = typeof config.isActive === 'function' ? config.isActive() : false;

      expect(isActive).toBe(false);
    });

    it('returns true when caret is inside a mark element', () => {
      container.innerHTML = '<mark style="color: #d44c47">colored</mark>';

      const markEl = container.querySelector('mark');

      if (!markEl?.firstChild) {
        throw new Error('Test setup failed: mark element not found');
      }

      const textNode = markEl.firstChild;
      const range = document.createRange();

      range.setStart(textNode, 2);
      range.setEnd(textNode, 2);

      const selection = window.getSelection();

      if (!selection) {
        throw new Error('Test setup failed: no selection available');
      }

      selection.removeAllRanges();
      selection.addRange(range);

      const config = tool.render();
      const isActive = typeof config.isActive === 'function' ? config.isActive() : false;

      expect(isActive).toBe(true);
    });
  });

  describe('applyColor', () => {
    it('wraps selected text with mark for text color', () => {
      container.innerHTML = 'hello world';

      const textNode = container.firstChild;

      if (!textNode) {
        throw new Error('Test setup failed: no text node');
      }

      const range = document.createRange();

      range.setStart(textNode, 0);
      range.setEnd(textNode, 5);

      const selection = window.getSelection();

      if (!selection) {
        throw new Error('Test setup failed: no selection available');
      }

      selection.removeAllRanges();
      selection.addRange(range);

      tool.applyColor('color', '#d44c47');

      const mark = container.querySelector('mark');

      expect(mark).not.toBeNull();
      expect(mark?.style.color).toBe('rgb(212, 76, 71)');
      expect(mark?.textContent).toBe('hello');
    });

    it('sets transparent background when applying text color to prevent default mark yellow', () => {
      container.innerHTML = 'hello world';

      const textNode = container.firstChild;

      if (!textNode) {
        throw new Error('Test setup failed: no text node');
      }

      const range = document.createRange();

      range.setStart(textNode, 0);
      range.setEnd(textNode, 5);

      const selection = window.getSelection();

      if (!selection) {
        throw new Error('Test setup failed: no selection available');
      }

      selection.removeAllRanges();
      selection.addRange(range);

      tool.applyColor('color', '#d44c47');

      const mark = container.querySelector('mark');

      expect(mark).not.toBeNull();
      expect(mark?.style.backgroundColor).toBe('transparent');
    });

    it('adds transparent background when updating text color on existing mark without background', () => {
      container.innerHTML = '<mark style="color: #d44c47">hello</mark>';

      const mark = container.querySelector('mark');

      if (!mark) {
        throw new Error('Test setup failed: mark element not found');
      }

      const range = document.createRange();

      range.selectNodeContents(mark);

      const selection = window.getSelection();

      if (!selection) {
        throw new Error('Test setup failed: no selection available');
      }

      selection.removeAllRanges();
      selection.addRange(range);

      tool.applyColor('color', '#448361');

      const updatedMark = container.querySelector('mark');

      expect(updatedMark).not.toBeNull();
      expect(updatedMark?.style.color).toBe('rgb(68, 131, 97)');
      expect(updatedMark?.style.backgroundColor).toBe('transparent');
    });

    it('wraps selected text with mark for background color', () => {
      container.innerHTML = 'hello world';

      const textNode = container.firstChild;

      if (!textNode) {
        throw new Error('Test setup failed: no text node');
      }

      const range = document.createRange();

      range.setStart(textNode, 0);
      range.setEnd(textNode, 5);

      const selection = window.getSelection();

      if (!selection) {
        throw new Error('Test setup failed: no selection available');
      }

      selection.removeAllRanges();
      selection.addRange(range);

      tool.applyColor('background-color', '#fbecdd');

      const mark = container.querySelector('mark');

      expect(mark).not.toBeNull();
      expect(mark?.style.backgroundColor).toBe('rgb(251, 236, 221)');
    });

    it('sets transparent bg on nested marks that keep text color when applying new background', () => {
      container.innerHTML =
        '<mark style="background-color: #fbecdd; color: #d44c47">Hello</mark>' +
        ' ' +
        '<mark style="background-color: #e7f3f8">World</mark>';

      const range = document.createRange();

      range.setStart(container, 0);
      range.setEnd(container, container.childNodes.length);

      const selection = window.getSelection();

      if (!selection) {
        throw new Error('Test setup failed: no selection available');
      }

      selection.removeAllRanges();
      selection.addRange(range);

      tool.applyColor('background-color', '#f6f3f9');

      const innerMark = container.querySelector('mark mark');

      expect(innerMark).not.toBeNull();
      expect(innerMark?.style.backgroundColor).toBe('transparent');
    });

    it('unwraps nested marks with only transparent background when applying new color across them', () => {
      container.innerHTML =
        '<mark style="color: #d44c47; background-color: transparent">Hello</mark>' +
        ' ' +
        '<mark style="color: #448361; background-color: transparent">World</mark>';

      const range = document.createRange();

      range.setStart(container, 0);
      range.setEnd(container, container.childNodes.length);

      const selection = window.getSelection();

      if (!selection) {
        throw new Error('Test setup failed: no selection available');
      }

      selection.removeAllRanges();
      selection.addRange(range);

      tool.applyColor('color', '#337ea9');

      /**
       * After applying a new text color across the selection, the inner marks
       * that had only color + transparent bg should be unwrapped (not nested),
       * leaving a single outer mark with the new color.
       */
      const nestedMark = container.querySelector('mark mark');

      expect(nestedMark).toBeNull();

      const outerMark = container.querySelector('mark');

      expect(outerMark).not.toBeNull();
      expect(outerMark?.style.color).toBe('rgb(51, 126, 169)');
    });

    it('only colors the selected portion when selection is a subset of an existing mark', () => {
      container.innerHTML = '<mark style="color: #d44c47">Hello World</mark>';

      const markEl = container.querySelector('mark');

      if (!markEl?.firstChild) {
        throw new Error('Test setup failed: mark element not found');
      }

      const textNode = markEl.firstChild;
      const range = document.createRange();

      // Select only "World" (offset 6..11)
      range.setStart(textNode, 6);
      range.setEnd(textNode, 11);

      const selection = window.getSelection();

      if (!selection) {
        throw new Error('Test setup failed: no selection available');
      }

      selection.removeAllRanges();
      selection.addRange(range);

      tool.applyColor('color', '#448361');

      const marks = container.querySelectorAll('mark');

      // Should have two marks: "Hello " in original red, "World" in new green
      expect(marks.length).toBe(2);
      expect(marks[0].textContent).toBe('Hello ');
      expect(marks[0].style.color).toBe('rgb(212, 76, 71)');
      expect(marks[0].style.backgroundColor).toBe('transparent');
      expect(marks[1].textContent).toBe('World');
      expect(marks[1].style.color).toBe('rgb(68, 131, 97)');
      expect(marks[1].style.backgroundColor).toBe('transparent');
    });

    it('only colors the selected portion for background-color mode', () => {
      container.innerHTML = '<mark style="background-color: #fbecdd">Hello World</mark>';

      const markEl = container.querySelector('mark');

      if (!markEl?.firstChild) {
        throw new Error('Test setup failed: mark element not found');
      }

      const textNode = markEl.firstChild;
      const range = document.createRange();

      // Select only "Hello" (offset 0..5)
      range.setStart(textNode, 0);
      range.setEnd(textNode, 5);

      const selection = window.getSelection();

      if (!selection) {
        throw new Error('Test setup failed: no selection available');
      }

      selection.removeAllRanges();
      selection.addRange(range);

      tool.applyColor('background-color', '#e7f3f8');

      const marks = container.querySelectorAll('mark');

      // "Hello" with new color, " World" with original color
      expect(marks.length).toBe(2);
      expect(marks[0].textContent).toBe('Hello');
      expect(marks[0].style.backgroundColor).toBe('rgb(231, 243, 248)');
      expect(marks[1].textContent).toBe(' World');
      expect(marks[1].style.backgroundColor).toBe('rgb(251, 236, 221)');
    });
  });

  describe('removeColor', () => {
    it('removes mark element when clearing the only style property', () => {
      container.innerHTML = '<mark style="color: #d44c47">colored</mark> text';

      const markEl = container.querySelector('mark');

      if (!markEl) {
        throw new Error('Test setup failed: mark element not found');
      }

      const range = document.createRange();

      range.selectNodeContents(markEl);

      const selection = window.getSelection();

      if (!selection) {
        throw new Error('Test setup failed: no selection available');
      }

      selection.removeAllRanges();
      selection.addRange(range);

      tool.removeColor('color');

      expect(container.querySelector('mark')).toBeNull();
      expect(container.textContent).toBe('colored text');
    });

    it('unwraps mark when removing text color leaves only transparent background', () => {
      container.innerHTML = '<mark style="color: #d44c47; background-color: transparent">colored</mark> text';

      const markEl = container.querySelector('mark');

      if (!markEl) {
        throw new Error('Test setup failed: mark element not found');
      }

      const range = document.createRange();

      range.selectNodeContents(markEl);

      const selection = window.getSelection();

      if (!selection) {
        throw new Error('Test setup failed: no selection available');
      }

      selection.removeAllRanges();
      selection.addRange(range);

      tool.removeColor('color');

      expect(container.querySelector('mark')).toBeNull();
      expect(container.textContent).toBe('colored text');
    });

    it('preserves mark when removing one of two style properties', () => {
      container.innerHTML = '<mark style="color: #d44c47; background-color: #fbecdd">both</mark>';

      const markEl = container.querySelector('mark');

      if (!markEl) {
        throw new Error('Test setup failed: mark element not found');
      }

      const range = document.createRange();

      range.selectNodeContents(markEl);

      const selection = window.getSelection();

      if (!selection) {
        throw new Error('Test setup failed: no selection available');
      }

      selection.removeAllRanges();
      selection.addRange(range);

      tool.removeColor('color');

      const mark = container.querySelector('mark');

      expect(mark).not.toBeNull();
      expect(mark?.style.color).toBe('');
      expect(mark?.style.backgroundColor).toBe('rgb(251, 236, 221)');
    });
  });

  describe('picker stays open after color selection', () => {
    /**
     * Helper to extract the picker element from a tool's rendered menu config
     */
    function getPickerElement(markerTool: MarkerInlineTool): HTMLElement {
      const config = markerTool.render();

      if (!('children' in config) || config.children === undefined) {
        throw new Error('Expected config with children');
      }

      const items = config.children.items ?? [];

      return (items[0] as PopoverItemHtmlParams).element;
    }

    it('does not call inlineToolbar.close when a swatch is clicked', () => {
      container.innerHTML = 'hello world';

      const textNode = container.firstChild;

      if (!textNode) {
        throw new Error('Test setup failed: no text node');
      }

      const range = document.createRange();

      range.setStart(textNode, 0);
      range.setEnd(textNode, 5);

      const selection = window.getSelection();

      if (!selection) {
        throw new Error('Test setup failed: no selection available');
      }

      selection.removeAllRanges();
      selection.addRange(range);

      const api = createMockApi();
      const toolWithApi = new MarkerInlineTool({ api: api as never, config: undefined });
      const picker = getPickerElement(toolWithApi);
      const swatch = picker.querySelector<HTMLButtonElement>(
        '[data-blok-testid="marker-swatch-red"]'
      );

      if (!swatch) {
        throw new Error('Test setup failed: red swatch not found');
      }

      swatch.click();

      expect(api.inlineToolbar.close).not.toHaveBeenCalled();
    });

    it('does not call inlineToolbar.close when Default button is clicked', () => {
      container.innerHTML = '<mark style="color: #d44c47">colored</mark>';

      const markEl = container.querySelector('mark');

      if (!markEl) {
        throw new Error('Test setup failed: mark element not found');
      }

      const range = document.createRange();

      range.selectNodeContents(markEl);

      const selection = window.getSelection();

      if (!selection) {
        throw new Error('Test setup failed: no selection available');
      }

      selection.removeAllRanges();
      selection.addRange(range);

      const api = createMockApi();
      const toolWithApi = new MarkerInlineTool({ api: api as never, config: undefined });
      const picker = getPickerElement(toolWithApi);
      const defaultBtn = picker.querySelector<HTMLButtonElement>(
        '[data-blok-testid="marker-default-btn"]'
      );

      if (!defaultBtn) {
        throw new Error('Test setup failed: default button not found');
      }

      defaultBtn.click();

      expect(api.inlineToolbar.close).not.toHaveBeenCalled();
    });
  });

  describe('picker swatch appearance', () => {
    /**
     * Extract the picker HTMLElement from the rendered menu config
     */
    function getPickerElement(): HTMLElement {
      const config = tool.render();

      if (!('children' in config) || config.children === undefined) {
        throw new Error('Expected config with children');
      }

      const children = config.children;
      const items = children.items ?? [];
      const firstItem = items[0] as PopoverItemHtmlParams;

      return firstItem.element;
    }

    it('renders text-mode swatches with a visible background', () => {
      const picker = getPickerElement();
      const swatch = picker.querySelector<HTMLButtonElement>(
        '[data-blok-testid="marker-swatch-red"]'
      );

      expect(swatch).not.toBeNull();
      expect(swatch?.style.backgroundColor).not.toBe('');
    });

    it('renders background-mode swatches with their preset background color', () => {
      const picker = getPickerElement();

      const bgTab = picker.querySelector<HTMLButtonElement>(
        '[data-blok-testid="marker-tab-background-color"]'
      );

      bgTab?.click();

      const swatch = picker.querySelector<HTMLButtonElement>(
        '[data-blok-testid="marker-swatch-red"]'
      );

      expect(swatch).not.toBeNull();
      expect(swatch?.style.backgroundColor).toBe('rgb(253, 235, 236)');
    });
  });

  describe('text + background color combinations', () => {
    /**
     * Select the entire text content of a mark element inside the container
     */
    function selectMarkContents(mark: HTMLElement): void {
      const range = document.createRange();

      range.selectNodeContents(mark);

      const selection = window.getSelection();

      if (!selection) {
        throw new Error('Test setup failed: no selection available');
      }

      selection.removeAllRanges();
      selection.addRange(range);
    }

    /**
     * Select a text range within a node by character offsets
     */
    function selectTextRange(node: Node, start: number, end: number): void {
      const range = document.createRange();

      range.setStart(node, start);
      range.setEnd(node, end);

      const selection = window.getSelection();

      if (!selection) {
        throw new Error('Test setup failed: no selection available');
      }

      selection.removeAllRanges();
      selection.addRange(range);
    }

    it('applies background color to text that already has text color', () => {
      container.innerHTML = '<mark style="color: #d44c47">hello</mark>';

      const mark = container.querySelector('mark');

      if (!mark) {
        throw new Error('Test setup failed: mark element not found');
      }

      selectMarkContents(mark);
      tool.applyColor('background-color', '#e7f3f8');

      const updatedMark = container.querySelector('mark');

      expect(updatedMark).not.toBeNull();
      expect(container.querySelectorAll('mark').length).toBe(1);
      expect(updatedMark?.style.color).toBe('rgb(212, 76, 71)');
      expect(updatedMark?.style.backgroundColor).toBe('rgb(231, 243, 248)');
    });

    it('applies text color to text that already has background color', () => {
      container.innerHTML = '<mark style="background-color: #fbecdd">hello</mark>';

      const mark = container.querySelector('mark');

      if (!mark) {
        throw new Error('Test setup failed: mark element not found');
      }

      selectMarkContents(mark);
      tool.applyColor('color', '#448361');

      const updatedMark = container.querySelector('mark');

      expect(updatedMark).not.toBeNull();
      expect(container.querySelectorAll('mark').length).toBe(1);
      expect(updatedMark?.style.color).toBe('rgb(68, 131, 97)');
      expect(updatedMark?.style.backgroundColor).toBe('rgb(251, 236, 221)');
    });

    it('changes text color while preserving existing background color', () => {
      container.innerHTML = '<mark style="color: #d44c47; background-color: #fbecdd">hello</mark>';

      const mark = container.querySelector('mark');

      if (!mark) {
        throw new Error('Test setup failed: mark element not found');
      }

      selectMarkContents(mark);
      tool.applyColor('color', '#337ea9');

      const updatedMark = container.querySelector('mark');

      expect(updatedMark).not.toBeNull();
      expect(updatedMark?.style.color).toBe('rgb(51, 126, 169)');
      expect(updatedMark?.style.backgroundColor).toBe('rgb(251, 236, 221)');
    });

    it('changes background color while preserving existing text color', () => {
      container.innerHTML = '<mark style="color: #d44c47; background-color: #fbecdd">hello</mark>';

      const mark = container.querySelector('mark');

      if (!mark) {
        throw new Error('Test setup failed: mark element not found');
      }

      selectMarkContents(mark);
      tool.applyColor('background-color', '#f6f3f9');

      const updatedMark = container.querySelector('mark');

      expect(updatedMark).not.toBeNull();
      expect(updatedMark?.style.color).toBe('rgb(212, 76, 71)');
      expect(updatedMark?.style.backgroundColor).toBe('rgb(246, 243, 249)');
    });

    it('preserves background color when splitting mark with new text color on partial selection', () => {
      container.innerHTML = '<mark style="color: #d44c47; background-color: #fbecdd">Hello World</mark>';

      const mark = container.querySelector('mark');

      if (!mark?.firstChild) {
        throw new Error('Test setup failed: mark element not found');
      }

      selectTextRange(mark.firstChild, 6, 11);
      tool.applyColor('color', '#448361');

      const marks = container.querySelectorAll('mark');

      expect(marks.length).toBe(2);

      // "Hello " keeps original text color + background
      expect(marks[0].textContent).toBe('Hello ');
      expect(marks[0].style.color).toBe('rgb(212, 76, 71)');
      expect(marks[0].style.backgroundColor).toBe('rgb(251, 236, 221)');

      // "World" gets new text color, keeps original background
      expect(marks[1].textContent).toBe('World');
      expect(marks[1].style.color).toBe('rgb(68, 131, 97)');
      expect(marks[1].style.backgroundColor).toBe('rgb(251, 236, 221)');
    });

    it('preserves text color when splitting mark with new background on partial selection', () => {
      container.innerHTML = '<mark style="color: #d44c47; background-color: #fbecdd">Hello World</mark>';

      const mark = container.querySelector('mark');

      if (!mark?.firstChild) {
        throw new Error('Test setup failed: mark element not found');
      }

      selectTextRange(mark.firstChild, 6, 11);
      tool.applyColor('background-color', '#e7f3f8');

      const marks = container.querySelectorAll('mark');

      expect(marks.length).toBe(2);

      // "Hello " keeps original text color + background
      expect(marks[0].textContent).toBe('Hello ');
      expect(marks[0].style.color).toBe('rgb(212, 76, 71)');
      expect(marks[0].style.backgroundColor).toBe('rgb(251, 236, 221)');

      // "World" keeps original text color, gets new background
      expect(marks[1].textContent).toBe('World');
      expect(marks[1].style.color).toBe('rgb(212, 76, 71)');
      expect(marks[1].style.backgroundColor).toBe('rgb(231, 243, 248)');
    });

    it('splits into three segments preserving both styles on before and after portions', () => {
      container.innerHTML = '<mark style="color: #d44c47; background-color: #fbecdd">Hello World End</mark>';

      const mark = container.querySelector('mark');

      if (!mark?.firstChild) {
        throw new Error('Test setup failed: mark element not found');
      }

      // Select "World" (offset 6..11)
      selectTextRange(mark.firstChild, 6, 11);
      tool.applyColor('color', '#448361');

      const marks = container.querySelectorAll('mark');

      expect(marks.length).toBe(3);

      // "Hello " — original styles
      expect(marks[0].textContent).toBe('Hello ');
      expect(marks[0].style.color).toBe('rgb(212, 76, 71)');
      expect(marks[0].style.backgroundColor).toBe('rgb(251, 236, 221)');

      // "World" — new text color, original background
      expect(marks[1].textContent).toBe('World');
      expect(marks[1].style.color).toBe('rgb(68, 131, 97)');
      expect(marks[1].style.backgroundColor).toBe('rgb(251, 236, 221)');

      // " End" — original styles
      expect(marks[2].textContent).toBe(' End');
      expect(marks[2].style.color).toBe('rgb(212, 76, 71)');
      expect(marks[2].style.backgroundColor).toBe('rgb(251, 236, 221)');
    });

    it('removes background color from combined mark keeping only text color with transparent bg', () => {
      container.innerHTML = '<mark style="color: #d44c47; background-color: #fbecdd">both</mark>';

      const mark = container.querySelector('mark');

      if (!mark) {
        throw new Error('Test setup failed: mark element not found');
      }

      selectMarkContents(mark);
      tool.removeColor('background-color');

      const updatedMark = container.querySelector('mark');

      expect(updatedMark).not.toBeNull();
      expect(updatedMark?.style.color).toBe('rgb(212, 76, 71)');
      expect(updatedMark?.style.backgroundColor).toBe('transparent');
    });

    it('unwraps mark when removing text color leaves only transparent background (bug #3)', () => {
      // Bug #3: ensureTransparentBg adds background-color: transparent when only text color
      // is set. Removing text color should unwrap the mark, not leave an orphaned
      // <mark style="background-color: transparent">.
      container.innerHTML = 'hello';

      const textNode = container.firstChild;

      if (!textNode) {
        throw new Error('Test setup failed: no text node');
      }

      // Apply only text color — ensureTransparentBg will add background-color: transparent
      selectTextRange(textNode, 0, 5);
      tool.applyColor('color', '#d44c47');

      const mark = container.querySelector('mark');

      expect(mark).not.toBeNull();
      expect(mark?.style.color).toBe('rgb(212, 76, 71)');
      expect(mark?.style.backgroundColor).toBe('transparent');

      // Now remove text color — mark should be fully unwrapped
      selectMarkContents(mark!);
      tool.removeColor('color');

      expect(container.querySelector('mark')).toBeNull();
      expect(container.textContent).toBe('hello');
    });

    it('does not create nested marks when applying color across two marks with transparent bg (bug #10)', () => {
      // Bug #10: When selection spans two marks that each have background-color: transparent,
      // removeNestedMarkStyle should unwrap them instead of leaving nested marks.
      container.innerHTML = '<mark style="color: #d44c47; background-color: transparent">Hello</mark> <mark style="color: #337ea9; background-color: transparent">World</mark>';

      const marks = container.querySelectorAll('mark');

      if (marks.length < 2 || !marks[0].firstChild || !marks[1].firstChild) {
        throw new Error('Test setup failed: expected 2 mark elements');
      }

      // Select across both marks: "llo Wor"
      const range = document.createRange();

      range.setStart(marks[0].firstChild, 2);
      range.setEnd(marks[1].firstChild, 3);

      const sel = window.getSelection();

      sel?.removeAllRanges();
      sel?.addRange(range);

      // Apply new color across both marks
      tool.applyColor('color', '#448361');

      // Should NOT have nested marks — the inner marks with only transparent bg
      // should have been unwrapped by removeNestedMarkStyle
      const nestedMarks = container.querySelectorAll('mark mark');

      expect(nestedMarks.length).toBe(0);

      // The new mark wraps the selected portion with the new color
      const allMarks = container.querySelectorAll('mark');

      expect(allMarks.length).toBe(1);
      expect(allMarks[0].style.color).toBe('rgb(68, 131, 97)');
    });

    it('unwraps mark completely when both colors are removed sequentially', () => {
      container.innerHTML = '<mark style="color: #d44c47; background-color: #fbecdd">both</mark>';

      const mark = container.querySelector('mark');

      if (!mark) {
        throw new Error('Test setup failed: mark element not found');
      }

      selectMarkContents(mark);
      tool.removeColor('color');

      // After removing text color, mark should still exist with background
      expect(container.querySelector('mark')).not.toBeNull();

      // Select the mark contents again for the second removal
      const remainingMark = container.querySelector('mark');

      if (!remainingMark) {
        throw new Error('Expected mark to still be present after removing one color');
      }

      selectMarkContents(remainingMark);
      tool.removeColor('background-color');

      // Mark should be fully unwrapped now
      expect(container.querySelector('mark')).toBeNull();
      expect(container.textContent).toBe('both');
    });

    it('applies text color then background via sequential applyColor calls on plain text', () => {
      container.innerHTML = 'hello';

      const textNode = container.firstChild;

      if (!textNode) {
        throw new Error('Test setup failed: no text node');
      }

      // First: apply text color
      selectTextRange(textNode, 0, 5);
      tool.applyColor('color', '#d44c47');

      const mark = container.querySelector('mark');

      if (!mark) {
        throw new Error('Expected mark to be created');
      }

      // Second: apply background color to the same mark
      selectMarkContents(mark);
      tool.applyColor('background-color', '#e7f3f8');

      const finalMark = container.querySelector('mark');

      expect(finalMark).not.toBeNull();
      expect(container.querySelectorAll('mark').length).toBe(1);
      expect(finalMark?.style.color).toBe('rgb(212, 76, 71)');
      expect(finalMark?.style.backgroundColor).toBe('rgb(231, 243, 248)');
      expect(finalMark?.textContent).toBe('hello');
    });

    it('applies background then text color via sequential applyColor calls on plain text', () => {
      container.innerHTML = 'hello';

      const textNode = container.firstChild;

      if (!textNode) {
        throw new Error('Test setup failed: no text node');
      }

      // First: apply background color
      selectTextRange(textNode, 0, 5);
      tool.applyColor('background-color', '#fdebec');

      const mark = container.querySelector('mark');

      if (!mark) {
        throw new Error('Expected mark to be created');
      }

      // Second: apply text color to the same mark
      selectMarkContents(mark);
      tool.applyColor('color', '#9065b0');

      const finalMark = container.querySelector('mark');

      expect(finalMark).not.toBeNull();
      expect(container.querySelectorAll('mark').length).toBe(1);
      expect(finalMark?.style.color).toBe('rgb(144, 101, 176)');
      expect(finalMark?.style.backgroundColor).toBe('rgb(253, 235, 236)');
      expect(finalMark?.textContent).toBe('hello');
    });

    it('isActive returns true when caret is inside a mark with both color and background', () => {
      container.innerHTML = '<mark style="color: #d44c47; background-color: #fbecdd">colored</mark>';

      const mark = container.querySelector('mark');

      if (!mark?.firstChild) {
        throw new Error('Test setup failed: mark element not found');
      }

      selectTextRange(mark.firstChild, 2, 2);

      const config = tool.render();
      const isActive = typeof config.isActive === 'function' ? config.isActive() : false;

      expect(isActive).toBe(true);
    });

    describe('all preset combinations', () => {
      const combinationMatrix = COLOR_PRESETS.flatMap((textPreset) =>
        COLOR_PRESETS.map((bgPreset) => ({
          textName: textPreset.name,
          textHex: textPreset.text,
          bgName: bgPreset.name,
          bgHex: bgPreset.bg,
        }))
      );

      it.each(combinationMatrix)(
        'combines $textName text color with $bgName background',
        ({ textHex, bgHex }) => {
          container.innerHTML = `<mark style="color: ${textHex}; background-color: ${bgHex}">test</mark>`;

          const mark = container.querySelector('mark');

          if (!mark) {
            throw new Error('Test setup failed: mark element not found');
          }

          selectMarkContents(mark);

          // Verify both styles coexist on the mark element
          expect(mark.style.color).toBe(hexToRgb(textHex));
          expect(mark.style.backgroundColor).toBe(hexToRgb(bgHex));

          // Apply a fresh text color — background should be preserved
          tool.applyColor('color', textHex);

          const updatedMark = container.querySelector('mark');

          expect(updatedMark).not.toBeNull();
          expect(updatedMark?.style.color).toBe(hexToRgb(textHex));
          expect(updatedMark?.style.backgroundColor).toBe(hexToRgb(bgHex));
        }
      );
    });
  });
});
