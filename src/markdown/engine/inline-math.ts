/** `5/` in `$5/$month`, `5-` in `$5-$10`: a number that runs into a separator. */
const PRICE = /^\d[\s\S]*[-+/,.:;–—]$/;

/**
 * Whether the text between two single `$` is math rather than prose with
 * prices in it. Padded content (`$5 and $`) and a number that runs into a
 * separator (`$5/$`) are prose; `$2x$`, `$5 + 3$` and `$5$` are math.
 * @param content - the text between the dollars
 */
export const isInlineMath = (content: string): boolean =>
  content !== '' && content.trim() === content && !PRICE.test(content);
