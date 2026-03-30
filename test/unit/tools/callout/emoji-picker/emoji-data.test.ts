// test/unit/tools/callout/emoji-picker/emoji-data.test.ts

import { describe, it, expect, vi, beforeEach } from 'vitest';

const MOCK_EMOJI_MART_DATA = {
  default: {
    categories: [
      { id: 'people', emojis: ['grinning', 'smile'] },
      { id: 'objects', emojis: ['bulb', 'key'] },
    ],
    emojis: {
      grinning: { id: 'grinning', name: 'Grinning Face', keywords: ['face', 'happy'], skins: [{ native: '😀', unified: '1f600' }], version: 1 },
      smile:    { id: 'smile',    name: 'Smiling Face',  keywords: ['face', 'smile'], skins: [{ native: '😊', unified: '1f60a' }], version: 1 },
      bulb:     { id: 'bulb',     name: 'Light Bulb',    keywords: ['light', 'idea'], skins: [{ native: '💡', unified: '1f4a1' }], version: 1 },
      key:      { id: 'key',      name: 'Key',           keywords: ['lock', 'password'], skins: [{ native: '🔑', unified: '1f511' }], version: 1 },
    },
    aliases: {},
  },
};

vi.mock('@emoji-mart/data', () => MOCK_EMOJI_MART_DATA);

describe('emoji-data', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it('loadEmojiData returns processed emojis with native char, id, name, keywords, category', async () => {
    const { loadEmojiData } = await import('../../../../../src/tools/callout/emoji-picker/emoji-data');
    const emojis = await loadEmojiData();

    expect(emojis).toHaveLength(4);
    expect(emojis[0]).toMatchObject({
      native: '😀',
      id: 'grinning',
      name: 'Grinning Face',
      keywords: ['face', 'happy'],
      category: 'people',
    });
  });

  it('loadEmojiData caches result on second call', async () => {
    const { loadEmojiData } = await import('../../../../../src/tools/callout/emoji-picker/emoji-data');
    const first = await loadEmojiData();
    const second = await loadEmojiData();

    expect(first).toBe(second);
  });

  it('searchEmojis filters by name', async () => {
    const { loadEmojiData, searchEmojis } = await import('../../../../../src/tools/callout/emoji-picker/emoji-data');
    const emojis = await loadEmojiData();
    const results = searchEmojis(emojis, 'light');

    expect(results).toHaveLength(1);
    expect(results[0].native).toBe('💡');
  });

  it('searchEmojis filters by keyword', async () => {
    const { loadEmojiData, searchEmojis } = await import('../../../../../src/tools/callout/emoji-picker/emoji-data');
    const emojis = await loadEmojiData();
    const results = searchEmojis(emojis, 'idea');

    expect(results).toHaveLength(1);
    expect(results[0].id).toBe('bulb');
  });

  it('searchEmojis is case-insensitive', async () => {
    const { loadEmojiData, searchEmojis } = await import('../../../../../src/tools/callout/emoji-picker/emoji-data');
    const emojis = await loadEmojiData();
    const results = searchEmojis(emojis, 'HAPPY');

    expect(results).toHaveLength(1);
    expect(results[0].id).toBe('grinning');
  });

  it('searchEmojis returns empty array for no match', async () => {
    const { loadEmojiData, searchEmojis } = await import('../../../../../src/tools/callout/emoji-picker/emoji-data');
    const emojis = await loadEmojiData();
    const results = searchEmojis(emojis, 'zzznomatch');

    expect(results).toHaveLength(0);
  });

  it('searchEmojis matches against translated names when locale data is provided', async () => {
    const { loadEmojiData, searchEmojis } = await import('../../../../../src/tools/callout/emoji-picker/emoji-data');
    const emojis = await loadEmojiData();
    const localeData = {
      '💡': { n: 'ampoule', k: ['idée', 'lumière'] },
    };
    const results = searchEmojis(emojis, 'ampoule', localeData);

    expect(results).toHaveLength(1);
    expect(results[0].native).toBe('💡');
  });

  it('searchEmojis matches against translated keywords when locale data is provided', async () => {
    const { loadEmojiData, searchEmojis } = await import('../../../../../src/tools/callout/emoji-picker/emoji-data');
    const emojis = await loadEmojiData();
    const localeData = {
      '💡': { n: 'ampoule', k: ['idée', 'lumière'] },
    };
    const results = searchEmojis(emojis, 'idée', localeData);

    expect(results).toHaveLength(1);
    expect(results[0].native).toBe('💡');
  });

  it('searchEmojis still matches English names when locale data is provided', async () => {
    const { loadEmojiData, searchEmojis } = await import('../../../../../src/tools/callout/emoji-picker/emoji-data');
    const emojis = await loadEmojiData();
    const localeData = {
      '💡': { n: 'ampoule', k: ['idée'] },
    };
    const results = searchEmojis(emojis, 'light', localeData);

    expect(results).toHaveLength(1);
    expect(results[0].native).toBe('💡');
  });

  it('searchEmojis works without locale data (backward compatible)', async () => {
    const { loadEmojiData, searchEmojis } = await import('../../../../../src/tools/callout/emoji-picker/emoji-data');
    const emojis = await loadEmojiData();
    const results = searchEmojis(emojis, 'light');

    expect(results).toHaveLength(1);
    expect(results[0].native).toBe('💡');
  });

  it('CURATED_CALLOUT_EMOJIS contains 💡 and has ~20 entries', async () => {
    const { CURATED_CALLOUT_EMOJIS } = await import('../../../../../src/tools/callout/emoji-picker/emoji-data');

    expect(CURATED_CALLOUT_EMOJIS).toContain('💡');
    expect(CURATED_CALLOUT_EMOJIS.length).toBeGreaterThanOrEqual(15);
    expect(CURATED_CALLOUT_EMOJIS.length).toBeLessThanOrEqual(25);
  });
});
