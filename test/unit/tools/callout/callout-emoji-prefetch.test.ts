// test/unit/tools/callout/callout-emoji-prefetch.test.ts

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { API, BlockToolConstructorOptions } from '../../../../types';
import type { CalloutData, CalloutConfig } from '../../../../src/tools/callout/types';

const mockLoadEmojiData = vi.fn();

vi.mock('../../../../src/components/utils/emoji/emoji-data', () => ({
  loadEmojiData: (...args: unknown[]): unknown => mockLoadEmojiData(...args),
  searchEmojis: vi.fn().mockReturnValue([]),
  groupEmojisByCategory: vi.fn().mockReturnValue(new Map()),
  CURATED_CALLOUT_EMOJIS: [],
}));

vi.mock('../../../../src/components/utils/emoji/emoji-locale', () => ({
  loadEmojiLocale: vi.fn().mockResolvedValue(null),
  getTranslatedName: vi.fn().mockReturnValue(null),
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
  overrides: { readOnly?: boolean; config?: CalloutConfig } = {}
): BlockToolConstructorOptions<CalloutData, CalloutConfig> => ({
  data: { emoji: '💡', textColor: null, backgroundColor: null },
  config: overrides.config ?? {},
  api: createMockAPI(),
  readOnly: overrides.readOnly ?? false,
  block: { id: 'callout-block-id' } as never,
});

/** Runs any idle work the tool scheduled, whichever primitive it used. */
async function flushIdle(): Promise<void> {
  for (let i = 0; i < 5; i++) {
    await new Promise(resolve => setTimeout(resolve, 1));
  }
}

describe('CalloutTool emoji data prefetch', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockLoadEmojiData.mockResolvedValue([]);
  });

  afterEach(async () => {
    // Every render schedules a warm-up; let it land here, not in the next test.
    await flushIdle();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('warms the emoji dataset when the pointer reaches the emoji button', async () => {
    const { CalloutTool } = await import('../../../../src/tools/callout');
    const tool = new CalloutTool(createOptions());
    const wrapper = tool.render();
    const button = wrapper.querySelector('button');

    expect(button).not.toBeNull();
    expect(mockLoadEmojiData).not.toHaveBeenCalled();

    button?.dispatchEvent(new Event('pointerenter'));

    expect(mockLoadEmojiData).toHaveBeenCalled();
  });

  describe.each([
    { env: 'with requestIdleCallback', stubIdle: false },
    { env: 'without requestIdleCallback (Safari)', stubIdle: true },
  ])('$env', ({ stubIdle }) => {
    beforeEach(() => {
      if (stubIdle) {
        vi.stubGlobal('requestIdleCallback', undefined);
      }
    });

    it('warms the emoji dataset once an editable callout renders, with no interaction', async () => {
      const { CalloutTool } = await import('../../../../src/tools/callout');
      const tool = new CalloutTool(createOptions());

      tool.render();

      expect(mockLoadEmojiData).not.toHaveBeenCalled();

      await flushIdle();

      expect(mockLoadEmojiData).toHaveBeenCalledTimes(1);
    });

    it('drops the scheduled warm-up when the callout turns read-only first', async () => {
      const { CalloutTool } = await import('../../../../src/tools/callout');
      const tool = new CalloutTool(createOptions());

      tool.render();
      tool.setReadOnly(true);
      await flushIdle();

      expect(mockLoadEmojiData).not.toHaveBeenCalled();
    });
  });

  it('bounds the idle wait with a timeout so a busy main thread still warms', async () => {
    const requestIdle = vi.fn();

    vi.stubGlobal('requestIdleCallback', requestIdle);

    const { CalloutTool } = await import('../../../../src/tools/callout');
    const tool = new CalloutTool(createOptions());

    tool.render();

    expect(requestIdle).toHaveBeenCalledTimes(1);
    expect(requestIdle.mock.calls[0]?.[1]).toEqual({ timeout: 2000 });
  });

  it('never warms in read-only mode — the picker cannot be opened there', async () => {
    const { CalloutTool } = await import('../../../../src/tools/callout');
    const tool = new CalloutTool(createOptions({ readOnly: true }));

    tool.render();
    await flushIdle();

    expect(mockLoadEmojiData).not.toHaveBeenCalled();
  });

  it('never warms when the host supplies its own emoji picker', async () => {
    const { CalloutTool } = await import('../../../../src/tools/callout');
    const tool = new CalloutTool(createOptions({ config: { emojiPicker: vi.fn() } }));
    const wrapper = tool.render();

    await flushIdle();
    wrapper.querySelector('button')?.dispatchEvent(new Event('pointerenter'));

    expect(mockLoadEmojiData).not.toHaveBeenCalled();
  });
});
