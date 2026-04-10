import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { IconStrikethrough } from '../../../../src/components/icons';
import { StrikethroughInlineTool } from '../../../../src/components/inline-tools/inline-tool-strikethrough';
import type { PopoverItemDefaultBaseParams } from '../../../../types/utils/popover';

describe('StrikethroughInlineTool', () => {
  let tool: StrikethroughInlineTool;

  beforeEach(() => {
    vi.clearAllMocks();
    tool = new StrikethroughInlineTool();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('exposes inline metadata and sanitizer config', () => {
    expect(StrikethroughInlineTool.isInline).toBe(true);
    expect(StrikethroughInlineTool.title).toBe('Strikethrough');
    expect(StrikethroughInlineTool.titleKey).toBe('strikethrough');
    expect(StrikethroughInlineTool.sanitize).toStrictEqual({ s: {} });
  });

  it('renders menu config with strikethrough icon and callbacks', () => {
    const config = tool.render() as PopoverItemDefaultBaseParams;

    expect(config).toHaveProperty('icon');
    expect(config.icon).toBe(IconStrikethrough);
    expect(config.name).toBe('strikethrough');
    expect(config.onActivate).toBeInstanceOf(Function);
    expect(config.isActive).toBeInstanceOf(Function);
  });

  it('exposes CMD+SHIFT+S shortcut', () => {
    expect(StrikethroughInlineTool.shortcut).toBe('CMD+SHIFT+S');
  });

  describe('isActive', () => {
    it('should return false if no selection', () => {
      vi.spyOn(window, 'getSelection').mockReturnValue(null);

      const config = tool.render() as PopoverItemDefaultBaseParams;

      expect(typeof config.isActive === 'function' && config.isActive()).toBe(false);
    });

    it('should return false if range count is 0', () => {
      const mockSelection = {
        rangeCount: 0,
        getRangeAt: vi.fn(),
      } as unknown as Selection;

      vi.spyOn(window, 'getSelection').mockReturnValue(mockSelection);

      const config = tool.render() as PopoverItemDefaultBaseParams;

      expect(typeof config.isActive === 'function' && config.isActive()).toBe(false);
    });

    it('should return true when selection is inside a <s> tag', () => {
      const container = document.createElement('div');
      const s = document.createElement('s');
      const text = document.createTextNode('hello');

      s.appendChild(text);
      container.appendChild(s);
      document.body.appendChild(container);

      const range = document.createRange();

      range.selectNodeContents(s);

      const mockSelection = {
        rangeCount: 1,
        getRangeAt: vi.fn().mockReturnValue(range),
      } as unknown as Selection;

      vi.spyOn(window, 'getSelection').mockReturnValue(mockSelection);

      const config = tool.render() as PopoverItemDefaultBaseParams;

      expect(typeof config.isActive === 'function' && config.isActive()).toBe(true);

      document.body.removeChild(container);
    });

    it('should return false when selection is outside a <s> tag', () => {
      const container = document.createElement('div');
      const text = document.createTextNode('hello');

      container.appendChild(text);
      document.body.appendChild(container);

      const range = document.createRange();

      range.selectNodeContents(container);

      const mockSelection = {
        rangeCount: 1,
        getRangeAt: vi.fn().mockReturnValue(range),
      } as unknown as Selection;

      vi.spyOn(window, 'getSelection').mockReturnValue(mockSelection);

      const config = tool.render() as PopoverItemDefaultBaseParams;

      expect(typeof config.isActive === 'function' && config.isActive()).toBe(false);

      document.body.removeChild(container);
    });
  });

  describe('onActivate', () => {
    it('should wrap selected text with <s> tag', () => {
      const container = document.createElement('div');
      const text = document.createTextNode('hello');

      container.appendChild(text);
      document.body.appendChild(container);

      const range = document.createRange();

      range.selectNodeContents(container);

      const mockSelection = {
        rangeCount: 1,
        getRangeAt: vi.fn().mockReturnValue(range),
        removeAllRanges: vi.fn(),
        addRange: vi.fn(),
      } as unknown as Selection;

      vi.spyOn(window, 'getSelection').mockReturnValue(mockSelection);

      const config = tool.render() as PopoverItemDefaultBaseParams;

      (config.onActivate as () => void)();

      expect(container.querySelector('s')).not.toBeNull();
      expect(container.querySelector('s')?.textContent).toBe('hello');

      document.body.removeChild(container);
    });

    it('should unwrap <s> tag from already-strikethrough selection', () => {
      const container = document.createElement('div');
      const s = document.createElement('s');
      const text = document.createTextNode('hello');

      s.appendChild(text);
      container.appendChild(s);
      document.body.appendChild(container);

      const range = document.createRange();

      range.selectNodeContents(s);

      const mockSelection = {
        rangeCount: 1,
        getRangeAt: vi.fn().mockReturnValue(range),
        removeAllRanges: vi.fn(),
        addRange: vi.fn(),
      } as unknown as Selection;

      vi.spyOn(window, 'getSelection').mockReturnValue(mockSelection);

      const config = tool.render() as PopoverItemDefaultBaseParams;

      (config.onActivate as () => void)();

      expect(container.querySelector('s')).toBeNull();
      expect(container.textContent).toBe('hello');

      document.body.removeChild(container);
    });

    it('should not create nested <s> tags when wrapping content that contains <s>', () => {
      const container = document.createElement('div');
      const plain = document.createTextNode('before ');
      const s = document.createElement('s');
      const sText = document.createTextNode('inside');

      s.appendChild(sText);
      container.appendChild(plain);
      container.appendChild(s);
      document.body.appendChild(container);

      const range = document.createRange();

      range.selectNodeContents(container);

      const mockSelection = {
        rangeCount: 1,
        getRangeAt: vi.fn().mockReturnValue(range),
        removeAllRanges: vi.fn(),
        addRange: vi.fn(),
      } as unknown as Selection;

      vi.spyOn(window, 'getSelection').mockReturnValue(mockSelection);

      const config = tool.render() as PopoverItemDefaultBaseParams;

      (config.onActivate as () => void)();

      const outerS = container.querySelector('s');

      expect(outerS).not.toBeNull();
      if (outerS !== null) {
        expect(outerS.querySelector('s')).toBeNull();
      }

      document.body.removeChild(container);
    });

    it('preserves trailing space when wrapping selected text that ends with a space', () => {
      const div = document.createElement('div');

      div.contentEditable = 'true';
      div.textContent = 'text ';
      document.body.appendChild(div);

      const textNode = div.firstChild!;
      const range = document.createRange();

      range.setStart(textNode, 0);
      range.setEnd(textNode, 5);

      const selection = window.getSelection()!;

      selection.removeAllRanges();
      selection.addRange(range);

      const config = tool.render() as PopoverItemDefaultBaseParams;

      (config.onActivate as () => void)();

      expect(div.querySelector('s')?.textContent).toBe('text ');

      document.body.removeChild(div);
    });

    it('preserves trailing space when browser selection excludes it (Chromium/WebKit Ctrl+A)', () => {
      const div = document.createElement('div');

      div.contentEditable = 'true';
      div.textContent = 'text ';
      document.body.appendChild(div);

      const textNode = div.firstChild!;
      const range = document.createRange();

      // Simulate Chromium/WebKit Ctrl+A: endOffset stops BEFORE trailing space
      range.setStart(textNode, 0);
      range.setEnd(textNode, 4);

      const selection = window.getSelection()!;

      selection.removeAllRanges();
      selection.addRange(range);

      const config = tool.render() as PopoverItemDefaultBaseParams;

      (config.onActivate as () => void)();

      // The trailing space must be INSIDE the <s> tag, not orphaned outside
      expect(div.querySelector('s')?.textContent).toBe('text ');

      document.body.removeChild(div);
    });
  });
});
