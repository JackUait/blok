 
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { IconItalic } from '../../../../src/components/icons';

import { ItalicInlineTool } from '../../../../src/components/inline-tools/inline-tool-italic';
import type { PopoverItemDefaultBaseParams } from '../../../../types/utils/popover';

describe('ItalicInlineTool', () => {
  let tool: ItalicInlineTool;

  beforeEach(() => {
    tool = new ItalicInlineTool();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('exposes inline metadata and sanitizer config', () => {
    expect(ItalicInlineTool.isInline).toBe(true);
    expect(ItalicInlineTool.title).toBe('Italic');
    expect(ItalicInlineTool.sanitize).toStrictEqual({ i: {},
      em: {} });
  });

  it('renders menu config with italic icon and callbacks', () => {
    const config = tool.render() as PopoverItemDefaultBaseParams;

    expect(config).toHaveProperty('icon');
    expect(config.icon).toBe(IconItalic);
    expect(config.name).toBe('italic');
    expect(config.onActivate).toBeInstanceOf(Function);
    expect(config.isActive).toBeInstanceOf(Function);
  });

  it('exposes CMD+I shortcut', () => {
    expect(ItalicInlineTool.shortcut).toBe('CMD+I');
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
  });

  describe('toggle behavior', () => {
    let div: HTMLDivElement;

    beforeEach(() => {
      div = document.createElement('div');
      div.contentEditable = 'true';
      document.body.appendChild(div);
    });

    afterEach(() => {
      document.body.removeChild(div);
      window.getSelection()?.removeAllRanges();
    });

    it('preserves trailing space when wrapping selected text that ends with a space', () => {
      div.textContent = 'text ';

      const textNode = div.firstChild!;
      const range = document.createRange();

      range.setStart(textNode, 0);
      range.setEnd(textNode, 5);

      const selection = window.getSelection()!;

      selection.removeAllRanges();
      selection.addRange(range);

      const config = tool.render() as PopoverItemDefaultBaseParams;

      (config.onActivate as () => void)();

      expect(div.querySelector('i')?.textContent).toBe('text ');
    });

    it('preserves trailing nbsp as nbsp after normalization (prevents visual collapse)', () => {
      div.textContent = 'text\u00A0';

      const textNode = div.firstChild!;
      const range = document.createRange();

      range.setStart(textNode, 0);
      range.setEnd(textNode, 5);

      const selection = window.getSelection()!;

      selection.removeAllRanges();
      selection.addRange(range);

      const config = tool.render() as PopoverItemDefaultBaseParams;

      (config.onActivate as () => void)();

      const lastChar = div.querySelector('i')!.textContent!.charCodeAt(div.querySelector('i')!.textContent!.length - 1);

      expect(lastChar).toBe(160);
    });

    it('preserves trailing space when browser selection excludes it (Chromium/WebKit Ctrl+A)', () => {
      div.textContent = 'text ';

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

      // The trailing space must be INSIDE the <i> tag, not orphaned outside
      expect(div.querySelector('i')?.textContent).toBe('text ');
    });
  });
});

