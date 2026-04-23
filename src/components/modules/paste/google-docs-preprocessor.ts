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
    promoteImages(wrapper);
  }

  return wrapper.innerHTML;
}

/**
 * Promote every `<img>` under the wrapper to a top-level sibling.
 *
 * Google Docs pastes images wrapped inside a `<p>` (often further nested
 * under `<span>`s).  The paste pipeline splits top-level siblings into
 * separate blocks, so an `<img>` buried inside a `<p>` never gets a chance
 * to become its own image block.  This splits each enclosing ancestor at
 * the image boundary so the `<img>` ends up as a direct child of the
 * wrapper, with any before/after content preserved in clones of the
 * original ancestors.
 */
function findTopLevelAncestor(node: Element, wrapper: HTMLElement): Element | null {
  const parent = node.parentElement;

  if (parent === null) {
    return null;
  }

  return parent === wrapper ? node : findTopLevelAncestor(parent, wrapper);
}

/**
 * Shallow-clone `parent` and move every sibling before `pivot` into the clone.
 * Returns the clone (or null if it would be empty and `carry` is null).
 */
function buildBeforeHalf(parent: Element, pivot: Node, carry: Node | null): Element | null {
  const clone = parent.cloneNode(false) as Element;
  const siblings: Node[] = [];

  for (const child of Array.from(parent.childNodes)) {
    if (child === pivot) break;
    siblings.push(child);
  }

  siblings.forEach((sib) => clone.appendChild(sib));

  if (carry !== null) {
    clone.appendChild(carry);
  }

  return clone.childNodes.length > 0 ? clone : null;
}

/**
 * Shallow-clone `parent` and move every sibling after `pivot` into the clone,
 * preceded by an inner `carry` node if present.
 */
function buildAfterHalf(parent: Element, pivot: Node, carry: Node | null): Element | null {
  const clone = parent.cloneNode(false) as Element;
  const allChildren = Array.from(parent.childNodes);
  const pivotIndex = allChildren.findIndex((child) => child === pivot);
  const siblings = allChildren.slice(pivotIndex + 1);

  if (carry !== null) {
    clone.appendChild(carry);
  }

  siblings.forEach((sib) => clone.appendChild(sib));

  return clone.childNodes.length > 0 ? clone : null;
}

/**
 * Walk up from `img` to `topLevel`, splitting each ancestor at the image boundary.
 * Returns the before/after halves (clones of original ancestors, minus the image).
 */
function splitAncestorsAroundImage(img: Element, topLevel: Element): { before: Node | null; after: Node | null } {
  const reduce = (current: Element, before: Node | null, after: Node | null): { before: Node | null; after: Node | null } => {
    if (current === topLevel) return { before, after };

    const parent = current.parentElement;

    if (parent === null) return { before, after };

    const nextBefore = buildBeforeHalf(parent, current, before);
    const nextAfter = buildAfterHalf(parent, current, after);

    return reduce(parent, nextBefore, nextAfter);
  };

  return reduce(img, null, null);
}

