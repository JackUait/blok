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
 * Extract the plain text of an HTML fragment.
 * @param html - fragment markup
 */
export const htmlTextContent = (html: string): string => {
  if (html === '') {
    return '';
  }

  return collect(parseFragment(html).childNodes);
};
