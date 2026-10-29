/**
 * DOM-free plain-text extraction from an HTML fragment string — the view
 * renderer's replacement for `element.textContent`. The parser decodes entities,
 * so `a &lt; b` comes back as `a < b`; `<br>` becomes a newline (matching how
 * text with soft breaks reads).
 *
 * src/html imports are confined to `src/view/` — never import this module from
 * the editor bundle graph.
 */
import { parseFragment } from '../html';
import type { ChildNode as HtmlChildNode, DocumentFragment as HtmlDocumentFragment, TextNode as HtmlTextNode } from '../html';

import { EQUATION_SOURCE_ATTR } from '../shared/equation-mark';
import { PAGE_REFERENCE_ATTR } from '../shared/page-reference';

/**
 * Collect the concatenated text of child nodes.
 * @param nodes - nodes to walk
 */
const collect = (
  nodes: HtmlChildNode[],
  equations: 'source' | 'skip' = 'source',
  pageReferenceText?: (pageId: string) => string
): string => {
  return nodes.map((node) => {
    if (node.nodeName === '#text') {
      return (node as HtmlTextNode).value;
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
      const pageId = node.nodeName === 'a'
        ? node.attrs.find((attr) => attr.name === PAGE_REFERENCE_ATTR)?.value
        : undefined;

      if (pageId && pageReferenceText !== undefined) {
        return pageReferenceText(pageId);
      }

      const source = node.attrs.find((attr) => attr.name === EQUATION_SOURCE_ATTR);

      if (source !== undefined) {
        return equations === 'source' ? source.value : '';
      }
    }

    return 'childNodes' in node ? collect(node.childNodes, equations, pageReferenceText) : '';
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
 * Whether a field has to go through the parser at all. A field that does not is
 * returned verbatim by every reader here, which is what the tokenizer would
 * have produced — and the tokenizer is an HTML5 state machine, so
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
 * Parse a fragment, repairing input the parser refuses to read at all (it
 * throws where parse5 8.0.1 threw, to keep output identical). Two adjacent
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
 * Parse an inline fragment, retrying once on the input the parser refuses.
 * @param html - fragment markup
 */
export const parseInlineFragment = (html: string): HtmlDocumentFragment => {
  try {
    return parseFragment(html);
  } catch (error) {
    const repaired = repairSurrogates(html);

    // Same text again would fail again: a stack overflow is a RangeError too.
    if (!(error instanceof RangeError) || repaired === html) {
      throw error;
    }

    return parseFragment(repaired);
  }
};

/**
 * Extract the plain text of an HTML fragment.
 * @param html - fragment markup
 */
export const htmlTextContent = (html: string, pageReferenceText?: (pageId: string) => string): string => {
  if (html === '' || !needsTokenizing(html)) {
    return html;
  }

  return collect(parseInlineFragment(html).childNodes, 'source', pageReferenceText);
};

/**
 * Plain text without inline equations: the letters that set a block's
 * direction. Math is always LTR, so its source says nothing about the prose.
 * @param html - fragment markup
 */
export const proseTextContent = (html: string): string => {
  if (html === '' || !needsTokenizing(html)) {
    return html;
  }

  return collect(parseInlineFragment(html).childNodes, 'skip');
};
