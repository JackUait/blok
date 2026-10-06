import type { InlineNode } from '../../shared/rich-text/inline-tree';
import { inlineTreeToSegments } from '../../shared/rich-text/html-to-segments';
import type { RichText } from '../../../types/rich-text';

const toNodes = (nodes: NodeListOf<ChildNode>): InlineNode[] => Array.from(nodes).flatMap((node): InlineNode[] => {
  if (node.nodeType === Node.TEXT_NODE) {
    return [{ kind: 'text', value: node.textContent ?? '' }];
  }
  if (node instanceof Element) {
    return [{
      kind: 'element',
      tag: node.tagName.toLowerCase(),
      attrs: Object.fromEntries(Array.from(node.attributes).map(attr => [attr.name, attr.value])),
      children: toNodes(node.childNodes),
      outerHtml: node.outerHTML,
    }];
  }

  return [];
});

/** Inline HTML → parser-neutral tree through an inert document. */
export const parseInlineHtmlWithDom = (html: string): InlineNode[] => {
  const body = document.implementation.createHTMLDocument('').body;

  body.innerHTML = html;

  return toNodes(body.childNodes);
};

/** Inline HTML → canonical segments (editor bundle). */
export const htmlToSegmentsDom = (html: string): RichText => inlineTreeToSegments(parseInlineHtmlWithDom(html));
