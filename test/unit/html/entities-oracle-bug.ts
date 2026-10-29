/**
 * parse5 8.0.1 decodes references with `entities`, pinned at 8.0.0 in
 * yarn.lock. That version decodes some names that need a `;` when the `;` is
 * missing, and eats the next character: `&Gdot ` becomes `Â`; in attributes it
 * also decodes `&divideontimex`. 8.1.0 fixes both and agrees with us.
 * We follow the spec, so inputs that hit the bug are skipped in differential
 * tests and counted.
 */
import { decodeHTML, decodeHTMLAttribute } from 'entities';
import { CharRefReader } from '../../../src/html/char-refs';

/** Decodes every reference in `text` the way the tokenizer reads them. */
export const decodeAll = (text: string, inAttribute: boolean): string => {
  const reader = new CharRefReader();
  const parts: string[] = [];
  const cursor = { at: 0 };

  while (cursor.at < text.length) {
    const amp = text.indexOf('&', cursor.at);

    if (amp < 0) {
      parts.push(text.slice(cursor.at));
      break;
    }
    parts.push(text.slice(cursor.at, amp));
    if (reader.read(text, amp + 1, inAttribute)) {
      parts.push(reader.value);
      cursor.at = reader.end;
    } else {
      parts.push('&');
      cursor.at = amp + 1;
    }
  }

  return parts.join('');
};

/** True when entities 8.0.0 reads the reference at the start of `window` differently from us. */
const misreads = (window: string): boolean =>
  decodeHTML(window) !== decodeAll(window, false) || decodeHTMLAttribute(window) !== decodeAll(window, true);

/**
 * True when some named reference in `html` hits the entities 8.0.0 bug. A
 * reading depends only on the name and the character after it, so each
 * `&name` is checked with that one character.
 */
export const hitsEntitiesBug = (html: string): boolean =>
  [...html.matchAll(/&[a-zA-Z0-9]{1,32}/g)].some((match) => misreads(html.slice(match.index, match.index + match[0].length + 1)));
