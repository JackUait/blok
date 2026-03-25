// test/unit/tools/callout/callout.test.ts

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { API, BlockToolConstructorOptions } from '../../../../types';
import type { CalloutData, CalloutConfig } from '../../../../src/tools/callout/types';

vi.mock('../../../../src/tools/callout/emoji-picker/emoji-data', () => ({
  loadEmojiData: vi.fn().mockResolvedValue([]),
  searchEmojis: vi.fn().mockReturnValue([]),
  groupEmojisByCategory: vi.fn().mockReturnValue(new Map()),
  CURATED_CALLOUT_EMOJIS: [],
}));

const createMockAPI = (): API => ({
  styles: { block: 'ce-block', inlineToolbar: '', inlineToolButton: '', inlineToolButtonActive: '', settingsButton: '', settingsButtonActive: '', selected: '' },
  i18n: { t: (k: string) => k, has: vi.fn().mockReturnValue(false) },
  events: { on: vi.fn(), off: vi.fn(), emit: vi.fn() },
  blocks: {
    insertInsideParent: vi.fn().mockReturnValue({ id: 'child-id', holder: document.createElement('div') }),
    convert: vi.fn(),
    getBlockIndex: vi.fn().mockReturnValue(0),
    getChildren: vi.fn().mockReturnValue([]),
    update: vi.fn(),
    delete: vi.fn(),
  },
  caret: { setToBlock: vi.fn(), isAtStart: vi.fn().mockReturnValue(false) },
  toolbar: { toggleBlockSettings: vi.fn() },
} as unknown as API);

const createOptions = (
  data: Partial<CalloutData> = {},
  overrides: { readOnly?: boolean } = {}
): BlockToolConstructorOptions<CalloutData, CalloutConfig> => ({
  data: { emoji: '💡', color: 'default', ...data } as CalloutData,
  config: {},
  api: createMockAPI(),
  readOnly: overrides.readOnly ?? false,
  block: { id: 'callout-block-id' } as never,
});

