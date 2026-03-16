import { mapToNearestPresetColor } from '../../utils/color-mapping';

/**
 * Pre-process Google Docs clipboard HTML before sanitization.
 *
 * Google Docs wraps content in `<b id="docs-internal-guid-...">` and
 * encodes formatting as inline styles on `<span>` elements rather than
 * semantic tags.  The sanitizer strips `<span>` (not in the allowed
 * config), destroying formatting.  This function converts style-based
 * spans to `<b>`/`<i>`/`<mark>` BEFORE the sanitizer runs.
 *
 * @param html - raw clipboard HTML string
 * @returns preprocessed HTML string
 */
export function preprocessGoogleDocsHtml(html: string): string {
  const wrapper = document.createElement('div');

  wrapper.innerHTML = html;

  const isGoogleDocs = unwrapGoogleDocsContent(wrapper);

  convertGoogleDocsStyles(wrapper, isGoogleDocs);

  if (isGoogleDocs) {
    convertTableCellParagraphs(wrapper);
  }

  return wrapper.innerHTML;
}

/**
 * Strip Google Docs wrapper elements to expose underlying content.
 * Google Docs wraps clipboard HTML in `<b id="docs-internal-guid-...">`.
 * Content may be split across multiple child `<div>` elements (e.g. one
 * per table), so all children are moved out of the wrapper.
 *
 * @returns true if Google Docs content was detected
 */
function unwrapGoogleDocsContent(wrapper: HTMLElement): boolean {
  const googleDocsWrapper = wrapper.querySelector<HTMLElement>('b[id^="docs-internal-guid-"]');

  if (!googleDocsWrapper) {
    return false;
  }

  const fragment = document.createDocumentFragment();

  while (googleDocsWrapper.firstChild) {
    fragment.appendChild(googleDocsWrapper.firstChild);
  }

  googleDocsWrapper.replaceWith(fragment);

  return true;
}

/**
 * Determine the background-color style declaration for a Google Docs element.
 *
 * When a background color is present, it is mapped to the nearest preset.
 * When only a foreground color is present, an explicit `transparent` background
 * is returned so the mark element doesn't inherit an unwanted background.
 */
function resolveBackgroundStyle(hasBgColor: boolean, hasColor: boolean, mappedBg: string): string {
  if (hasBgColor) {
    return `background-color: ${mappedBg}`;
  }

  if (hasColor) {
    return 'background-color: transparent';
  }

  return '';
}

/**
 * Check whether a CSS color value is the default black text color.
 * Google Docs uses different formats: `rgb(0, 0, 0)`, `rgb(0,0,0)`, or `#000000`.
 * Spans with only this color should not be converted to `<mark>`.
 */
function isDefaultBlack(color: string): boolean {
  const normalized = color.replace(/\s/g, '');

  return normalized === 'rgb(0,0,0)' || normalized === '#000000';
}

/**
 * Check whether a CSS background-color value is the default white page background.
 * When the browser natively copies from a contenteditable, it adds computed styles
 * including `background-color: rgb(255, 255, 255)` — the resolved page background.
 * These should not be treated as intentional marker formatting.
 */
function isDefaultWhiteBackground(bgColor: string): boolean {
  const normalized = bgColor.replace(/\s/g, '').toLowerCase();

  return normalized === 'rgb(255,255,255)' || normalized === '#ffffff' || normalized === 'white';
}

/**
 * Optionally wrap innerHTML in a `<mark>` with mapped color styles.
 * Returns the original content unchanged when no color formatting is needed.
 */
function buildMarkWrapper(
  innerHTML: string,
  hasColor: boolean,
  hasBgColor: boolean,
  color: string | undefined,
  bgColor: string | undefined
): string {
  if (!hasColor && !hasBgColor) {
    return innerHTML;
  }

  const mappedColor = hasColor && color !== undefined ? mapToNearestPresetColor(color, 'text') : '';
  const mappedBg = hasBgColor && bgColor !== undefined ? mapToNearestPresetColor(bgColor, 'bg') : '';

  const colorStyles = [
    hasColor ? `color: ${mappedColor}` : '',
    resolveBackgroundStyle(hasBgColor, hasColor, mappedBg),
  ].filter(Boolean).join('; ');

  return colorStyles
    ? `<mark style="${colorStyles};">${innerHTML}</mark>`
    : innerHTML;
}

