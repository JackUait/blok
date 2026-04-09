import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { IconCode } from '../../../../src/components/icons';
import { CodeInlineTool } from '../../../../src/components/inline-tools/inline-tool-code';
import type { PopoverItemDefaultBaseParams } from '../../../../types/utils/popover';

describe('CodeInlineTool', () => {
  let tool: CodeInlineTool;

  beforeEach(() => {
    vi.clearAllMocks();
    tool = new CodeInlineTool();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('exposes inline metadata and sanitizer config', () => {
    expect(CodeInlineTool.isInline).toBe(true);
    expect(CodeInlineTool.title).toBe('Code');
    expect(CodeInlineTool.sanitize).toStrictEqual({ code: {} });
  });

  it('renders menu config with code icon and callbacks', () => {
    const config = tool.render() as PopoverItemDefaultBaseParams;

    expect(config).toHaveProperty('icon');
    expect(config.icon).toBe(IconCode);
    expect(config.name).toBe('code');
    expect(config.onActivate).toBeInstanceOf(Function);
    expect(config.isActive).toBeInstanceOf(Function);
  });

  it('exposes CMD+E shortcut', () => {
    expect(CodeInlineTool.shortcut).toBe('CMD+E');
  });

  it('has titleKey for i18n', () => {
    expect(CodeInlineTool.titleKey).toBe('inlineCode');
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
    it('wraps selected text in <code> tag', () => {
      const div = document.createElement('div');

      div.contentEditable = 'true';
      div.textContent = 'hello world';
      document.body.appendChild(div);

      const textNode = div.firstChild!;
      const range = document.createRange();

      range.setStart(textNode, 6);
      range.setEnd(textNode, 11);
      const selection = window.getSelection()!;

      selection.removeAllRanges();
      selection.addRange(range);

      const config = tool.render() as PopoverItemDefaultBaseParams;

      (config.onActivate as () => void)();

      expect(div.innerHTML).toContain('<code>');
      expect(div.querySelector('code')?.textContent).toBe('world');

      document.body.removeChild(div);
    });

    it('unwraps <code> tag when already formatted', () => {
      const div = document.createElement('div');

      div.contentEditable = 'true';
      div.innerHTML = 'hello <code>world</code>';
      document.body.appendChild(div);

      const codeEl = div.querySelector('code')!;
      const textNode = codeEl.firstChild!;
      const range = document.createRange();

      range.setStart(textNode, 0);
      range.setEnd(textNode, 5);
      const selection = window.getSelection()!;

      selection.removeAllRanges();
      selection.addRange(range);

      const config = tool.render() as PopoverItemDefaultBaseParams;

      (config.onActivate as () => void)();

      expect(div.querySelector('code')).toBeNull();
      expect(div.textContent).toBe('hello world');

      document.body.removeChild(div);
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

      expect(div.querySelector('code')?.textContent).toBe('text ');

      document.body.removeChild(div);
    });
  });
});