describe('CalloutTool', () => {
  beforeEach(() => { vi.clearAllMocks(); });
  afterEach(() => { vi.restoreAllMocks(); });

  describe('render()', () => {
    it('returns an HTMLElement', async () => {
      const { CalloutTool } = await import('../../../../src/tools/callout');
      const tool = new CalloutTool(createOptions());
      const el = tool.render();
      expect(el).toBeInstanceOf(HTMLElement);
    });

    it('contains an emoji button', async () => {
      const { CalloutTool } = await import('../../../../src/tools/callout');
      const tool = new CalloutTool(createOptions({ emoji: '💡' }));
      const el = tool.render();
      const btn = el.querySelector('button');
      expect(btn).not.toBeNull();
      expect(btn!.textContent).toBe('💡');
    });

    it('does NOT contain a contentEditable text element owned by the tool', async () => {
      const { CalloutTool } = await import('../../../../src/tools/callout');
      const tool = new CalloutTool(createOptions());
      const el = tool.render();
      const editables = el.querySelectorAll('[contenteditable="true"]');
      expect(editables).toHaveLength(0);
    });

    it('contains a child container', async () => {
      const { CalloutTool } = await import('../../../../src/tools/callout');
      const tool = new CalloutTool(createOptions());
      const el = tool.render();
      const childContainer = el.querySelector('[data-blok-toggle-children]');
      expect(childContainer).not.toBeNull();
    });
  });

  describe('rendered()', () => {
    it('creates an initial child block and appends its holder when no children exist', async () => {
      const { CalloutTool } = await import('../../../../src/tools/callout');
      const opts = createOptions();
      const tool = new CalloutTool(opts);
      const wrapper = tool.render();

      tool.rendered();

      expect(opts.api.blocks.insertInsideParent).toHaveBeenCalledWith('callout-block-id', expect.any(Number));
      expect(opts.api.caret.setToBlock).toHaveBeenCalledWith('child-id', 'start');

      // Verify the new child's holder was appended to the childContainer
      const container = wrapper.querySelector('[data-blok-toggle-children]')!;
      const newChildHolder = (opts.api.blocks.insertInsideParent as ReturnType<typeof vi.fn>).mock.results[0].value.holder as HTMLElement;
      expect(container.contains(newChildHolder)).toBe(true);
    });

    it('does NOT create a child block when children already exist', async () => {
      const { CalloutTool } = await import('../../../../src/tools/callout');
      const opts = createOptions();
      const mockChild = { id: 'existing-child', holder: document.createElement('div') };
      (opts.api.blocks.getChildren as ReturnType<typeof vi.fn>).mockReturnValue([mockChild]);

      const tool = new CalloutTool(opts);
      tool.render();
      tool.rendered();

      expect(opts.api.blocks.insertInsideParent).not.toHaveBeenCalled();
    });

    it('appends existing children to childContainer', async () => {
      const { CalloutTool } = await import('../../../../src/tools/callout');
      const opts = createOptions();
      const childHolder = document.createElement('div');
      const mockChild = { id: 'existing-child', holder: childHolder };
      (opts.api.blocks.getChildren as ReturnType<typeof vi.fn>).mockReturnValue([mockChild]);

      const tool = new CalloutTool(opts);
      const wrapper = tool.render();
      tool.rendered();

      const container = wrapper.querySelector('[data-blok-toggle-children]')!;
      expect(container.contains(childHolder)).toBe(true);
    });
  });

  describe('save()', () => {
    it('returns emoji and color only', async () => {
      const { CalloutTool } = await import('../../../../src/tools/callout');
      const tool = new CalloutTool(createOptions({ emoji: '✅', color: 'green' }));
      tool.render();
      const saved = tool.save();
      expect(saved).toEqual({ emoji: '✅', color: 'green' });
      expect(saved).not.toHaveProperty('text');
    });
  });

  describe('validate()', () => {
    it('always returns true', async () => {
      const { CalloutTool } = await import('../../../../src/tools/callout');
      const tool = new CalloutTool(createOptions());
      expect(tool.validate({ emoji: '', color: 'default' })).toBe(true);
      expect(tool.validate({ emoji: '💡', color: 'blue' })).toBe(true);
    });
  });

  describe('renderSettings()', () => {
    it('returns an array of 11 items (default + 10 colors)', async () => {
      const { CalloutTool } = await import('../../../../src/tools/callout');
      const tool = new CalloutTool(createOptions());
      const settings = tool.renderSettings();
      expect(Array.isArray(settings)).toBe(true);
      expect((settings as unknown[]).length).toBe(11);
    });

    it('marks the current color as active', async () => {
      const { CalloutTool } = await import('../../../../src/tools/callout');
      const tool = new CalloutTool(createOptions({ color: 'blue' }));
      const settings = tool.renderSettings() as Array<{ isActive: boolean }>;
      const activeItems = settings.filter(s => s.isActive);
      expect(activeItems).toHaveLength(1);
    });
  });

  describe('color change', () => {
    it('applying a color sets backgroundColor on the wrapper', async () => {
      const { CalloutTool } = await import('../../../../src/tools/callout');
      const tool = new CalloutTool(createOptions({ color: 'default' }));
      const wrapper = tool.render();

      const settings = tool.renderSettings() as Array<{ title: string; onActivate: () => void }>;
      const blueItem = settings.find(s => s.title.includes('tools.callout.colorBlue'));
      blueItem?.onActivate();

      expect(wrapper.style.backgroundColor).toBe('var(--blok-color-blue-bg)');
      expect(wrapper.style.color).toBe('var(--blok-color-blue-text)');
    });

    it('applying default color removes inline styles and adds a border', async () => {
      const { CalloutTool } = await import('../../../../src/tools/callout');
      const tool = new CalloutTool(createOptions({ color: 'blue' }));
      const wrapper = tool.render();

      const settings = tool.renderSettings() as Array<{ title: string; onActivate: () => void }>;
      const defaultItem = settings.find(s => s.title.includes('tools.callout.colorDefault'));
      defaultItem?.onActivate();

      expect(wrapper.style.backgroundColor).toBe('');
      expect(wrapper.style.color).toBe('');
      expect(wrapper.style.border).toBe('1px solid var(--blok-callout-default-border, #e5e7eb)');
    });
  });

  describe('static getters', () => {
    it('toolbox returns icon, title, titleKey', async () => {
      const { CalloutTool } = await import('../../../../src/tools/callout');
      const toolbox = CalloutTool.toolbox;
      expect(toolbox).toMatchObject({ title: 'Callout', titleKey: 'callout' });
      const entry = Array.isArray(toolbox) ? toolbox[0] : toolbox;
      expect(typeof entry.icon).toBe('string');
    });

    it('isReadOnlySupported returns true', async () => {
      const { CalloutTool } = await import('../../../../src/tools/callout');
      expect(CalloutTool.isReadOnlySupported).toBe(true);
    });

    it('sanitize does NOT have a text property', async () => {
      const { CalloutTool } = await import('../../../../src/tools/callout');
      expect(CalloutTool.sanitize).not.toHaveProperty('text');
    });

    it('conversionConfig imports with default emoji and color', async () => {
      const { CalloutTool } = await import('../../../../src/tools/callout');
      const cfg = CalloutTool.conversionConfig;
      const imported = (cfg.import as (text: string) => CalloutData)('hello');
      expect(imported).toEqual({ emoji: '💡', color: 'default' });
    });
  });
});
