export interface EmojiTriggerSpan {
  start: number;
  end: number;
  query: string;
}

// A contenteditable renders a trailing space as U+00A0, so both forms must
// count as the word boundary before the colon.
const WHITESPACE = /[\s ]/;

/**
 * Plain-text span of a ":query" the caret currently sits in, or null when the
 * text under the caret is not an emoji trigger.
 * @param text - the block's plain text
 * @param caretOffset - caret position as a plain-text offset
 */
export function resolveEmojiTriggerSpan(text: string, caretOffset: number): EmojiTriggerSpan | null {
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
