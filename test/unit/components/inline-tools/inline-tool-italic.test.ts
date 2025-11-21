/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { IconItalic } from '@codexteam/icons';

import ItalicInlineTool from '../../../../src/components/inline-tools/inline-tool-italic';

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
    const config = tool.render() as any;

    expect(config).toHaveProperty('icon');
    expect(config.icon).toBe(IconItalic);
    expect(config.name).toBe('italic');
    expect(config.onActivate).toBeInstanceOf(Function);
    expect(config.isActive).toBeInstanceOf(Function);
  });

  it('exposes CMD+I shortcut', () => {
    expect(tool.shortcut).toBe('CMD+I');
  });

  describe('isActive', () => {
    it('should return false if no selection', () => {
      vi.spyOn(window, 'getSelection').mockReturnValue(null);

      const config = tool.render() as any;

      expect(config.isActive && config.isActive()).toBe(false);
    });

    it('should return false if range count is 0', () => {
      const mockSelection = {
        rangeCount: 0,
        getRangeAt: vi.fn(),
      } as unknown as Selection;

      vi.spyOn(window, 'getSelection').mockReturnValue(mockSelection);

      const config = tool.render() as any;

      expect(config.isActive && config.isActive()).toBe(false);
    });
  });
});

