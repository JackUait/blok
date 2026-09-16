/**
 * Serialize Blok blocks to Markdown text — the editor-side entry.
 *
 * This is the inverse of the Markdown import pipeline (mdast-to-blocks) and is
 * used for the `text/plain` clipboard flavor so copied content carries Markdown
 * (headings as `#`, bold as `**`, lists as `-`, …) instead of stripped plain
 * text — matching how Notion serializes blocks on copy.
 *
 * Block-level serialization lives in `blocks-to-markdown-core.ts`; this module
 * supplies the DOM inline backend. The DOM-free twin used by the view renderer
 * is `src/view/blocks-to-markdown.ts`, and the two are pinned together by
 * test/unit/markdown/blocks-to-markdown.parity.test.ts. Never import parse5
 * here — it would land in the editor bundle.
 */

import { EQUATION_SOURCE_ATTR } from '../shared/equation-mark';
import { inlineLosses, serializeBlocksToMarkdown } from './blocks-to-markdown-core';
import type { InlineBackend, SerializableBlock } from './blocks-to-markdown-core';

export type { SerializableBlock, MarkdownDegradation } from './blocks-to-markdown-core';

/** Receives the name of every inline construct the walk had to unwrap. */
type LossReporter = (construct: string) => void;

/**
 * Serialize all child nodes of an element to inline Markdown.
 * @param node - parent node
 * @param onLoss - receives every unwrapped inline construct
 */
const serializeChildren = (node: Node, onLoss: LossReporter): string =>
  Array.from(node.childNodes).map((child) => serializeInlineNode(child, onLoss)).join('');

/**
 * Serialize a single inline DOM node to Markdown.
 * @param node - the node to serialize
 * @param onLoss - receives every unwrapped inline construct
 */
const serializeInlineNode = (node: Node, onLoss: LossReporter): string => {
  if (node.nodeType === Node.TEXT_NODE) {
    return node.textContent ?? '';
  }

  if (node.nodeType !== Node.ELEMENT_NODE) {
    return '';
  }

  const element = node as HTMLElement;

  /**
   * An inline equation reads as its SOURCE: its children are a KaTeX rendering
   * cache, and documents saved before that cache was stripped hold the
   * concatenated text of KaTeX's MathML, annotation and HTML layers. See the
   * law in `src/shared/equation-mark.ts`.
   */
  const latex = element.getAttribute(EQUATION_SOURCE_ATTR);

  if (latex !== null) {
    return latex;
  }

  const inner = serializeChildren(element, onLoss);

  switch (element.tagName.toLowerCase()) {
    case 'br':
      return '\n';
    case 'b':
    case 'strong':
      return inner.trim() === '' ? inner : `**${inner}**`;
    case 'i':
    case 'em':
      return inner.trim() === '' ? inner : `*${inner}*`;
    case 'code':
      return inner.trim() === '' ? inner : `\`${inner}\``;
    case 's':
    case 'del':
    case 'strike':
      return inner.trim() === '' ? inner : `~~${inner}~~`;
    case 'a': {
      const href = element.getAttribute('href');

      return href ? `[${inner}](${href})` : inner;
    }
    /**
     * An image has no child nodes, so the `default` branch serializes it to
     * nothing and the image is lost. `alt` and `src` are written raw, exactly
     * as `a` writes its label and `href`.
     */
    case 'img': {
      const src = element.getAttribute('src');

      return src ? `![${element.getAttribute('alt') ?? ''}](${src})` : '';
    }
    default:
      inlineLosses(element.tagName.toLowerCase(), element.getAttribute('style')).forEach(onLoss);

      return inner;
  }
};

/** Reads inline HTML through a live DOM. Browser/jsdom only. */
const domInlineBackend: InlineBackend = {
  /**
   * Convert a fragment of inline HTML (a block's `text`) into inline Markdown.
   * @param html - inline HTML string
   * @param onLoss - receives every unwrapped inline construct
   */
  inlineToMarkdown(html: string, onLoss: LossReporter = (): void => {}): string {
    const container = document.createElement('div');

    container.innerHTML = html ?? '';

    return serializeChildren(container, onLoss);
  },
};

/**
 * Serialize an ordered list of blocks to a single Markdown string.
 *
 * Consecutive list items are joined with single newlines (a tight list); all
 * other block boundaries use a blank line.
 * @param blocks - blocks to serialize, in document order
 * @returns Markdown string
 */
export const blocksToMarkdown = (blocks: SerializableBlock[]): string =>
  serializeBlocksToMarkdown(blocks, domInlineBackend).markdown;
