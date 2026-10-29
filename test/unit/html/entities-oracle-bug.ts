/**
 * parse5 8.0.1 decodes references with `entities`, pinned at 8.0.0 in
 * yarn.lock. That version decodes some names that need a `;` when the `;` is
 * missing, and eats the next character: `&Gdot ` becomes `Â`; in attributes it
 * also decodes `&divideontimex` and `&centerdot`. 8.1.0 fixes both and agrees with us.
 * We follow the spec, so inputs that hit the bug are skipped in differential
 * tests and counted.
 */
import { parseFragment } from 'parse5';
import type { DefaultTreeAdapterMap } from 'parse5';
import { CharRefReader } from '../../../src/html/char-refs';

type Parse5Node = DefaultTreeAdapterMap['childNode'];

const textOf = (nodes: Parse5Node[]): string =>
  nodes.map((node) => {
    if ('value' in node) {
      return node.value;
    }

    return 'childNodes' in node ? textOf(node.childNodes) : '';
  }).join('');

/** How parse5 reads references in text: the oracle the tokenizer has to match. */
export const parse5Text = (text: string): string => textOf(parseFragment(text).childNodes);

/** How parse5 reads references in an attribute value, quoted with a quote the value lacks. */
export const parse5Attribute = (value: string): string => {
  const quote = value.includes('"') ? "'" : '"';
  const [element] = parseFragment(`<a x=${quote}${value}${quote}>`).childNodes;

  return element !== undefined && 'attrs' in element ? element.attrs[0]?.value ?? '' : '';
};

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
  parse5Text(window) !== decodeAll(window, false) || parse5Attribute(window) !== decodeAll(window, true);

/**
 * True when some named reference in `html` hits the entities 8.0.0 bug. A
 * reading depends only on the name and the character after it, so each
 * `&name` is checked with that one character.
 */
export const hitsEntitiesBug = (html: string): boolean =>
  [...html.matchAll(/&[a-zA-Z0-9]{1,32}/g)].some((match) => misreads(html.slice(match.index, match.index + match[0].length + 1)));
