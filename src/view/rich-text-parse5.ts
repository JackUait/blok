import { parseFragment, serialize } from 'parse5';
import type { DefaultTreeAdapterMap } from 'parse5';
import type { InlineNode } from '../shared/rich-text/inline-tree';
import { inlineTreeToSegments } from '../shared/rich-text/html-to-segments';
import type { RichText } from '../../types/rich-text';

type ChildNode = DefaultTreeAdapterMap['childNode'];
type Element = DefaultTreeAdapterMap['element'];

const outerHtml = (element: Element): string => {
  const holder = parseFragment('');

  holder.childNodes.push(element);

  return serialize(holder);
};

const toNodes = (nodes: ChildNode[]): InlineNode[] => nodes.flatMap((node): InlineNode[] => {
  if (node.nodeName === '#text' && 'value' in node) {
    return [{ kind: 'text', value: node.value }];
  }
  if ('tagName' in node) {
    return [{
      kind: 'element',
      tag: node.tagName,
      attrs: Object.fromEntries(node.attrs.map(attr => [attr.name, attr.value])),
      children: toNodes(node.childNodes),
      outerHtml: outerHtml(node),
    }];
  }

  return [];
});

/** Inline HTML → parser-neutral tree, without a DOM (Node, server runtime). */
export const parseInlineHtmlWithParse5 = (html: string): InlineNode[] => toNodes(parseFragment(html).childNodes);

/** Inline HTML → canonical segments, without a DOM. */
export const htmlToSegmentsNode = (html: string): RichText => inlineTreeToSegments(parseInlineHtmlWithParse5(html));
