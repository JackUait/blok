import { parseUntrustedHtml } from '../../utils/inert-html';

/**
 * The plain text of a Blok clipboard payload: a code block's code as is, any
 * other block's text without markup, one block per line. Blok's own text/plain
 * is Markdown ("```js", "## Head"), which is wrong in a plain-text field.
 * Returns null when the payload is not a block list.
 */
export const blokClipboardText = (json: string): string | null => {
  try {
    const entries: unknown = JSON.parse(json);

    if (!Array.isArray(entries)) {
      return null;
    }

    return entries.flatMap((entry: { data?: { text?: unknown; code?: unknown } }) => {
      const code = entry?.data?.code;

      if (typeof code === 'string') {
        return [code];
      }
      const html = entry?.data?.text;

      if (typeof html !== 'string') {
        return [];
      }
      const text = (parseUntrustedHtml(html).textContent ?? '').trim();

      return text === '' ? [] : [text];
    }).join('\n');
  } catch {
    return null;
  }
};
