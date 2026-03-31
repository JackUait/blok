// test/unit/tools/callout/callout.test.ts

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { API, BlockToolConstructorOptions } from '../../../../types';
import { PopoverItemType } from '../../../../types/utils/popover/popover-item-type';
import type { CalloutData, CalloutConfig } from '../../../../src/tools/callout/types';

vi.mock('../../../../src/tools/callout/emoji-picker/emoji-data', () => ({
  loadEmojiData: vi.fn().mockResolvedValue([]),
  searchEmojis: vi.fn().mockReturnValue([]),
  groupEmojisByCategory: vi.fn().mockReturnValue(new Map()),
  CURATED_CALLOUT_EMOJIS: [],
}));

const createMockAPI = (): API => ({
  styles: { block: 'ce-block', inlineToolbar: '', inlineToolButton: '', inlineToolButtonActive: '', settingsButton: '', settingsButtonActive: '', selected: '' },
  i18n: { t: (k: string) => k, has: vi.fn().mockReturnValue(false), getLocale: vi.fn().mockReturnValue('en'), getEnglishTranslation: vi.fn().mockReturnValue('') },
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
  data: { emoji: '💡', textColor: null, backgroundColor: null, ...data } as CalloutData,
  config: {},
  api: createMockAPI(),
  readOnly: overrides.readOnly ?? false,
  block: { id: 'callout-block-id' } as never,
});

