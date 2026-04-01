import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { API, BlockToolConstructorOptions } from '../../../../types';
import type { DividerData } from '../../../../src/tools/divider/types';

const createMockAPI = (): API =>
  ({
    styles: {
      block: 'ce-block',
      inlineToolbar: '',
      inlineToolButton: '',
      inlineToolButtonActive: '',
      settingsButton: '',
      settingsButtonActive: '',
      selected: '',
    },
    i18n: { t: (k: string) => k },
  }) as unknown as API;

const createOptions = (
  data: Partial<DividerData> = {},
  overrides: { readOnly?: boolean } = {}
): BlockToolConstructorOptions<DividerData> => ({
  data: { ...data } as DividerData,
  config: {},
  api: createMockAPI(),
  readOnly: overrides.readOnly ?? false,
  block: { id: 'divider-block-id' } as never,
});

describe('DividerTool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('render()', () => {
    it('returns an HTMLHRElement', async () => {
      const { DividerTool } = await import('../../../../src/tools/divider');
      const tool = new DividerTool(createOptions());
      const el = tool.render();

      expect(el).toBeInstanceOf(HTMLHRElement);
    });

    it('has no contentEditable elements', async () => {
      const { DividerTool } = await import('../../../../src/tools/divider');
      const tool = new DividerTool(createOptions());
      const el = tool.render();
      const editables = el.querySelectorAll('[contenteditable="true"]');

      expect(editables).toHaveLength(0);
    });

    it('applies Tailwind border classes', async () => {
      const { DividerTool } = await import('../../../../src/tools/divider');
      const tool = new DividerTool(createOptions());
      const el = tool.render();

      expect(el.className).toContain('border-t');
      expect(el.className).toContain('my-2');
    });
  });

  describe('save()', () => {
    it('returns an empty object', async () => {
      const { DividerTool } = await import('../../../../src/tools/divider');
      const tool = new DividerTool(createOptions());

      tool.render();
      const data = tool.save();

      expect(data).toEqual({});
    });
  });

  describe('validate()', () => {
    it('always returns true', async () => {
      const { DividerTool } = await import('../../../../src/tools/divider');
      const tool = new DividerTool(createOptions());

      expect(tool.validate({} as DividerData)).toBe(true);
    });
  });

  describe('static toolbox', () => {
    it('has icon and titleKey', async () => {
      const { DividerTool } = await import('../../../../src/tools/divider');

      expect(DividerTool.toolbox).toBeDefined();
      expect(DividerTool.toolbox!.icon).toBeTruthy();
      expect(DividerTool.toolbox!.titleKey).toBe('divider');
    });

    it('has search terms including ---', async () => {
      const { DividerTool } = await import('../../../../src/tools/divider');

      expect(DividerTool.toolbox!.searchTerms).toContain('---');
    });
  });

  describe('static isReadOnlySupported', () => {
    it('returns true', async () => {
      const { DividerTool } = await import('../../../../src/tools/divider');

      expect(DividerTool.isReadOnlySupported).toBe(true);
    });
  });

  describe('static pasteConfig', () => {
    it('defines a pattern for three or more hyphens', async () => {
      const { DividerTool } = await import('../../../../src/tools/divider');
      const config = DividerTool.pasteConfig;

      expect(config).toBeDefined();
      expect((config as { patterns: Record<string, RegExp> }).patterns.divider).toBeInstanceOf(RegExp);
      expect((config as { patterns: Record<string, RegExp> }).patterns.divider.test('---')).toBe(true);
      expect((config as { patterns: Record<string, RegExp> }).patterns.divider.test('----')).toBe(true);
      expect((config as { patterns: Record<string, RegExp> }).patterns.divider.test('--')).toBe(false);
      expect((config as { patterns: Record<string, RegExp> }).patterns.divider.test('--- text')).toBe(false);
    });
  });

  describe('static sanitize', () => {
    it('returns empty object', async () => {
      const { DividerTool } = await import('../../../../src/tools/divider');

      expect(DividerTool.sanitize).toEqual({});
    });
  });

  describe('read-only mode', () => {
    it('renders the same element in read-only mode', async () => {
      const { DividerTool } = await import('../../../../src/tools/divider');
      const tool = new DividerTool(createOptions({}, { readOnly: true }));
      const el = tool.render();

      expect(el).toBeInstanceOf(HTMLHRElement);
    });
  });
});
