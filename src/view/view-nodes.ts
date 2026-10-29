/**
 * `blocksToViewNodes` — render a saved Blok document to a framework-agnostic
 * JSON tree instead of an HTML string. The tree is what framework bindings
 * (React's `<BlokView>` / `useBlokView`) map to native elements, so no
 * `dangerouslySetInnerHTML` is ever needed.
 *
 * Implementation: the document is rendered through the exact `blocksToHtml`
 * pipeline (same emitters, same sanitization), then the sanitized HTML is
 * parsed with src/html and mapped to {@link ViewNode}s. Correctness first — the
 * serialize→reparse round trip guarantees byte-for-byte parity with
 * `blocksToHtml`.
 *
 * PURITY CONTRACT: DOM-free; src/html usage stays confined to `src/view/`
 * (enforced by test/unit/architecture/view-entry-law.test.ts).
 */
import { parseFragment } from '../html';
import type { ChildNode as HtmlChildNode, Element as HtmlElement, Template as HtmlTemplate } from '../html';

import type { LooseOutputData, OutputData } from '../../types';
import { blocksToHtml } from './blocks-to-html';
import type { BlocksToHtmlOptions } from './blocks-to-html';

/**
 * An element in the view tree: lowercase tag name, sanitized attributes as a
 * plain string record, ordered children.
 */
export interface ViewElementNode {
  tag: string;
  attrs: Record<string, string>;
  children: ViewNode[];
}

/**
 * A text node in the view tree (entity-decoded).
 */
export interface ViewTextNode {
  text: string;
}

/**
 * One node of the framework-agnostic view tree produced by
 * {@link blocksToViewNodes}. HTML comments (e.g. `onUnknownBlock: 'comment'`
 * markers) have no representation and are dropped.
 */
export type ViewNode = ViewElementNode | ViewTextNode;

/**
 * Whether the node is an element.
 * @param node - child node
 */
const isElementNode = (node: HtmlChildNode): node is HtmlElement => {
  return 'tagName' in node;
};

/**
 * Whether the element is a template (children live on `content`).
 * @param node - element
 */
const isTemplateNode = (node: HtmlElement): node is HtmlTemplate => {
  return node.nodeName === 'template' && 'content' in node;
};

/**
 * Map a list of child nodes to ViewNodes, dropping comments and other
 * non-element/non-text nodes.
 * @param nodes - child nodes
 */
const mapChildren = (nodes: HtmlChildNode[]): ViewNode[] => {
  return nodes.flatMap((node): ViewNode[] => {
    if (node.nodeName === '#text' && 'value' in node) {
      return [{ text: node.value }];
    }

    if (!isElementNode(node)) {
      return [];
    }

    const attrs: Record<string, string> = {};

    for (const attr of node.attrs) {
      attrs[attr.name] = attr.value;
    }

    return [{
      tag: node.tagName.toLowerCase(),
      attrs,
      children: mapChildren(isTemplateNode(node) ? node.content.childNodes : node.childNodes),
    }];
  });
};

/** Parse in a <div> context to match the sanitizer's; the parser only reads it, so it is shared. */
const DIV_CONTEXT = parseFragment('<div></div>').childNodes[0] as HtmlElement;

/**
 * Render a saved Blok document to a framework-agnostic JSON tree,
 * synchronously and DOM-free. Same options and sanitization pipeline as
 * `blocksToHtml`.
 *
 * @experimental Not frozen until a second framework adapter consumes it —
 * the shape may change in a minor release.
 * @param data - saved document (strict or loose wire shape; nullish tolerated)
 * @param options - schema / custom renderers / unknown-block policy
 * @returns view nodes ([] for empty/malformed documents)
 */
export const blocksToViewNodes = (
  data: OutputData | LooseOutputData | null | undefined,
  options: BlocksToHtmlOptions = {}
): ViewNode[] => {
  const html = blocksToHtml(data, options);

  if (html === '') {
    return [];
  }

  const fragment = parseFragment(DIV_CONTEXT, html);

  return mapChildren(fragment.childNodes);
};
