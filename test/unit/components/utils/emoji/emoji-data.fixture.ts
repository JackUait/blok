import { buildEmojiGridData } from '../../../../../scripts/build-emoji-grid-data.mjs';

/**
 * An emoji-mart-shaped fixture, turned into the two generated JSON modules
 * by the generator's own transform so mocks cannot drift from the real shape.
 */
export type EmojiMartFixture = Parameters<typeof buildEmojiGridData>[0];

export const emojiGridModule = (fixture: EmojiMartFixture): { default: ReturnType<typeof buildEmojiGridData>['grid'] } => ({
  default: buildEmojiGridData(fixture).grid,
});

export const emojiKeywordsModule = (fixture: EmojiMartFixture): { default: ReturnType<typeof buildEmojiGridData>['keywords'] } => ({
  default: buildEmojiGridData(fixture).keywords,
});
