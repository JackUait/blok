import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { IconUnderline } from '../../../../src/components/icons';
import { UnderlineInlineTool } from '../../../../src/components/inline-tools/inline-tool-underline';
import type { PopoverItemDefaultBaseParams } from '../../../../types/utils/popover';

describe('UnderlineInlineTool', () => {
  let tool: UnderlineInlineTool;

  beforeEach(() => {
    vi.clearAllMocks();
    tool = new UnderlineInlineTool();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('exposes inline metadata and sanitizer config', () => {
    expect(UnderlineInlineTool.isInline).toBe(true);
    expect(UnderlineInlineTool.title).toBe('Underline');
    expect(UnderlineInlineTool.titleKey).toBe('underline');
    expect(UnderlineInlineTool.sanitize).toStrictEqual({ u: {} });
  });

  it('renders menu config with underline icon and callbacks', () => {
    const config = tool.render() as PopoverItemDefaultBaseParams;

    expect(config).toHaveProperty('icon');
    expect(config.icon).toBe(IconUnderline);
    expect(config.name).toBe('underline');
    expect(config.onActivate).toBeInstanceOf(Function);
    expect(config.isActive).toBeInstanceOf(Function);
  });

  it('exposes CMD+U shortcut', () => {
    expect(UnderlineInlineTool.shortcut).toBe('CMD+U');
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

    it('should return true when selection is inside a <u> tag', () => {
      const container = document.createElement('div');
      const u = document.createElement('u');
      const text = document.createTextNode('hello');

      u.appendChild(text);
      container.appendChild(u);
      document.body.appendChild(container);

      const range = document.createRange();

      range.selectNodeContents(u);

      const mockSelection = {
        rangeCount: 1,
        getRangeAt: vi.fn().mockReturnValue(range),
      } as unknown as Selection;

      vi.spyOn(window, 'getSelection').mockReturnValue(mockSelection);

      const config = tool.render() as PopoverItemDefaultBaseParams;

      expect(typeof config.isActive === 'function' && config.isActive()).toBe(true);

      document.body.removeChild(container);
    });

    it('should return false when selection is outside a <u> tag', () => {
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
    it('should wrap selected text with <u> tag', () => {
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

      expect(container.querySelector('u')).not.toBeNull();
      expect(container.querySelector('u')?.textContent).toBe('hello');

      document.body.removeChild(container);
    });

    it('should unwrap <u> tag from already-underlined selection', () => {
      const container = document.createElement('div');
      const u = document.createElement('u');
      const text = document.createTextNode('hello');

      u.appendChild(text);
      container.appendChild(u);
      document.body.appendChild(container);

      const range = document.createRange();

      range.selectNodeContents(u);

      const mockSelection = {
        rangeCount: 1,
        getRangeAt: vi.fn().mockReturnValue(range),
        removeAllRanges: vi.fn(),
        addRange: vi.fn(),
      } as unknown as Selection;

      vi.spyOn(window, 'getSelection').mockReturnValue(mockSelection);

      const config = tool.render() as PopoverItemDefaultBaseParams;

      (config.onActivate as () => void)();

      expect(container.querySelector('u')).toBeNull();
      expect(container.textContent).toBe('hello');

      document.body.removeChild(container);
    });

    it('should not create nested <u> tags when wrapping content that contains <u>', () => {
      const container = document.createElement('div');
      const plain = document.createTextNode('before ');
      const u = document.createElement('u');
      const uText = document.createTextNode('inside');

      u.appendChild(uText);
      container.appendChild(plain);
      container.appendChild(u);
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

      const outerU = container.querySelector('u');

      expect(outerU).not.toBeNull();
      if (outerU !== null) {
        expect(outerU.querySelector('u')).toBeNull();
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

      expect(div.querySelector('u')?.textContent).toBe('text ');

      document.body.removeChild(div);
    });

    it('converts trailing nbsp to regular space after normalization', () => {
      const div = document.createElement('div');

      div.contentEditable = 'true';
      div.textContent = 'text\u00A0';
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

      const lastChar = div.querySelector('u')!.textContent.charCodeAt(div.querySelector('u')!.textContent.length - 1);

      expect(lastChar).toBe(32);

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

      // The trailing space must be INSIDE the <u> tag, not orphaned outside
      expect(div.querySelector('u')?.textContent).toBe('text ');

      document.body.removeChild(div);
    });
  });
});
