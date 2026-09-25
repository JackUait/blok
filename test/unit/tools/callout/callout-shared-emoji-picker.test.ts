import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { API, BlockToolConstructorOptions } from '../../../../types';
import type { CalloutData, CalloutConfig } from '../../../../src/tools/callout/types';
import type { CalloutTool } from '../../../../src/tools/callout';
import type { ProcessedEmoji } from '../../../../src/components/utils/emoji/emoji-data';

vi.mock('../../../../src/components/utils/emoji/emoji-data', () => ({
  loadEmojiData: vi.fn().mockResolvedValue([
    { native: '😀', skins: ['😀'], id: 'grinning', name: 'Grinning Face', keywords: ['happy'], category: 'people' },
    { native: '✅', skins: ['✅'], id: 'check', name: 'Check Mark', keywords: ['done'], category: 'symbols' },
  ] as ProcessedEmoji[]),
  searchEmojis: vi.fn().mockReturnValue([]),
  groupEmojisByCategory: vi.fn((emojis: ProcessedEmoji[]) => new Map([['people', emojis]])),
  CURATED_CALLOUT_EMOJIS: [],
}));

vi.mock('../../../../src/components/utils/emoji/emoji-locale', () => ({
  loadEmojiLocale: vi.fn().mockResolvedValue(null),
  getTranslatedName: vi.fn().mockReturnValue(null),
}));

const createMockAPI = (locale = 'en'): API => {
  const getLocale = vi.fn().mockReturnValue(locale);

  return {
    styles: { block: 'ce-block', inlineToolbar: '', inlineToolButton: '', inlineToolButtonActive: '', settingsButton: '', settingsButtonActive: '', selected: '' },
    i18n: { t: (k: string) => k, has: vi.fn().mockReturnValue(false), getLocale, getEnglishTranslation: vi.fn().mockReturnValue('') },
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
  } as unknown as API;
};

const createOptions = (api: API, emoji: string): BlockToolConstructorOptions<CalloutData, CalloutConfig> => ({
  data: { emoji, textColor: null, backgroundColor: null },
  config: {},
  api,
  readOnly: false,
  block: { id: `callout-${emoji}` } as never,
});

const pickers = (): HTMLElement[] => Array.from(document.body.querySelectorAll<HTMLElement>('[data-blok-emoji-picker]'));

const emojiButtonOf = (wrapper: HTMLElement): HTMLButtonElement => {
  const button = wrapper.querySelector<HTMLButtonElement>('[data-blok-testid="callout-emoji-btn"]');

  if (button === null) {
    throw new Error('callout emoji button not rendered');
  }

  return button;
};

/** Lets the picker's async open() finish. */
async function flush(): Promise<void> {
  for (let i = 0; i < 5; i++) {
    await new Promise(resolve => setTimeout(resolve, 1));
  }
}

async function renderCallout(api: API, emoji: string): Promise<{ tool: CalloutTool; button: HTMLButtonElement }> {
  const { CalloutTool: Tool } = await import('../../../../src/tools/callout');
  const tool = new Tool(createOptions(api, emoji));
  const wrapper = tool.render();

  document.body.appendChild(wrapper);

  return { tool, button: emojiButtonOf(wrapper) };
}

async function openFrom(button: HTMLButtonElement): Promise<void> {
  button.focus();
  button.click();
  await flush();
}

/** jsdom's selector engine misses astral-plane characters in attribute values, so match by reading them. */
function gridButtons(root: ParentNode, native: string): HTMLButtonElement[] {
  return Array.from(root.querySelectorAll<HTMLButtonElement>('[data-emoji-native]'))
    .filter(button => button.getAttribute('data-emoji-native') === native);
}

function pickEmoji(native: string): void {
  const [button] = pickers().flatMap(picker => gridButtons(picker, native));

  if (button === undefined) {
    throw new Error(`emoji ${native} not in the picker`);
  }

  button.click();
}

