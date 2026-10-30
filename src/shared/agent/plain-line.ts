// Longer titles push the question out of view.
const MAX_TITLE = 80;

/**
 * The title the person is shown: the saved one, as one plain line. Line breaks, control and
 * format characters (bidi overrides, zero-width) are dropped, so a title cannot fake more of the question.
 */
export const plainLine = (raw: string, max = MAX_TITLE): string | undefined => {
  const line = raw
    .replace(/[\p{Zl}\p{Zp}\r\n\t\v\f\u0085]/gu, ' ')
    .replace(/[\p{Cc}\p{Cf}]/gu, '')
    .replace(/\s+/gu, ' ')
    .trim();
  const chars = Array.from(line);

  if (chars.length === 0) {
    return undefined;
  }

  return chars.length > max ? `${chars.slice(0, max - 1).join('')}…` : line;
};
