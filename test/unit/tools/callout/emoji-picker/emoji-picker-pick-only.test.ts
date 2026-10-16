// A feed card's reaction picker (research/19 §2c): search, skin tone, grid and
// category bar, with no Random, no Remove and no curated Callout section.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../../../src/components/utils/tooltip', () => ({
  onHover: vi.fn(),
  hide: vi.fn(),
}));

vi.mock('../../../../../src/components/utils/emoji/emoji-locale', () => ({
  loadEmojiLocale: vi.fn().mockResolvedValue(null),
  getTranslatedName: vi.fn().mockReturnValue(null),
}));

const MOCK_EMOJI_MART_DATA = {
  default: {
    categories: [{ id: 'objects', emojis: ['bulb'] }],
    emojis: {
      bulb: { id: 'bulb', name: 'Light Bulb', keywords: ['light', 'idea'], skins: [{ native: '💡', unified: '1f4a1' }], version: 1 },
    },
    aliases: {},
  },
};

vi.mock('../../../../../src/components/utils/emoji/emoji-grid.json', async () => (await import('../../../components/utils/emoji/emoji-data.fixture')).emojiGridModule(MOCK_EMOJI_MART_DATA.default));
vi.mock('../../../../../src/components/utils/emoji/emoji-keywords.json', async () => (await import('../../../components/utils/emoji/emoji-data.fixture')).emojiKeywordsModule(MOCK_EMOJI_MART_DATA.default));

describe('EmojiPicker — pick only', () => {
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
    document.body.innerHTML = '';
    document.documentElement.style.overflow = '';
  });

  const openPicker = async (options: { pickOnly?: boolean; label?: string }): Promise<HTMLElement> => {
    const { EmojiPicker } = await import('../../../../../src/tools/callout/emoji-picker');
    const picker = new EmojiPicker({ onSelect: vi.fn(), onRemove: vi.fn(), i18n: { t: (key: string) => key }, locale: 'en', curated: false, ...options });
    const anchor = document.createElement('button');

    document.body.append(anchor, picker.getElement());
    await picker.open(anchor);

    return picker.getElement();
  };

  it('has no Random or Remove button, and names the dialog by its purpose', async () => {
    const el = await openPicker({ pickOnly: true, label: 'Add reaction' });

    expect(el.querySelector('[data-emoji-picker-random]')).toBeNull();
    expect(el.querySelector('[data-emoji-picker-remove]')).toBeNull();
    expect(el.getAttribute('aria-label')).toBe('Add reaction');
    expect(el.querySelector('input[type="text"]')?.getAttribute('placeholder')).toBe('tools.callout.filterEmojis');
    expect(el.querySelector('[data-emoji-section="callout"]')).toBeNull();
    expect(el.querySelector('[data-emoji-section="objects"]')).not.toBeNull();
  });

  it('keeps Random, Remove and the Edit icon name by default', async () => {
    const el = await openPicker({});

    expect(el.querySelector('[data-emoji-picker-random]')).not.toBeNull();
    expect(el.querySelector('[data-emoji-picker-remove]')).not.toBeNull();
    expect(el.getAttribute('aria-label')).toBe('tools.callout.editIcon');
  });
});
