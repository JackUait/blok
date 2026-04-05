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
    it('returns a wrapper div containing an hr element', async () => {
      const { DividerTool } = await import('../../../../src/tools/divider');
      const tool = new DividerTool(createOptions());
      const el = tool.render();

      expect(el).toBeInstanceOf(HTMLDivElement);
      expect(el.querySelector('hr')).toBeInstanceOf(HTMLHRElement);
    });

    it('has no contentEditable elements', async () => {
      const { DividerTool } = await import('../../../../src/tools/divider');
      const tool = new DividerTool(createOptions());
      const el = tool.render();
      const editables = el.querySelectorAll('[contenteditable="true"]');

      expect(editables).toHaveLength(0);
    });

    it('applies vertical padding on wrapper for spacing', async () => {
      const { DividerTool } = await import('../../../../src/tools/divider');
      const tool = new DividerTool(createOptions());
      const el = tool.render();

      expect(el.className).toContain('py-3');
    });

    it('sets minimal line-height on wrapper for toolbar centering', async () => {
      const { DividerTool } = await import('../../../../src/tools/divider');
      const tool = new DividerTool(createOptions());
      const el = tool.render();

      expect(el.className).toContain('leading-[1px]');
    });

    it('applies border classes on the hr element', async () => {
      const { DividerTool } = await import('../../../../src/tools/divider');
      const tool = new DividerTool(createOptions());
      const el = tool.render();
      const hr = el.querySelector('hr')!;

      expect(hr.className).toContain('border-t');
      expect(hr.className).toContain('border-border-primary');
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
      const toolbox = DividerTool.toolbox;

      expect(toolbox).toBeDefined();
      expect(!Array.isArray(toolbox) && toolbox.icon).toBeTruthy();
      expect(!Array.isArray(toolbox) && toolbox.titleKey).toBe('divider');
    });

    it('has search terms including ---', async () => {
      const { DividerTool } = await import('../../../../src/tools/divider');
      const toolbox = DividerTool.toolbox;

      expect(!Array.isArray(toolbox) && toolbox.searchTerms).toContain('---');
    });

    it('has searchTermKeys for translated aliases', async () => {
      const { DividerTool } = await import('../../../../src/tools/divider');
      const toolbox = DividerTool.toolbox;

      expect(!Array.isArray(toolbox) && toolbox.searchTermKeys).toEqual([
        'divider',
        'separator',
        'delimiter',
        'splitter',
      ]);
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

    it('has tags property containing HR for tag-based paste', async () => {
      const { DividerTool } = await import('../../../../src/tools/divider');
      const config = DividerTool.pasteConfig;

      expect(config).toBeDefined();
      expect((config as { tags: string[] }).tags).toContain('HR');
    });

    it('has both tags and patterns properties', async () => {
      const { DividerTool } = await import('../../../../src/tools/divider');
      const config = DividerTool.pasteConfig;

      expect(config).toHaveProperty('tags');
      expect(config).toHaveProperty('patterns');
    });
  });

  describe('onPaste()', () => {
    it('has an onPaste method on the prototype for tool registry detection', async () => {
      const { DividerTool } = await import('../../../../src/tools/divider');

      expect(typeof DividerTool.prototype.onPaste).toBe('function');
    });
  });

  describe('static sanitize', () => {
    it('returns empty object', async () => {
      const { DividerTool } = await import('../../../../src/tools/divider');

      expect(DividerTool.sanitize).toEqual({});
    });
  });

  describe('read-only mode', () => {
    it('renders the same wrapper with hr in read-only mode', async () => {
      const { DividerTool } = await import('../../../../src/tools/divider');
      const tool = new DividerTool(createOptions({}, { readOnly: true }));
      const el = tool.render();

      expect(el).toBeInstanceOf(HTMLDivElement);
      expect(el.querySelector('hr')).toBeInstanceOf(HTMLHRElement);
    });
  });
});