/**
 * Convert a single style `<span>` to semantic HTML.
 *
 * For Google Docs content, all non-transparent backgrounds are treated as
 * intentional formatting.  For browser-native clipboard content, default
 * page values (black text, white background) are filtered out so computed
 * styles on plain text don't produce spurious `<mark>` elements.
 *
 * @returns replacement HTML string, or `null` if the span should be left as-is
 */
function convertSpanToSemanticHtml(span: Element, isGoogleDocs: boolean): string | null {
  const style = span.getAttribute('style') ?? '';
  const isBold = /font-weight\s*:\s*(700|bold)/i.test(style);
  const isItalic = /font-style\s*:\s*italic/i.test(style);

  const colorMatch = /(?<![a-z-])color\s*:\s*([^;]+)/i.exec(style);
  const bgMatch = /background-color\s*:\s*([^;]+)/i.exec(style);

  const color = colorMatch?.[1]?.trim();
  const bgColor = bgMatch?.[1]?.trim();

  const hasColor = color !== undefined && !isDefaultBlack(color);
  const hasBgColor = isGoogleDocs
    ? bgColor !== undefined && bgColor !== 'transparent'
    : bgColor !== undefined && bgColor !== 'transparent' && !isDefaultWhiteBackground(bgColor);

  if (!isBold && !isItalic && !hasColor && !hasBgColor) {
    return null;
  }

  const inner = buildMarkWrapper(span.innerHTML, hasColor, hasBgColor, color, bgColor);
  const italic = isItalic ? `<i>${inner}</i>` : inner;

  return isBold ? `<b>${italic}</b>` : italic;
}

/**
 * Convert Google Docs style-based `<span>` elements to semantic HTML tags.
 *
 * - `<span style="font-weight:700">` or `font-weight:bold` → `<b>`
 * - `<span style="font-style:italic">` → `<i>`
 * - `<span style="color:...">` → `<mark style="color: ...">`
 * - `<span style="background-color:...">` → `<mark style="background-color: ...">`
 *
 * Color and bold/italic can combine: a bold red span becomes `<b><mark style="color: red;">text</mark></b>`.
 */
function convertGoogleDocsStyles(wrapper: HTMLElement, isGoogleDocs: boolean): void {
  for (const span of Array.from(wrapper.querySelectorAll('span[style]'))) {
    const replacement = convertSpanToSemanticHtml(span, isGoogleDocs);

    if (replacement !== null) {
      span.replaceWith(document.createRange().createContextualFragment(replacement));
    }
  }

  if (isGoogleDocs) {
    convertAnchorColorStyles(wrapper);
  }
}

/**
 * Convert color/background-color styles on `<a>` elements to `<mark>` tags.
 *
 * Google Docs sometimes puts background-color directly on the `<a>` element.
 * The sanitizer only allows `href`/`target`/`rel` on `<a>`, so inline styles
 * are stripped — losing the background.  This moves color styles into a
 * `<mark>` wrapping the link content before sanitization runs.
 */
function convertAnchorColorStyles(wrapper: HTMLElement): void {
  for (const anchor of Array.from(wrapper.querySelectorAll('a[style]'))) {
    const style = anchor.getAttribute('style') ?? '';

    const colorMatch = /(?<![a-z-])color\s*:\s*([^;]+)/i.exec(style);
    const bgMatch = /background-color\s*:\s*([^;]+)/i.exec(style);

    const color = colorMatch?.[1]?.trim();
    const bgColor = bgMatch?.[1]?.trim();

    const hasColor = color !== undefined && !isDefaultBlack(color) && color !== 'inherit';
    const hasBgColor = bgColor !== undefined && bgColor !== 'transparent' && bgColor !== 'inherit';

    if (!hasColor && !hasBgColor) {
      continue;
    }

    const mappedColor = hasColor ? mapToNearestPresetColor(color, 'text') : '';
    const mappedBg = hasBgColor ? mapToNearestPresetColor(bgColor, 'bg') : '';

    const colorStyles = [
      hasColor ? `color: ${mappedColor}` : '',
      resolveBackgroundStyle(hasBgColor, hasColor, mappedBg),
    ].filter(Boolean).join('; ');

    const el = anchor as HTMLElement;

    el.innerHTML = `<mark style="${colorStyles};">${el.innerHTML}</mark>`;
    el.style.removeProperty('color');
    el.style.removeProperty('background-color');
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
