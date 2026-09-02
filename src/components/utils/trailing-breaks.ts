/** Splits on `<br>` while keeping the tokens, so the parts rejoin exactly. */
const BR_TOKEN = /(<br\s*\/?>)/i;
const IS_BR_TOKEN = /^<br\s*\/?>$/i;

/**
 * Drop the trailing run of `<br>` tokens and whitespace from cell markup.
 *
 * Splits once instead of matching `/(?:<br\s*\/?>|\s)+$/`: that pattern has no
 * anchored start, so it retries the whole run from every offset and goes
 * quadratic — 40k trailing spaces of pasted HTML took over two seconds.
 * @param html - cell markup, straight off the clipboard
 * @returns the markup without its trailing breaks and whitespace
 */
export function trimTrailingBreaks(html: string): string {
  const parts = html.split(BR_TOKEN);
  const lastContent = parts.reduce(
    (index, part, position) => (IS_BR_TOKEN.test(part) || part.trim() === '' ? index : position),
    -1
  );

  return parts.slice(0, lastContent + 1).join('').trimEnd();
}
