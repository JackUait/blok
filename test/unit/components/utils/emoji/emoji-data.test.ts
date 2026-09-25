// test/unit/components/utils/emoji/emoji-data.test.ts

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

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

const load = vi.hoisted(() => ({
  gridReads: 0,
  keywordReads: 0,
  failGrid: false,
  failKeywords: false,
  keywordsOverride: null as string[][] | null,
}));

vi.mock('../../../../../src/components/utils/emoji/emoji-grid.json', async () => {
  const { emojiGridModule } = await import('./emoji-data.fixture');
  const grid = emojiGridModule(MOCK_EMOJI_MART_DATA.default).default;

  return {
    get default() {
      load.gridReads++;

      if (load.failGrid) {
        load.failGrid = false;
        throw new Error('grid chunk failed');
      }

      return grid;
    },
  };
});

vi.mock('../../../../../src/components/utils/emoji/emoji-keywords.json', async () => {
  const { emojiKeywordsModule } = await import('./emoji-data.fixture');
  const keywords = emojiKeywordsModule(MOCK_EMOJI_MART_DATA.default).default;

  return {
    get default() {
      load.keywordReads++;

      if (load.failKeywords) {
        load.failKeywords = false;
        throw new Error('keywords chunk failed');
      }

      return load.keywordsOverride ?? keywords;
    },
  };
});

