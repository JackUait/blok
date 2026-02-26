/**
 * Pre-process Google Docs clipboard HTML before sanitization.
 *
 * Google Docs wraps content in `<b id="docs-internal-guid-...">` and
 * encodes formatting as inline styles on `<span>` elements rather than
 * semantic tags.  The sanitizer strips `<span>` (not in the allowed
 * config), destroying formatting.  This function converts style-based
 * spans to `<b>`/`<i>` BEFORE the sanitizer runs.
 *
 * @param html - raw clipboard HTML string
 * @returns preprocessed HTML string
 */
export function preprocessGoogleDocsHtml(html: string): string {
  const wrapper = document.createElement('div');

  wrapper.innerHTML = html;

  unwrapGoogleDocsContent(wrapper);
  convertGoogleDocsStyles(wrapper);
  convertTableCellParagraphs(wrapper);

  return wrapper.innerHTML;
}

/**
 * Strip Google Docs wrapper elements to expose underlying content.
 * Google Docs wraps clipboard HTML in `<b id="docs-internal-guid-...">`.
 * Content may be split across multiple child `<div>` elements (e.g. one
 * per table), so all children are moved out of the wrapper.
 */
function unwrapGoogleDocsContent(wrapper: HTMLElement): void {
  const googleDocsWrapper = wrapper.querySelector<HTMLElement>('b[id^="docs-internal-guid-"]');

  if (!googleDocsWrapper) {
    return;
  }

  const fragment = document.createDocumentFragment();

  while (googleDocsWrapper.firstChild) {
    fragment.appendChild(googleDocsWrapper.firstChild);
  }

  googleDocsWrapper.replaceWith(fragment);
}

/**
 * Convert Google Docs style-based `<span>` elements to semantic HTML tags.
 *
 * - `<span style="font-weight:700">` or `font-weight:bold` → `<b>`
 * - `<span style="font-style:italic">` → `<i>`
 */
function convertGoogleDocsStyles(wrapper: HTMLElement): void {
  for (const span of Array.from(wrapper.querySelectorAll('span[style]'))) {
    const style = span.getAttribute('style') ?? '';
    const isBold = /font-weight\s*:\s*(700|bold)/i.test(style);
    const isItalic = /font-style\s*:\s*italic/i.test(style);

    if (!isBold && !isItalic) {
      continue;
    }

    const inner = span.innerHTML;
    const italic = isItalic ? `<i>${inner}</i>` : inner;
    const wrapped = isBold ? `<b>${italic}</b>` : italic;

    span.replaceWith(document.createRange().createContextualFragment(wrapped));
  }
}

/**
 * Convert `<p>` boundaries to `<br>` line breaks inside table cells.
 *
 * Google Docs wraps each line in a cell as a separate `<p>`.  The sanitizer
 * strips `<p>` (not in the allowed config), losing line breaks.  Converting
 * to `<br>` preserves them since `<br>` IS in the config (`{ br: {} }`).
 *
 * Only targets `<td>` and `<th>` elements — top-level `<p>` tags are left
 * intact so the paste pipeline can split them into separate blocks.
 */
function convertTableCellParagraphs(wrapper: HTMLElement): void {
  for (const cell of Array.from(wrapper.querySelectorAll('td, th'))) {
    const paragraphs = cell.querySelectorAll('p');

    if (paragraphs.length === 0) {
      continue;
    }

    for (const p of Array.from(paragraphs)) {
      const fragment = document.createRange().createContextualFragment(p.innerHTML + '<br>');

      p.replaceWith(fragment);
    }

    // Remove trailing <br> from the cell
    cell.innerHTML = cell.innerHTML.replace(/(<br\s*\/?>|\s)+$/i, '');
  }
}