describe('CalloutTool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // JSDOM doesn't implement matchMedia — stub it for EmojiPicker theme detection
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      configurable: true,
      value: vi.fn().mockReturnValue({ matches: false }),
    });
  });
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
    it('returns emoji, textColor, and backgroundColor', async () => {
      const { CalloutTool } = await import('../../../../src/tools/callout');
      const tool = new CalloutTool(createOptions({ emoji: '✅', textColor: 'green', backgroundColor: 'green' }));
      tool.render();
      const saved = tool.save();
      expect(saved).toEqual({ emoji: '✅', textColor: 'green', backgroundColor: 'green' });
    });

    it('returns null colors for defaults', async () => {
      const { CalloutTool } = await import('../../../../src/tools/callout');
      const tool = new CalloutTool(createOptions());
      tool.render();
      const saved = tool.save();
      expect(saved).toEqual({ emoji: '💡', textColor: null, backgroundColor: null });
    });
  });

  describe('validate()', () => {
    it('always returns true', async () => {
      const { CalloutTool } = await import('../../../../src/tools/callout');
      const tool = new CalloutTool(createOptions());
      expect(tool.validate({ emoji: '', textColor: null, backgroundColor: null })).toBe(true);
      expect(tool.validate({ emoji: '💡', textColor: 'blue', backgroundColor: 'blue' })).toBe(true);
    });
  });

  describe('renderSettings()', () => {
    it('returns an array of two items', async () => {
      const { CalloutTool } = await import('../../../../src/tools/callout');
      const tool = new CalloutTool(createOptions());
      tool.render();
      const settings = tool.renderSettings();
      expect(Array.isArray(settings)).toBe(true);
      expect(settings).toHaveLength(2);
    });

    it('first item is the "Edit icon" button with smile icon and correct title', async () => {
      const { CalloutTool } = await import('../../../../src/tools/callout');
      const tool = new CalloutTool(createOptions());
      tool.render();
      const settings = tool.renderSettings() as Array<{ title: string; icon: string; name: string }>;
      expect(settings[0].title).toBe('tools.callout.editIcon');
      expect(settings[0].name).toBe('callout-edit-icon');
      const { IconEmojiSmile } = await import('../../../../src/components/icons');
      expect(settings[0].icon).toBe(IconEmojiSmile);
    });

    it('"Edit icon" button closes the settings popover on activate', async () => {
      const { CalloutTool } = await import('../../../../src/tools/callout');
      const tool = new CalloutTool(createOptions());
      tool.render();
      const settings = tool.renderSettings() as Array<{ closeOnActivate: boolean }>;
      expect(settings[0].closeOnActivate).toBe(true);
    });

    it('"Edit icon" onActivate opens the emoji picker', async () => {
      const { CalloutTool } = await import('../../../../src/tools/callout');
      const tool = new CalloutTool(createOptions());
      tool.render();
      const settings = tool.renderSettings() as Array<{ onActivate: () => void }>;

      settings[0].onActivate();

      // The emoji picker element should have been appended to document.body
      const pickerEl = document.body.querySelector('[data-blok-emoji-picker]');
      expect(pickerEl).not.toBeNull();
    });

    it('second item is the color picker with paint roller icon and name', async () => {
      const { CalloutTool } = await import('../../../../src/tools/callout');
      const tool = new CalloutTool(createOptions());
      tool.render();
      const settings = tool.renderSettings() as Array<{ title: string; icon: string; name: string }>;
      expect(settings[1].title).toBe('tools.callout.color');
      expect(settings[1].name).toBe('callout-color');
      const { IconPaintRoller } = await import('../../../../src/components/icons');
      expect(settings[1].icon).toBe(IconPaintRoller);
    });

    it('color picker children contain a single Html item with the shared color picker', async () => {
      const { CalloutTool } = await import('../../../../src/tools/callout');
      const tool = new CalloutTool(createOptions());
      tool.render();
      const settings = tool.renderSettings() as Array<{
        children: { items: Array<{ type: PopoverItemType; element: HTMLElement }> };
      }>;
      expect(settings[1].children.items).toHaveLength(1);
      expect(settings[1].children.items[0].type).toBe(PopoverItemType.Html);
      expect(settings[1].children.items[0].element.getAttribute('data-blok-testid')).toBe('callout-color-picker');
    });

    it('color picker shows chevron on children (submenu arrow)', async () => {
      const { CalloutTool } = await import('../../../../src/tools/callout');
      const tool = new CalloutTool(createOptions());
      tool.render();
      const settings = tool.renderSettings() as Array<{ children: { hideChevron?: boolean } }>;
      expect(settings[1].children.hideChevron).toBeUndefined();
    });
  });

  describe('color change via picker', () => {
    it('clicking a background swatch applies backgroundColor to wrapper', async () => {
      const { CalloutTool } = await import('../../../../src/tools/callout');
      const tool = new CalloutTool(createOptions());
      const wrapper = tool.render();

      const settings = tool.renderSettings() as Array<{
        children: { items: Array<{ element: HTMLElement }> };
      }>;
      const pickerEl = settings[1].children.items[0].element;
      const blueBgSwatch = pickerEl.querySelector<HTMLButtonElement>(
        '[data-blok-testid="callout-color-swatch-background-color-blue"]'
      );

      blueBgSwatch!.click();

      expect(wrapper.style.backgroundColor).toBe('var(--blok-color-blue-bg)');
    });

    it('sets --blok-search-input-bg to color-mix variant when background color is applied', async () => {
      const { CalloutTool } = await import('../../../../src/tools/callout');
      const tool = new CalloutTool(createOptions());
      const wrapper = tool.render();

      const settings = tool.renderSettings() as Array<{
        children: { items: Array<{ element: HTMLElement }> };
      }>;
      const pickerEl = settings[1].children.items[0].element;

      pickerEl.querySelector<HTMLButtonElement>(
        '[data-blok-testid="callout-color-swatch-background-color-blue"]'
      )!.click();

      expect(wrapper.style.getPropertyValue('--blok-search-input-bg')).toBe('light-dark(color-mix(in srgb, var(--blok-color-blue-bg) 70%, white), color-mix(in srgb, var(--blok-color-blue-bg) 85%, white))');
    });

    it('removes --blok-search-input-bg when background color is cleared', async () => {
      const { CalloutTool } = await import('../../../../src/tools/callout');
      const tool = new CalloutTool(createOptions({ backgroundColor: 'blue' }));
      const wrapper = tool.render();

      expect(wrapper.style.getPropertyValue('--blok-search-input-bg')).toBe('light-dark(color-mix(in srgb, var(--blok-color-blue-bg) 70%, white), color-mix(in srgb, var(--blok-color-blue-bg) 85%, white))');

      const settings = tool.renderSettings() as Array<{
        children: { items: Array<{ element: HTMLElement }> };
      }>;
      const pickerEl = settings[1].children.items[0].element;

      pickerEl.querySelector<HTMLButtonElement>(
        '[data-blok-testid="callout-color-swatch-background-color-default"]'
      )!.click();

      expect(wrapper.style.getPropertyValue('--blok-search-input-bg')).toBe('');
    });

    it('clicking a text swatch applies text color to wrapper', async () => {
      const { CalloutTool } = await import('../../../../src/tools/callout');
      const tool = new CalloutTool(createOptions());
      const wrapper = tool.render();

      const settings = tool.renderSettings() as Array<{
        children: { items: Array<{ element: HTMLElement }> };
      }>;
      const pickerEl = settings[1].children.items[0].element;
      const blueTextSwatch = pickerEl.querySelector<HTMLButtonElement>(
        '[data-blok-testid="callout-color-swatch-color-blue"]'
      );

      blueTextSwatch!.click();

      expect(wrapper.style.color).toBe('var(--blok-color-blue-text)');
    });

    it('clicking default background swatch removes bg and adds border', async () => {
      const { CalloutTool } = await import('../../../../src/tools/callout');
      const tool = new CalloutTool(createOptions({ backgroundColor: 'blue' }));
      const wrapper = tool.render();

      const settings = tool.renderSettings() as Array<{
        children: { items: Array<{ element: HTMLElement }> };
      }>;
      const pickerEl = settings[1].children.items[0].element;
      const defaultBgSwatch = pickerEl.querySelector<HTMLButtonElement>(
        '[data-blok-testid="callout-color-swatch-background-color-default"]'
      );

      defaultBgSwatch!.click();

      expect(wrapper.style.backgroundColor).toBe('');
      expect(wrapper.style.border).toContain('var(--blok-callout-default-border');
    });

    it('save reflects picker selections', async () => {
      const { CalloutTool } = await import('../../../../src/tools/callout');
      const tool = new CalloutTool(createOptions());
      tool.render();

      const settings = tool.renderSettings() as Array<{
        children: { items: Array<{ element: HTMLElement }> };
      }>;
      const pickerEl = settings[1].children.items[0].element;

      pickerEl.querySelector<HTMLButtonElement>(
        '[data-blok-testid="callout-color-swatch-color-blue"]'
      )!.click();
      pickerEl.querySelector<HTMLButtonElement>(
        '[data-blok-testid="callout-color-swatch-background-color-green"]'
      )!.click();

      const saved = tool.save();
      expect(saved.textColor).toBe('blue');
      expect(saved.backgroundColor).toBe('green');
    });
  });

  describe('normalizeData handles legacy fields', () => {
    it('maps variant to backgroundColor when no backgroundColor present', async () => {
      const { CalloutTool } = await import('../../../../src/tools/callout/index');
      const options = createOptions({
        variant: 'note',
        backgroundColor: undefined,
      } as unknown as Partial<CalloutData>);

      const tool = new CalloutTool(options);
      const saved = tool.save();

      expect(saved.backgroundColor).toBe('blue');
    });

    it('maps isEmojiVisible false to empty emoji', async () => {
      const { CalloutTool } = await import('../../../../src/tools/callout/index');
      const options = createOptions({
        isEmojiVisible: false,
        emoji: '💡',
      } as unknown as Partial<CalloutData>);

      const tool = new CalloutTool(options);
      const saved = tool.save();

      expect(saved.emoji).toBe('');
    });

    it('maps isEmojiVisible true with null emoji to default emoji', async () => {
      const { CalloutTool } = await import('../../../../src/tools/callout/index');
      const options = createOptions({
        isEmojiVisible: true,
        emoji: null,
      } as unknown as Partial<CalloutData>);

      const tool = new CalloutTool(options);
      const saved = tool.save();

      expect(saved.emoji).toBe('💡');
    });

    it('preserves new-format data when no legacy fields present', async () => {
      const { CalloutTool } = await import('../../../../src/tools/callout/index');
      const options = createOptions({
        emoji: '🔥',
        textColor: 'red',
        backgroundColor: 'blue',
      });

      const tool = new CalloutTool(options);
      const saved = tool.save();

      expect(saved.emoji).toBe('🔥');
      expect(saved.textColor).toBe('red');
      expect(saved.backgroundColor).toBe('blue');
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

    it('conversionConfig imports with default emoji and null colors', async () => {
      const { CalloutTool } = await import('../../../../src/tools/callout');
      const cfg = CalloutTool.conversionConfig;
      const imported = (cfg.import as (text: string) => CalloutData)('hello');
      expect(imported).toEqual({ emoji: '💡', textColor: null, backgroundColor: null });
    });
  });
});
