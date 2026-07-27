// test/unit/tools/callout/callout-emoji-prefetch.test.ts

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { API, BlockToolConstructorOptions } from '../../../../types';
import type { CalloutData, CalloutConfig } from '../../../../src/tools/callout/types';

const mockLoadEmojiData = vi.fn();

vi.mock('../../../../src/tools/callout/emoji-picker/emoji-data', () => ({
  loadEmojiData: (...args: unknown[]): unknown => mockLoadEmojiData(...args),
  searchEmojis: vi.fn().mockReturnValue([]),
  groupEmojisByCategory: vi.fn().mockReturnValue(new Map()),
  CURATED_CALLOUT_EMOJIS: [],
}));

vi.mock('../../../../src/tools/callout/emoji-picker/emoji-locale', () => ({
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

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('warms the emoji dataset when the pointer reaches the emoji button', async () => {
    const { CalloutTool } = await import('../../../../src/tools/callout');
    const tool = new CalloutTool(createOptions());
    const wrapper = tool.render();
    const button = wrapper.querySelector('button');

    expect(button).not.toBeNull();
    expect(mockLoadEmojiData).not.toHaveBeenCalled();

    button!.dispatchEvent(new Event('pointerenter'));

    expect(mockLoadEmojiData).toHaveBeenCalled();
  });

  it('warms the emoji dataset once the user starts editing the callout', async () => {
    const { CalloutTool } = await import('../../../../src/tools/callout');
    const tool = new CalloutTool(createOptions());
    const wrapper = tool.render();

    document.body.appendChild(wrapper);

    expect(mockLoadEmojiData).not.toHaveBeenCalled();

    wrapper.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
    await flushIdle();

    expect(mockLoadEmojiData).toHaveBeenCalled();

    wrapper.remove();
  });

  it('never warms in read-only mode — the picker cannot be opened there', async () => {
    const { CalloutTool } = await import('../../../../src/tools/callout');
    const tool = new CalloutTool(createOptions({ readOnly: true }));
    const wrapper = tool.render();

    document.body.appendChild(wrapper);
    wrapper.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
    await flushIdle();

    expect(mockLoadEmojiData).not.toHaveBeenCalled();

    wrapper.remove();
  });

  it('never warms when the host supplies its own emoji picker', async () => {
    const { CalloutTool } = await import('../../../../src/tools/callout');
    const tool = new CalloutTool(createOptions({ config: { emojiPicker: vi.fn() } }));
    const wrapper = tool.render();

    document.body.appendChild(wrapper);
    wrapper.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
    await flushIdle();

    const button = wrapper.querySelector('button');

    button?.dispatchEvent(new Event('pointerenter'));

    expect(mockLoadEmojiData).not.toHaveBeenCalled();

    wrapper.remove();
  });
});
