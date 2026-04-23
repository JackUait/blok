// test/unit/tools/callout/callout-paste.test.ts

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { API, BlockToolConstructorOptions, HTMLPasteEvent } from '../../../../types';
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

describe('CalloutTool — paste support', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      configurable: true,
      value: vi.fn().mockReturnValue({ matches: false }),
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('pasteConfig', () => {
    it('includes ASIDE tag with style attribute', async () => {
      const { CalloutTool } = await import('../../../../src/tools/callout');

      const config = CalloutTool.pasteConfig;

      expect(config).toBeDefined();
      expect(config).not.toBe(false);
      expect((config as { tags: unknown[] }).tags).toEqual(
        expect.arrayContaining([{ ASIDE: { style: true } }])
      );
    });
  });

  describe('onPaste()', () => {
    it('extracts background-color and maps to nearest preset name', async () => {
      const { CalloutTool } = await import('../../../../src/tools/callout');
      const tool = new CalloutTool(createOptions({ backgroundColor: null }));
      tool.render();

      const aside = document.createElement('aside');
      // rgb(242, 240, 240) is close to gray bg preset (#f1f1ef)
      aside.setAttribute('style', 'background-color: rgb(242, 240, 240);');

      const event = { detail: { data: aside } } as unknown as HTMLPasteEvent;
      tool.onPaste(event);

      const saved = tool.save();

      expect(saved.backgroundColor).toBe('gray');
    });

    it('extracts background shorthand and maps to nearest preset name', async () => {
      const { CalloutTool } = await import('../../../../src/tools/callout');
      const tool = new CalloutTool(createOptions({ backgroundColor: null }));
      tool.render();

      const aside = document.createElement('aside');
      // rgb(253, 235, 236) is close to red bg preset (#fdebec)
      aside.setAttribute('style', 'background: rgb(253, 235, 236);');

      const event = { detail: { data: aside } } as unknown as HTMLPasteEvent;
      tool.onPaste(event);

      const saved = tool.save();

      expect(saved.backgroundColor).toBe('red');
    });

    it('handles aside without style gracefully — backgroundColor stays null', async () => {
      const { CalloutTool } = await import('../../../../src/tools/callout');
      const tool = new CalloutTool(createOptions({ backgroundColor: null }));
      tool.render();

      const aside = document.createElement('aside');

      const event = { detail: { data: aside } } as unknown as HTMLPasteEvent;
      tool.onPaste(event);

      const saved = tool.save();

      expect(saved.backgroundColor).toBeNull();
    });

    it('handles aside with non-background style — backgroundColor stays null', async () => {
      const { CalloutTool } = await import('../../../../src/tools/callout');
      const tool = new CalloutTool(createOptions({ backgroundColor: null }));
      tool.render();

      const aside = document.createElement('aside');
      aside.setAttribute('style', 'color: red; font-size: 14px;');

      const event = { detail: { data: aside } } as unknown as HTMLPasteEvent;
      tool.onPaste(event);

      const saved = tool.save();

      expect(saved.backgroundColor).toBeNull();
    });

    it('REGRESSION: white page background must NOT collapse onto gray preset', async () => {
      const { CalloutTool } = await import('../../../../src/tools/callout');
      const tool = new CalloutTool(createOptions({ backgroundColor: null }));
      tool.render();

      const aside = document.createElement('aside');
      // rgb(255, 255, 255) is the resolved page bg copied by the browser when
      // pasting from a contenteditable. It must be filtered, not mapped to gray.
      aside.setAttribute('style', 'background-color: rgb(255, 255, 255);');

      const event = { detail: { data: aside } } as unknown as HTMLPasteEvent;
      tool.onPaste(event);

      const saved = tool.save();

      expect(saved.backgroundColor).toBeNull();
    });

    it('REGRESSION: dark page background must NOT collapse onto gray preset', async () => {
      const { CalloutTool } = await import('../../../../src/tools/callout');
      const tool = new CalloutTool(createOptions({ backgroundColor: null }));
      tool.render();

      const aside = document.createElement('aside');
      // rgb(25, 25, 24) is Blok's dark page bg (#191918) copied by the browser
      // in dark mode. It must be filtered, not mapped to gray.
      aside.setAttribute('style', 'background-color: rgb(25, 25, 24);');

      const event = { detail: { data: aside } } as unknown as HTMLPasteEvent;
      tool.onPaste(event);

      const saved = tool.save();

      expect(saved.backgroundColor).toBeNull();
    });
  });
});