function promoteImages(wrapper: HTMLElement): void {
  const imgs = Array.from(wrapper.querySelectorAll('img'));

  for (const img of imgs) {
    const topLevel = findTopLevelAncestor(img, wrapper);

    if (!topLevel) continue;

    const { before, after } = splitAncestorsAroundImage(img, topLevel);
    const frag = document.createDocumentFragment();

    if (before) frag.appendChild(before);
    frag.appendChild(img);
    if (after) frag.appendChild(after);

    topLevel.replaceWith(frag);
  }
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
 * Compute the relative luminance of a CSS color value.
 * Supports rgb(), rgba(), hsl(), hsla(), and hex (#rrggbb / #rgb) formats.
 * Alpha components are ignored — only the base RGB channels are used.
 * Returns a value in [0, 1], or -1 if the format is unrecognized.
 * Uses simplified linear luminance (no gamma correction), adequate for
 * threshold comparisons at this scale.
 */
function computeRelativeLuminance(color: string): number {
  const normalized = color.replace(/\s/g, '').toLowerCase();

  /* rgb() and rgba() — alpha component is optional and ignored */
  const rgbMatch = /^rgba?\((\d+),(\d+),(\d+)(?:,[\d.]+)?\)$/.exec(normalized);

  if (rgbMatch) {
    const r = parseInt(rgbMatch[1], 10) / 255;
    const g = parseInt(rgbMatch[2], 10) / 255;
    const b = parseInt(rgbMatch[3], 10) / 255;

    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  }

  /* hsl() and hsla() — alpha component is optional and ignored */
  const hslMatch = /^hsla?\(([\d.]+),([\d.]+)%,([\d.]+)%(?:,[\d.]+)?\)$/.exec(normalized);

  if (hslMatch) {
    const h = parseFloat(hslMatch[1]) / 360;
    const s = parseFloat(hslMatch[2]) / 100;
    const l = parseFloat(hslMatch[3]) / 100;

    if (s === 0) {
      return 0.2126 * l + 0.7152 * l + 0.0722 * l; // achromatic: r = g = b = l
    }

    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    const hueToChannel = (t: number): number => {
      const wrapped = (() => {
        if (t < 0) return t + 1;
        if (t > 1) return t - 1;

        return t;
      })();

      if (wrapped < 1 / 6) { return p + (q - p) * 6 * wrapped; }
      if (wrapped < 1 / 2) { return q; }
      if (wrapped < 2 / 3) { return p + (q - p) * (2 / 3 - wrapped) * 6; }

      return p;
    };

    const r = hueToChannel(h + 1 / 3);
    const g = hueToChannel(h);
    const b = hueToChannel(h - 1 / 3);

    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  }

  const hexMatch = /^#([0-9a-f]{6}|[0-9a-f]{3})$/.exec(normalized);

  if (hexMatch) {
    const hex = hexMatch[1];
    const expand = hex.length === 3
      ? [hex[0] + hex[0], hex[1] + hex[1], hex[2] + hex[2]]
      : [hex.substring(0, 2), hex.substring(2, 4), hex.substring(4, 6)];
    const r = parseInt(expand[0], 16) / 255;
    const g = parseInt(expand[1], 16) / 255;
    const b = parseInt(expand[2], 16) / 255;

    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  }

  return -1;
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
 * Check whether a CSS background-color value is a near-black (dark mode page) background.
 * When the browser natively copies from a contenteditable in dark mode, it adds computed
 * styles including the resolved dark page background (e.g. rgb(25, 25, 24) for Blok's
 * #191918 dark background). These should not be treated as intentional marker formatting.
 *
 * Uses relative luminance < 0.12, which is below all Blok dark background presets
 * (~18% minimum lightness for #2f2f2f) while catching typical dark page backgrounds.
 */
function isDefaultDarkBackground(bgColor: string): boolean {
  const luminance = computeRelativeLuminance(bgColor);

  return luminance >= 0 && luminance < 0.12;
}

/**
 * Check whether a CSS color value is a near-white (dark mode default text) color.
 * When the browser natively copies from a contenteditable in dark mode, it includes
 * the resolved light page text color (e.g. rgb(226, 224, 220) for Blok's #e2e0dc
 * default text). These should not be treated as intentional marker formatting for
 * non-Google-Docs content.
 *
 * Uses relative luminance > 0.75, which is above all Blok text presets while
 * catching typical dark mode default text colors.
 *
 * Returns false for unrecognized color formats (luminance === -1) so unknown
 * formats are treated conservatively: they are not filtered out here, but any
 * color that cannot be parsed also cannot be mapped to a preset, so the
 * sanitizer will strip it regardless.
 */
function isDefaultLightText(color: string): boolean {
  const luminance = computeRelativeLuminance(color);

  return luminance >= 0 && luminance > 0.75;
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

  const hasColor = isGoogleDocs
    ? color !== undefined && !isDefaultBlack(color)
    : color !== undefined && !isDefaultBlack(color) && !isDefaultLightText(color);
  const hasBgColor = isGoogleDocs
    ? bgColor !== undefined && bgColor !== 'transparent'
    : bgColor !== undefined && bgColor !== 'transparent' && !isDefaultWhiteBackground(bgColor) && !isDefaultDarkBackground(bgColor);

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
