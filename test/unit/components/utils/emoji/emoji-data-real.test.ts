import emojiMartData from '@emoji-mart/data';
import { describe, expect, it } from 'vitest';

import { loadEmojiData, type ProcessedEmoji } from '../../../../../src/components/utils/emoji/emoji-data';

interface EmojiMartSet {
  categories: Array<{ id: string; emojis: string[] }>;
  emojis: Record<string, { id: string; name: string; keywords: string[]; skins: Array<{ native: string }> }>;
}

const isEmojiMartSet = (value: unknown): value is EmojiMartSet =>
  typeof value === 'object' && value !== null && 'categories' in value && 'emojis' in value;

/** What the picker built straight from @emoji-mart/data before the data was split. */
const processEmojiMart = (data: EmojiMartSet): ProcessedEmoji[] =>
  data.categories.flatMap(category => category.emojis.flatMap((emojiId) => {
    const emoji = data.emojis[emojiId];
    const firstSkin = emoji?.skins[0];

    if (emoji === undefined || firstSkin === undefined) {
      return [];
    }

    return [{
      native: firstSkin.native,
      skins: emoji.skins.map(skin => skin.native),
      id: emoji.id,
      name: emoji.name,
      keywords: emoji.keywords,
      category: category.id,
    }];
  }));

describe('emoji-data against the real emoji-mart set', () => {
  it('loadEmojiData matches processing @emoji-mart/data directly', async () => {
    if (!isEmojiMartSet(emojiMartData)) {
      throw new Error('Unexpected @emoji-mart/data shape');
    }

    const expected = processEmojiMart(emojiMartData);

    expect(expected.length).toBeGreaterThan(1800);
    expect(await loadEmojiData()).toEqual(expected);
  });
});
