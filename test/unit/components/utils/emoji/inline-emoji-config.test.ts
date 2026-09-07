import { describe, it, expect } from 'vitest';
import { isInlineEmojiEnabled } from '../../../../../src/components/utils/emoji/inline-emoji-config';

describe('isInlineEmojiEnabled', () => {
  it('defaults to enabled when the key is absent', () => {
    expect(isInlineEmojiEnabled({})).toBe(true);
  });

  it('is disabled only by an explicit false', () => {
    expect(isInlineEmojiEnabled({ inlineEmoji: false })).toBe(false);
    expect(isInlineEmojiEnabled({ inlineEmoji: true })).toBe(true);
  });
});