describe('emoji-data', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    load.gridReads = 0;
    load.keywordReads = 0;
    load.failGrid = false;
    load.failKeywords = false;
    load.keywordsOverride = null;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('loadEmojiData returns processed emojis with native char, id, name, keywords, category', async () => {
    const { loadEmojiData } = await import('../../../../../src/components/utils/emoji/emoji-data');
    const emojis = await loadEmojiData();

    expect(emojis).toHaveLength(4);
    expect(emojis[0]).toMatchObject({
      native: '😀',
      skins: ['😀'],
      id: 'grinning',
      name: 'Grinning Face',
      keywords: ['face', 'happy'],
      category: 'people',
    });
  });

  it('loadEmojiGrid resolves every emoji in category order with empty keywords, without loading keywords', async () => {
    const { loadEmojiGrid } = await import('../../../../../src/components/utils/emoji/emoji-data');
    const emojis = await loadEmojiGrid();

    expect(emojis.map(emoji => [emoji.id, emoji.category])).toEqual([
      ['grinning', 'people'],
      ['smile', 'people'],
      ['bulb', 'objects'],
      ['key', 'objects'],
    ]);
    expect(emojis.every(emoji => emoji.keywords.length === 0)).toBe(true);
    expect(load.keywordReads).toBe(0);
  });

  it('loadEmojiData fills keywords in place on the array loadEmojiGrid resolved', async () => {
    const { loadEmojiGrid, loadEmojiData } = await import('../../../../../src/components/utils/emoji/emoji-data');
    const grid = await loadEmojiGrid();
    const firstEmoji = grid[0];
    const full = await loadEmojiData();

    expect(full).toBe(grid);
    expect(full[0]).toBe(firstEmoji);
    expect(full.map(emoji => emoji.keywords)).toEqual([
      ['face', 'happy'],
      ['face', 'smile'],
      ['light', 'idea'],
      ['lock', 'password'],
    ]);
  });

  it('loadEmojiGrid after loadEmojiData resolves the same filled array', async () => {
    const { loadEmojiGrid, loadEmojiData } = await import('../../../../../src/components/utils/emoji/emoji-data');
    const full = await loadEmojiData();
    const grid = await loadEmojiGrid();

    expect(grid).toBe(full);
    expect(grid[2].keywords).toEqual(['light', 'idea']);
  });

  it('loadEmojiData caches result on second call', async () => {
    const { loadEmojiData } = await import('../../../../../src/components/utils/emoji/emoji-data');
    const first = await loadEmojiData();
    const second = await loadEmojiData();

    expect(first).toBe(second);
    expect(load.gridReads).toBe(1);
    expect(load.keywordReads).toBe(1);
  });

  it('concurrent grid and data loads share one pending load and process each file once', async () => {
    const { loadEmojiGrid, loadEmojiData } = await import('../../../../../src/components/utils/emoji/emoji-data');
    const [a, b, c, d] = await Promise.all([loadEmojiGrid(), loadEmojiData(), loadEmojiGrid(), loadEmojiData()]);

    expect(new Set([a, b, c, d]).size).toBe(1);
    expect(load.gridReads).toBe(1);
    expect(load.keywordReads).toBe(1);
  });

  it('retries the grid after a failed load instead of replaying the failure', async () => {
    const { loadEmojiGrid } = await import('../../../../../src/components/utils/emoji/emoji-data');

    load.failGrid = true;

    await expect(loadEmojiGrid()).rejects.toThrow('grid chunk failed');
    await expect(loadEmojiGrid()).resolves.toHaveLength(4);
  });

  it('retries keywords after a failed load while the grid stays loaded', async () => {
    const { loadEmojiGrid, loadEmojiData } = await import('../../../../../src/components/utils/emoji/emoji-data');

    load.failKeywords = true;

    await expect(loadEmojiData()).rejects.toThrow('keywords chunk failed');

    const grid = await loadEmojiGrid();

    expect(grid[0].keywords).toEqual([]);

    const full = await loadEmojiData();

    expect(full).toBe(grid);
    expect(full[0].keywords).toEqual(['face', 'happy']);
    expect(load.gridReads).toBe(1);
  });

  it('rejects keywords that do not line up with the grid instead of mislabelling emojis', async () => {
    const { loadEmojiData } = await import('../../../../../src/components/utils/emoji/emoji-data');

    load.keywordsOverride = [['face']];

    await expect(loadEmojiData()).rejects.toThrow(/keywords/i);
  });

  it('searchEmojis filters by name', async () => {
    const { loadEmojiData, searchEmojis } = await import('../../../../../src/components/utils/emoji/emoji-data');
    const emojis = await loadEmojiData();
    const results = searchEmojis(emojis, 'light');

    expect(results).toHaveLength(1);
    expect(results[0].native).toBe('💡');
  });

  it('searchEmojis filters by keyword', async () => {
    const { loadEmojiData, searchEmojis } = await import('../../../../../src/components/utils/emoji/emoji-data');
    const emojis = await loadEmojiData();
    const results = searchEmojis(emojis, 'idea');

    expect(results).toHaveLength(1);
    expect(results[0].id).toBe('bulb');
  });

  it('searchEmojis is case-insensitive', async () => {
    const { loadEmojiData, searchEmojis } = await import('../../../../../src/components/utils/emoji/emoji-data');
    const emojis = await loadEmojiData();
    const results = searchEmojis(emojis, 'HAPPY');

    expect(results).toHaveLength(1);
    expect(results[0].id).toBe('grinning');
  });

  it('searchEmojis returns empty array for no match', async () => {
    const { loadEmojiData, searchEmojis } = await import('../../../../../src/components/utils/emoji/emoji-data');
    const emojis = await loadEmojiData();
    const results = searchEmojis(emojis, 'zzznomatch');

    expect(results).toHaveLength(0);
  });

  it('searchEmojis matches against translated names when locale data is provided', async () => {
    const { loadEmojiData, searchEmojis } = await import('../../../../../src/components/utils/emoji/emoji-data');
    const emojis = await loadEmojiData();
    const localeData = {
      '💡': { n: 'ampoule', k: ['idée', 'lumière'] },
    };
    const results = searchEmojis(emojis, 'ampoule', localeData);

    expect(results).toHaveLength(1);
    expect(results[0].native).toBe('💡');
  });

  it('searchEmojis matches against translated keywords when locale data is provided', async () => {
    const { loadEmojiData, searchEmojis } = await import('../../../../../src/components/utils/emoji/emoji-data');
    const emojis = await loadEmojiData();
    const localeData = {
      '💡': { n: 'ampoule', k: ['idée', 'lumière'] },
    };
    const results = searchEmojis(emojis, 'idée', localeData);

    expect(results).toHaveLength(1);
    expect(results[0].native).toBe('💡');
  });

  it('searchEmojis still matches English names when locale data is provided', async () => {
    const { loadEmojiData, searchEmojis } = await import('../../../../../src/components/utils/emoji/emoji-data');
    const emojis = await loadEmojiData();
    const localeData = {
      '💡': { n: 'ampoule', k: ['idée'] },
    };
    const results = searchEmojis(emojis, 'light', localeData);

    expect(results).toHaveLength(1);
    expect(results[0].native).toBe('💡');
  });

  it('searchEmojis works without locale data (backward compatible)', async () => {
    const { loadEmojiData, searchEmojis } = await import('../../../../../src/components/utils/emoji/emoji-data');
    const emojis = await loadEmojiData();
    const results = searchEmojis(emojis, 'light');

    expect(results).toHaveLength(1);
    expect(results[0].native).toBe('💡');
  });

  it('CURATED_CALLOUT_EMOJIS contains 💡 and has ~20 entries', async () => {
    const { CURATED_CALLOUT_EMOJIS } = await import('../../../../../src/components/utils/emoji/emoji-data');

    expect(CURATED_CALLOUT_EMOJIS).toContain('💡');
    expect(CURATED_CALLOUT_EMOJIS.length).toBeGreaterThanOrEqual(15);
    expect(CURATED_CALLOUT_EMOJIS.length).toBeLessThanOrEqual(25);
  });
});
