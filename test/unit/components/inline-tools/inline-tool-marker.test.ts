import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { IconMarker } from '../../../../src/components/icons';
import { MarkerInlineTool } from '../../../../src/components/inline-tools/inline-tool-marker';
import type { PopoverItemChildren, PopoverItemHtmlParams } from '../../../../types/utils/popover';

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
    expect(MarkerInlineTool.sanitize).toStrictEqual({ mark: { style: true } });
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

  describe('picker swatch appearance', () => {
    /**
     * Extract the picker HTMLElement from the rendered menu config
     */
    function getPickerElement(): HTMLElement {
      const config = tool.render();

      if (!('children' in config) || config.children === undefined) {
        throw new Error('Expected config with children');
      }

      const children = config.children as PopoverItemChildren;
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
});
