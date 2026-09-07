export interface EmojiTriggerSpan {
  start: number;
  end: number;
  query: string;
}

// Requiring whitespace (or start-of-text) before the colon is what keeps
// "10:30" and "a:b" from opening the menu.
const WHITESPACE = /\s/;

/**
 * Plain-text span of a ":query" the caret currently sits in, or null when the
 * text under the caret is not an emoji trigger.
 * @param text - the block's plain text
 * @param caretOffset - caret position as a plain-text offset
 */
export function resolveEmojiTriggerSpan(text: string, caretOffset: number): EmojiTriggerSpan | null {
  // A caret outside the text means our view of the text is stale; fail
  // closed rather than slicing/clamping to a wrong range.
  if (caretOffset < 0 || caretOffset > text.length) {
    return null;
  }

  const colonIndex = text.lastIndexOf(':', Math.max(0, caretOffset - 1));

  if (colonIndex === -1 || colonIndex >= caretOffset) {
    return null;
  }

  const charBefore = colonIndex === 0 ? '' : text.charAt(colonIndex - 1);

  if (charBefore !== '' && !WHITESPACE.test(charBefore)) {
    return null;
  }

  const query = text.slice(colonIndex + 1, caretOffset);

  if (query.length === 0 || WHITESPACE.test(query)) {
    return null;
  }

  return { start: colonIndex, end: caretOffset, query };
}