describe('CalloutTool shares one emoji picker per editor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      configurable: true,
      value: vi.fn().mockReturnValue({ matches: false }),
    });
  });

  afterEach(async () => {
    await flush();
    document.body.innerHTML = '';
    document.documentElement.style.overflow = '';
    vi.restoreAllMocks();
  });

  it('builds one picker for two callouts of the same editor', async () => {
    const api = createMockAPI();
    const a = await renderCallout(api, '💡');
    const b = await renderCallout(api, '🔥');

    await openFrom(a.button);
    pickEmoji('😀');
    await openFrom(b.button);

    expect(pickers()).toHaveLength(1);
    expect(gridButtons(document.body, '😀')).toHaveLength(1);
  });

  it('sends the picked emoji to the callout that opened the picker last', async () => {
    const api = createMockAPI();
    const a = await renderCallout(api, '💡');
    const b = await renderCallout(api, '🔥');

    await openFrom(a.button);
    pickEmoji('😀');
    await openFrom(b.button);
    pickEmoji('✅');

    expect(b.tool.save().emoji).toBe('✅');
    expect(a.tool.save().emoji).toBe('😀');
  });

  it('sends "remove" to the callout that opened the picker last', async () => {
    const api = createMockAPI();
    const a = await renderCallout(api, '💡');
    const b = await renderCallout(api, '🔥');

    await openFrom(a.button);
    pickEmoji('😀');
    await openFrom(b.button);
    pickers()[0]?.querySelector<HTMLButtonElement>('[data-emoji-picker-remove]')?.click();

    expect(b.tool.save().emoji).toBe('');
    expect(a.tool.save().emoji).toBe('😀');
  });

  it('gives each editor its own picker', async () => {
    const a = await renderCallout(createMockAPI(), '💡');
    const b = await renderCallout(createMockAPI(), '🔥');

    await openFrom(a.button);
    pickEmoji('😀');
    await openFrom(b.button);

    expect(pickers()).toHaveLength(2);
  });

  it('builds a new picker when the editor locale changed since the last one', async () => {
    const api = createMockAPI('en');
    const a = await renderCallout(api, '💡');

    await openFrom(a.button);
    pickEmoji('😀');

    const [first] = pickers();

    vi.mocked(api.i18n.getLocale).mockReturnValue('ru');

    const b = await renderCallout(api, '🔥');

    await openFrom(b.button);

    expect(pickers()[0]).not.toBe(first);

    const openPickers = pickers().filter(el => !el.hidden);

    expect(openPickers).toHaveLength(1);
    expect(pickers()).toHaveLength(1);
  });

  it('returns focus to the second callout when it opens over the first', async () => {
    const api = createMockAPI();
    const a = await renderCallout(api, '💡');
    const b = await renderCallout(api, '🔥');

    await openFrom(a.button);

    const settings = b.tool.renderSettings() as Array<{ onActivate: () => void }>;

    settings[0].onActivate();
    await flush();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

    expect(b.button).toHaveFocus();
  });

  it('keeps the picker while another callout of the editor is still alive', async () => {
    const api = createMockAPI();
    const a = await renderCallout(api, '💡');
    const b = await renderCallout(api, '🔥');

    await openFrom(a.button);
    pickEmoji('😀');
    await openFrom(b.button);
    pickEmoji('✅');
    a.tool.destroy();

    expect(pickers()).toHaveLength(1);
  });

  it('closes the picker when the callout it is open for is destroyed', async () => {
    const api = createMockAPI();
    const a = await renderCallout(api, '💡');
    const b = await renderCallout(api, '🔥');

    await openFrom(b.button);
    pickEmoji('😀');
    await openFrom(a.button);
    a.tool.destroy();

    expect(pickers().map(el => el.hidden)).toEqual([true]);
    expect(document.body.querySelector('[data-blok-emoji-picker-backdrop]')).toBeNull();
  });

  it('removes the picker from the page once every callout that used it is destroyed', async () => {
    const api = createMockAPI();
    const a = await renderCallout(api, '💡');
    const b = await renderCallout(api, '🔥');

    await openFrom(a.button);
    pickEmoji('😀');
    await openFrom(b.button);
    a.tool.destroy();
    b.tool.destroy();

    expect(pickers()).toHaveLength(0);
    expect(document.body.querySelector('[data-blok-emoji-picker-backdrop]')).toBeNull();
    expect(document.documentElement.style.overflow).toBe('');
  });
});
