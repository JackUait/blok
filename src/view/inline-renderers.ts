/**
 * Per-tag inline renderers for the view path.
 *
 * `renderers` is keyed by BLOCK tool, so it cannot reach a mark inside a
 * block's text. Some marks need to: an equation persists a LaTeX source and
 * nothing else (its KaTeX markup is derived and deliberately not saved), so a
 * DOM-free renderer can only print the source unless the consumer is given a
 * place to turn it into markup — `katex.renderToString(latex)` in a server
 * render, a mention chip, an internal-link card.
 *
 * Runs AFTER sanitization, over the surviving tree: a renderer never sees an
 * element the allowlist removed, and its output is inserted as-is (trusted, the
 * same contract as a block `renderers` entry).
 *
 * PURITY CONTRACT: parse5 usage stays confined to `src/view/`.
 */
import { parseFragment, serialize } from 'parse5';
import type { DefaultTreeAdapterMap } from 'parse5';

type P5Element = DefaultTreeAdapterMap['element'];
type P5ChildNode = DefaultTreeAdapterMap['childNode'];
type P5ParentNode = DefaultTreeAdapterMap['parentNode'];

/**
 * One sanitized inline element, as handed to a {@link ViewInlineRenderer}.
 */
export interface ViewInlineElement {
  /** Lowercase tag name. */
  tag: string;
  /** Attributes that survived sanitization. */
  attrs: Record<string, string>;
  /** The element's sanitized inner HTML. */
  html: string;
  /** The element's plain text (entity-decoded). */
  text: string;
}

/**
 * A custom renderer for one inline tag: `(element) => html`. Return `undefined`
 * to leave the element as sanitized, a string to REPLACE it (an empty string
 * drops it). The returned markup is inserted as-is — it is not re-sanitized, so
 * treat it the way you treat a block renderer's output.
 */
export type ViewInlineRenderer = (element: ViewInlineElement) => string | undefined | null;

/**
 * Whether the parse5 node is an element.
 * @param node - parse5 child node
 */
const isElementNode = (node: P5ChildNode): node is P5Element => {
  return 'tagName' in node;
};

/**
 * Concatenated text of a subtree (entity-decoded by parse5).
 * @param node - parse5 element
 */
const textOf = (node: P5Element): string => {
  return node.childNodes.map((child) => {
    if (child.nodeName === '#text' && 'value' in child) {
      return child.value;
    }

    return isElementNode(child) ? textOf(child) : '';
  }).join('');
};

/**
 * Parse a fragment in a `<div>` context — the context the sanitizer uses, so
 * the same markup produces the same tree.
 * @param html - fragment markup
 */
const parseInDivContext = (html: string): P5ParentNode => {
  const contextElement = parseFragment('<div></div>').childNodes[0] as P5Element;

  return parseFragment(contextElement, html, {});
};

/**
 * Apply per-tag inline renderers to a SANITIZED fragment.
 * @param html - sanitized inline HTML
 * @param renderers - tag → renderer map (lowercase tag names)
 * @returns the fragment with matched elements replaced by their renderer output
 */
export const applyInlineRenderers = (
  html: string,
  renderers: Record<string, ViewInlineRenderer>
): string => {
  if (html === '') {
    return html;
  }

  const fragment = parseInDivContext(html);

  /**
   * Walk a parent's children, replacing matched elements. Iterates by index
   * because a replacement can change the child count.
   * @param parent - node whose children are visited
   */
  const visit = (parent: P5ParentNode): void => {
    const step = (index: number): void => {
      if (index >= parent.childNodes.length) {
        return;
      }

      const node = parent.childNodes[index];

      if (!isElementNode(node)) {
        step(index + 1);

        return;
      }

      const renderer = renderers[node.tagName.toLowerCase()];
      const rendered = renderer === undefined
        ? undefined
        : renderer({
          tag: node.tagName.toLowerCase(),
          attrs: Object.fromEntries(node.attrs.map((attr) => [attr.name, attr.value])),
          html: serialize(node),
          text: textOf(node),
        });

      if (typeof rendered !== 'string') {
        // Untouched: descend, then continue past this element.
        visit(node);
        step(index + 1);

        return;
      }

      // Replaced: splice the rendered markup in as nodes and skip past it —
      // a renderer's output is final and is never fed back through the hooks.
      const replacement = parseInDivContext(rendered).childNodes;

      for (const child of replacement) {
        child.parentNode = parent;
      }
      parent.childNodes.splice(index, 1, ...replacement);

      step(index + replacement.length);
    };

    step(0);
  };

  visit(fragment);

  return serialize(fragment);
};
