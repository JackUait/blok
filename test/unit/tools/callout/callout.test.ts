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
    insertInsideParent: vi.fn().mockReturnValue({ id: 'child-id' }),
    convert: vi.fn(),
    getBlockIndex: vi.fn().mockReturnValue(0),
    getChildren: vi.fn().mockReturnValue([]),
    update: vi.fn(),
  },
  caret: { setToBlock: vi.fn(), isAtStart: vi.fn().mockReturnValue(false) },
  toolbar: { toggleBlockSettings: vi.fn() },
} as unknown as API);

const createOptions = (
  data: Partial<CalloutData> = {},
  overrides: { readOnly?: boolean } = {}
): BlockToolConstructorOptions<CalloutData, CalloutConfig> => ({
  data: { text: '', emoji: '💡', color: 'default', ...data } as CalloutData,
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

    it('contains a button for the emoji', async () => {
      const { CalloutTool } = await import('../../../../src/tools/callout');
      const tool = new CalloutTool(createOptions({ emoji: '💡' }));
      const el = tool.render();
      const btn = el.querySelector('button');
      expect(btn).not.toBeNull();
      expect(btn!.textContent).toBe('💡');
    });

    it('contains a contentEditable div for text', async () => {
      const { CalloutTool } = await import('../../../../src/tools/callout');
      const tool = new CalloutTool(createOptions({ text: '<b>hi</b>' }));
      const el = tool.render();
      const editable = el.querySelector('[contenteditable="true"]');
      expect(editable).not.toBeNull();
      expect(editable!.innerHTML).toBe('<b>hi</b>');
    });

    it('emoji button inherits line-height from header for first-line alignment', async () => {
      const { CalloutTool } = await import('../../../../src/tools/callout');
      const tool = new CalloutTool(createOptions());
      const el = tool.render();
      const header = el.firstElementChild!;
      const btn = el.querySelector('button')!;

      // Header sets an absolute line-height (1.5em) so the emoji inherits the
      // same computed value as the text, regardless of the emoji's larger font-size.
      expect(header.className).toContain('leading-[1.5em]');
      // Emoji button must NOT have its own leading-* class that would override inheritance
      expect(btn.className).not.toMatch(/leading-/);
    });

    it('text element has block-level vertical padding matching paragraph blocks', async () => {
      const { CalloutTool } = await import('../../../../src/tools/callout');
      const tool = new CalloutTool(createOptions());
      const el = tool.render();
      const textEl = el.querySelector('[contenteditable="true"]')!;

      expect(textEl.className).toContain('py-[7px]');
    });

    it('emoji button has matching vertical padding for alignment with text', async () => {
      const { CalloutTool } = await import('../../../../src/tools/callout');
      const tool = new CalloutTool(createOptions());
      const el = tool.render();
      const btn = el.querySelector('button')!;

      expect(btn.className).toContain('py-[7px]');
    });

    it('wrapper has reduced vertical padding that complements block padding', async () => {
      const { CalloutTool } = await import('../../../../src/tools/callout');
      const tool = new CalloutTool(createOptions());
      const el = tool.render();

      // Wrapper provides inner spacing between border/background and content,
      // complementing each block's own py-[7px] (5 + 7 = 12px total)
      expect(el.className).toContain('py-[5px]');
      expect(el.className).not.toMatch(/\bgap-/);
    });

    it('child container is hidden when empty to avoid extra bottom spacing', async () => {
      const { CalloutTool } = await import('../../../../src/tools/callout');
      const tool = new CalloutTool(createOptions());
      const el = tool.render();
      const childContainer = el.querySelector('[data-blok-toggle-children]');
      expect(childContainer).not.toBeNull();
      expect(childContainer!.className).toContain('empty:hidden');
    });
  });

  describe('save()', () => {
    it('returns CalloutData with text, emoji, and color', async () => {
      const { CalloutTool } = await import('../../../../src/tools/callout');
      const tool = new CalloutTool(createOptions({ text: 'hello', emoji: '✅', color: 'green' }));
      tool.render();
      const saved = tool.save();
      expect(saved).toMatchObject({ text: 'hello', emoji: '✅', color: 'green' });
    });
  });

  describe('validate()', () => {
    it('always returns true', async () => {
      const { CalloutTool } = await import('../../../../src/tools/callout');
      const tool = new CalloutTool(createOptions());
      expect(tool.validate({ text: '', emoji: '', color: 'default' })).toBe(true);
      expect(tool.validate({ text: 'hello', emoji: '💡', color: 'blue' })).toBe(true);
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
      const settings = tool.renderSettings() as Array<{ isActive: boolean; title: string }>;
      const activeItems = settings.filter(s => s.isActive);
      expect(activeItems).toHaveLength(1);
    });
  });

  describe('color change', () => {
    it('applying a color sets backgroundColor on the wrapper', async () => {
      const { CalloutTool } = await import('../../../../src/tools/callout');
      const tool = new CalloutTool(createOptions({ color: 'default' }));
      const wrapper = tool.render();

      // Activate blue color setting
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

    it('renders with a border when initial color is default', async () => {
      const { CalloutTool } = await import('../../../../src/tools/callout');
      const tool = new CalloutTool(createOptions({ color: 'default' }));
      const wrapper = tool.render();

      expect(wrapper.style.border).toBe('1px solid var(--blok-callout-default-border, #e5e7eb)');
    });

    it('removes the border when switching from default to a color', async () => {
      const { CalloutTool } = await import('../../../../src/tools/callout');
      const tool = new CalloutTool(createOptions({ color: 'default' }));
      const wrapper = tool.render();

      expect(wrapper.style.border).toBe('1px solid var(--blok-callout-default-border, #e5e7eb)');

      const settings = tool.renderSettings() as Array<{ title: string; onActivate: () => void }>;
      const blueItem = settings.find(s => s.title.includes('tools.callout.colorBlue'));
      blueItem?.onActivate();

      expect(wrapper.style.border).toBe('');
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

    it('sanitize has a text property', async () => {
      const { CalloutTool } = await import('../../../../src/tools/callout');
      expect(CalloutTool.sanitize).toHaveProperty('text');
    });

    it('conversionConfig exports data.text', async () => {
      const { CalloutTool } = await import('../../../../src/tools/callout');
      const cfg = CalloutTool.conversionConfig;
      const exported = (cfg.export as (data: CalloutData) => string)({ text: 'hi', emoji: '💡', color: 'default' });
      expect(exported).toBe('hi');
    });

    it('conversionConfig imports text with default emoji and color', async () => {
      const { CalloutTool } = await import('../../../../src/tools/callout');
      const cfg = CalloutTool.conversionConfig;
      const imported = (cfg.import as (text: string) => CalloutData)('hello');
      expect(imported).toMatchObject({ text: 'hello', emoji: '💡', color: 'default' });
    });
  });
});
