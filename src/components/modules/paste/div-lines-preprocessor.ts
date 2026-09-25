/**
 * Keep the lines of `<div>`-per-line clipboard HTML (Notion, Word, Gmail,
 * Slack) apart. The whole-page sanitize does not keep `div`, so it unwraps
 * them with no separator and the lines glue together.
 *
 * - Inside a single-block container (quote, code, list item) each line
 *   becomes a `<br>`-separated run.
 * - Elsewhere, when there are two or more lines, each line `<div>` becomes
 *   a `<p>`, so it pastes as its own block. One line stays a `<div>`, so it
 *   still pastes inline into the current field.
 *
 * @param html - raw clipboard HTML string
 * @returns preprocessed HTML string
 */
import { Dom } from '../../dom';
import { parseUntrustedHtml } from '../../utils/inert-html';

const SINGLE_BLOCK_CONTAINERS = 'blockquote, pre, li';

/** Divs here are left alone: html-janitor unwraps a `<p>` nested in them too. */
const LEAVE_ALONE_INSIDE = 'td, th, p, h1, h2, h3, h4, h5, h6';

export function preprocessDivLines(html: string): string {
  const wrapper = parseUntrustedHtml(html);

  if (wrapper.querySelector('div') === null) {
    return html;
  }

  wrapper.querySelectorAll(SINGLE_BLOCK_CONTAINERS).forEach(joinDivLines);
  splitDivLinesIntoParagraphs(wrapper);

  return wrapper.innerHTML;
}

const isBr = (node: Node | null): boolean =>
  node instanceof Element && node.tagName === 'BR';

const hasContent = (node: Node | null): boolean =>
  node !== null && !isBr(node) &&
  (node.nodeType === Node.ELEMENT_NODE || (node.textContent ?? '').trim() !== '');

/**
 * Replace every `<div>` in a container with its content and a `<br>`
 * between lines. A `<div><br></div>` is an empty line, so its placeholder
 * `<br>` is dropped.
 * @param container - the single-block container
 */
function joinDivLines(container: Element): void {
  // Deepest first, so an outer div sees its inner lines already joined.
  Array.from(container.querySelectorAll('div')).reverse().forEach((div) => {
    const children = Array.from(div.childNodes);
    const isEmptyLine = children.length === 1 && isBr(children[0]);

    // Created in the div's own (inert) document, like the other pre-passes.
    if (hasContent(div.previousSibling)) {
      div.before(div.ownerDocument.createElement('br'));
    }

    if (hasContent(div.nextSibling)) {
      div.after(div.ownerDocument.createElement('br'));
    }

    div.replaceWith(...(isEmptyLine ? [] : children));
  });
}

/**
 * Turn every line `<div>` (one with no block children) into a `<p>` when
 * the paste holds two or more non-empty lines.
 * @param wrapper - detached element holding the pasted document
 */
function splitDivLinesIntoParagraphs(wrapper: HTMLElement): void {
  const lines = Array.from(wrapper.querySelectorAll('div')).filter((div) =>
    div.closest(LEAVE_ALONE_INSIDE) === null &&
    !Array.from(div.children).some((child) => Dom.blockElements.includes(child.tagName.toLowerCase()))
  );

  if (lines.filter((div) => (div.textContent ?? '').trim() !== '').length < 2) {
    return;
  }

  lines.forEach((div) => {
    const paragraph = div.ownerDocument.createElement('p');

    paragraph.append(...Array.from(div.childNodes));
    div.replaceWith(paragraph);
  });
}
