import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { EmojiTrigger } from '../../../../../../src/components/modules/blockEvents/composers/emojiTrigger';
import type * as EmojiData from '../../../../../../src/components/utils/emoji/emoji-data';
import { createBlock, createBlokModules, setCaret } from './emojiTrigger.fixture';

const MOCK_EMOJI_MART_DATA = {
  default: {
    categories: [{ id: 'people', emojis: ['fire'] }],
    emojis: {
      fire: { id: 'fire', name: 'Fire', keywords: ['hot'], skins: [{ native: '🔥', unified: '1f525' }], version: 1 },
    },
    aliases: {},
  },
};

vi.mock('../../../../../../src/components/utils/emoji/emoji-grid.json', async () => (await import('../../../utils/emoji/emoji-data.fixture')).emojiGridModule(MOCK_EMOJI_MART_DATA.default));
vi.mock('../../../../../../src/components/utils/emoji/emoji-keywords.json', async () => (await import('../../../utils/emoji/emoji-data.fixture')).emojiKeywordsModule(MOCK_EMOJI_MART_DATA.default));

/** Holds the picker's chunk back, or fails it. */
const chunk = vi.hoisted(() => ({
  gate: Promise.resolve(),
  release: (): void => undefined,
  fail: false,
}));

const data = vi.hoisted(() => ({ loads: 0 }));

const PICKER = '../../../../../../src/tools/callout/emoji-picker';
const EMOJI_DATA = '../../../../../../src/components/utils/emoji/emoji-data';

const pickerModule = async (): Promise<unknown> => {
  await chunk.gate;
  if (chunk.fail) {
    throw new Error('offline');
  }

  return {
    prefetchEmojiPickerData: vi.fn(),
    EmojiPicker: vi.fn(function emojiPickerMock() {
      return {
        open: vi.fn(async () => undefined),
        setQuery: vi.fn(),
        close: vi.fn(),
        getElement: () => document.createElement('div'),
        isOpen: () => true,
      };
    }),
  };
};

const createInputEvent = (): InputEvent => ({ inputType: 'insertText', data: 'i', isComposing: false } as InputEvent);

/** A fresh module graph, so each test loads the picker's chunk anew. */
const freshTrigger = async (): Promise<{ trigger: EmojiTrigger; block: ReturnType<typeof createBlock> }> => {
  vi.resetModules();
  vi.doMock(PICKER, pickerModule);
  vi.doMock(EMOJI_DATA, async (importOriginal: () => Promise<typeof EmojiData>) => {
    const real = await importOriginal();

    return {
      ...real,
      loadEmojiData: () => {
        data.loads += 1;

        return real.loadEmojiData();
      },
    };
  });
  const { EmojiTrigger: Trigger } = await import('../../../../../../src/components/modules/blockEvents/composers/emojiTrigger');
  const block = createBlock(':fi');

  document.body.appendChild(block.holder);
  setCaret(block, 3);

  return { trigger: new Trigger(createBlokModules(block)), block };
};

describe('EmojiTrigger loads the picker code on first use', () => {
  const triggers: EmojiTrigger[] = [];

  beforeEach(() => {
    vi.clearAllMocks();
    data.loads = 0;
    chunk.fail = false;
    chunk.gate = new Promise<void>((resolve) => {
      chunk.release = resolve;
    });
  });

  afterEach(() => {
    triggers.splice(0).forEach((trigger) => trigger.close());
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  it('loads the emoji data while the picker code loads, and opens once both land', async () => {
    const { trigger } = await freshTrigger();

    triggers.push(trigger);
    const handled = trigger.handleInput(createInputEvent());

    await vi.waitFor(() => expect(data.loads).toBeGreaterThan(0));
    expect(trigger.opened).toBe(false);
    chunk.release();

    await expect(handled).resolves.toBe(true);
    expect(trigger.opened).toBe(true);
  });

  it('a picker chunk that fails to load leaves the menu closed and throws nothing', async () => {
    chunk.fail = true;
    chunk.release();
    const { trigger } = await freshTrigger();

    triggers.push(trigger);

    await expect(trigger.handleInput(createInputEvent())).resolves.toBe(false);
    expect(trigger.opened).toBe(false);
  });
});
