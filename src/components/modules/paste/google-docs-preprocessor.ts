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

  return wrapper.innerHTML;
}

/**
 * Strip Google Docs wrapper elements to expose underlying content.
 * Google Docs wraps clipboard HTML in `<b id="docs-internal-guid-..."><div>...</div></b>`.
 * The sanitizer strips the `id` attribute (config is `b: {}`), making
 * the wrapper undetectable later in the pipeline.
 */
function unwrapGoogleDocsContent(wrapper: HTMLElement): void {
  const googleDocsWrapper = wrapper.querySelector<HTMLElement>('b[id^="docs-internal-guid-"]');

  if (!googleDocsWrapper) {
    return;
  }

  const contentSource = googleDocsWrapper.querySelector<HTMLElement>(':scope > div') ?? googleDocsWrapper;
  const fragment = document.createDocumentFragment();

  while (contentSource.firstChild) {
    fragment.appendChild(contentSource.firstChild);
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
