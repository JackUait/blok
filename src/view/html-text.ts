/**
 * DOM-free plain-text extraction from an HTML fragment string — the view
 * renderer's replacement for `element.textContent`. parse5 decodes entities,
 * so `a &lt; b` comes back as `a < b`; `<br>` becomes a newline (matching how
 * text with soft breaks reads).
 *
 * parse5 imports are confined to `src/view/` — never import this module from
 * the editor bundle graph.
 */
import { parseFragment } from 'parse5';
import type { DefaultTreeAdapterMap } from 'parse5';

import { EQUATION_SOURCE_ATTR } from '../shared/equation-mark';

type P5ChildNode = DefaultTreeAdapterMap['childNode'];

/**
 * Collect the concatenated text of parse5 child nodes.
 * @param nodes - nodes to walk
 */
const collect = (nodes: P5ChildNode[]): string => {
  return nodes.map((node) => {
    if (node.nodeName === '#text') {
      return (node as DefaultTreeAdapterMap['textNode']).value;
    }

    if (node.nodeName === 'br') {
      return '\n';
    }

    /**
     * An inline equation reads as its SOURCE, never as its children: those are
     * a KaTeX rendering cache, and documents saved before that cache was
     * stripped hold the concatenated text of KaTeX's MathML, annotation and
     * HTML layers. See the law in `src/shared/equation-mark.ts`.
     */
    if ('attrs' in node) {
      const source = node.attrs.find((attr) => attr.name === EQUATION_SOURCE_ATTR);

      if (source !== undefined) {
        return source.value;
      }
    }

    return 'childNodes' in node ? collect(node.childNodes) : '';
  }).join('');
};

/**
 * The characters HTML5 input-stream preprocessing acts on: `<` opens a tag, `&`
 * may open a character reference, a CR (alone or in a CRLF) becomes a newline,
 * and a NUL is dropped. Every other character — tab, form feed, U+00A0, a lone
 * surrogate, an astral emoji, a bare `>` — comes back out of the tokenizer
 * exactly as it went in.
 */
const NEEDS_TOKENIZING = /[<&\r\u0000]/;

/**
 * Whether a field has to go through parse5 at all. A field that does not is
 * returned verbatim by every reader here, which is what the tokenizer would
 * have produced — and parse5 is a character-by-character HTML5 tokenizer, so
 * skipping it is most of the cost of reading a document that is mostly prose.
 * This matters far more than it looks: the server package runs this code on an
 * interpreter, where the tokenizer costs orders of magnitude more than it does
 * in a browser.
 * @param html - fragment markup
 */
export const needsTokenizing = (html: string): boolean => NEEDS_TOKENIZING.test(html);

/**
 * A valid surrogate pair, or a single surrogate. Ordered so the pair wins:
 * whatever the alternation matches with length 1 was unpaired.
 */
const SURROGATE = /[\uD800-\uDBFF][\uDC00-\uDFFF]|[\uD800-\uDFFF]/g;

/**
 * Parse a fragment, repairing input parse5 refuses to read at all. Two adjacent
 * low surrogates make it throw `RangeError` — the shape a truncated UTF-16
 * paste leaves behind — and that would cost a whole document over one field.
 * The server runtime reads STORED articles, where an abort means an article
 * nobody can read again, not a request someone can retry.
 *
 * HTML5 replaces an unpaired surrogate with U+FFFD anyway, so doing it here
 * loses nothing that was not already broken, and keeps the field's markup.
 * @param html - fragment markup
 */
export const repairSurrogates = (html: string): string =>
  html.replace(SURROGATE, (match) => (match.length === 2 ? match : '\uFFFD'));

/**
 * Parse an inline fragment, retrying once on the input parse5 refuses.
 * @param html - fragment markup
 */
export const parseInlineFragment = (html: string): DefaultTreeAdapterMap['documentFragment'] => {
  try {
    return parseFragment(html);
  } catch (error) {
    if (!(error instanceof RangeError)) {
      throw error;
    }

    return parseFragment(repairSurrogates(html));
  }
};

/**
 * Extract the plain text of an HTML fragment.
 * @param html - fragment markup
 */
export const htmlTextContent = (html: string): string => {
  if (html === '' || !needsTokenizing(html)) {
    return html;
  }

  return collect(parseInlineFragment(html).childNodes);
};
