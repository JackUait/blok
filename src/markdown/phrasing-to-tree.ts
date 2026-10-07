import type { PhrasingContent } from 'mdast';
import { safeHref, safeImageSrc } from '../components/utils/sanitize-url';
import type { InlineNode } from '../shared/rich-text/inline-tree';
import { isBareBreak, linkTarget, type DefinitionMap } from './phrasing-to-html';

/**
 * The tree `phrasingToHtml` would parse back into, built without an HTML
 * parser: this module ships in the editor's markdown chunk and runs in the
 * server runtime, so it can use neither parse5 nor a DOM. Every case mirrors
 * the one in `phrasingToHtml`; test/unit/markdown/markdown-to-blocks-segments.test.ts
 * pins the two together through parse5.
 */

const text = (value: string): InlineNode[] =>
  // An HTML parser normalizes CR and CRLF to LF before it builds text nodes.
  value === '' ? [] : [{ kind: 'text', value: value.replace(/\r\n?/g, '\n') }];

const element = (tag: string, children: InlineNode[], attrs: Record<string, string> = {}): InlineNode =>
  // outerHtml is read only for opaque tags (img), which build their own.
  ({ kind: 'element', tag, attrs, children, outerHtml: '' });

export const BREAK: InlineNode = element('br', []);

// Same escaping parse5 serializes attribute values with.
const escapeAttribute = (value: string): string =>
  value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/\u00a0/g, '&nbsp;');

const anchor = (url: string, children: InlineNode[]): InlineNode[] =>
  [element('a', children, { href: url, target: linkTarget(url), rel: 'noopener noreferrer nofollow' })];

const image = (rawUrl: string, alt: string): InlineNode[] => {
  const url = safeImageSrc(rawUrl);

  return url === null
    ? []
    : [{
      kind: 'element',
      tag: 'img',
      attrs: { src: url, alt },
      children: [],
      outerHtml: `<img src="${escapeAttribute(url)}" alt="${escapeAttribute(alt)}">`,
    }];
};

const referenceFallback = (label: string, children: InlineNode[], isImage: boolean): InlineNode[] =>
  [...text(`${isImage ? '!' : ''}[`), ...children, ...text(`][${label}]`)];

const nodeToTree = (node: PhrasingContent, definitions: DefinitionMap): InlineNode[] => {
  switch (node.type) {
    case 'text':
      return text(node.value);
    case 'strong':
      return [element('strong', phrasingToTree(node.children, definitions))];
    case 'emphasis':
      return [element('i', phrasingToTree(node.children, definitions))];
    case 'delete':
      return [element('s', phrasingToTree(node.children, definitions))];
    case 'inlineCode':
      return [element('code', text(node.value))];
    case 'link': {
      const url = safeHref(node.url);
      const children = phrasingToTree(node.children, definitions);

      return url === null ? children : anchor(url, children);
    }
    case 'linkReference': {
      const definition = definitions.get(node.identifier);
      const children = phrasingToTree(node.children, definitions);

      if (definition === undefined) {
        return referenceFallback(node.label ?? node.identifier, children, false);
      }

      const url = safeHref(definition.url);

      return url === null ? children : anchor(url, children);
    }
    case 'break':
      return [BREAK];
    case 'image':
      return image(node.url, node.alt ?? '');
    case 'imageReference': {
      const definition = definitions.get(node.identifier);
      const alt = node.alt ?? '';

      return definition === undefined
        ? referenceFallback(node.label ?? node.identifier, text(alt), true)
        : image(definition.url, alt);
    }
    case 'html':
      return isBareBreak(node.value) ? [BREAK] : text(node.value);
    case 'inlineMath': {
      const latex = node.value ?? '';

      return [element('span', text(latex), { 'data-latex': latex })];
    }
    case 'footnoteReference':
      return [];
    default:
      return [];
  }
};

/**
 * mdast phrasing nodes → the inline tree segments are read from.
 * @param nodes - phrasing nodes
 * @param definitions - definitions the document's references resolve against
 */
export function phrasingToTree(nodes: PhrasingContent[], definitions: DefinitionMap): InlineNode[] {
  return nodes.flatMap(node => nodeToTree(node, definitions));
}

/** Plain text as a tree, for content `phrasingToHtml` never saw (escaped raw HTML). */
export const literalTree = text;
