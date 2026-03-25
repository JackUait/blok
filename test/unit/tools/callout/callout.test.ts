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

    it('applying default color removes inline styles', async () => {
      const { CalloutTool } = await import('../../../../src/tools/callout');
      const tool = new CalloutTool(createOptions({ color: 'blue' }));
      const wrapper = tool.render();

      const settings = tool.renderSettings() as Array<{ title: string; onActivate: () => void }>;
      const defaultItem = settings.find(s => s.title.includes('tools.callout.colorDefault'));
      defaultItem?.onActivate();

      expect(wrapper.style.backgroundColor).toBe('');
      expect(wrapper.style.color).toBe('');
    });
  });

  describe('static getters', () => {
    it('toolbox returns icon, title, titleKey', async () => {
      const { CalloutTool } = await import('../../../../src/tools/callout');
      const toolbox = CalloutTool.toolbox;
      expect(toolbox).toMatchObject({ title: 'Callout', titleKey: 'callout' });
      expect(typeof toolbox.icon).toBe('string');
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
