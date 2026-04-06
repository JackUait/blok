/**
 * Preprocess old knowledgebase HTML before block conversion.
 *
 * Fixes issues from the old KB's Summernote editor:
 * 1. `<div style="background: rgb(...)">` callout-like blocks → `<aside>`
 * 2. White/transparent `background-color` on inline elements → stripped
 * 3. Multiple `<p>` inside table cells → `<br>`-separated content
 * 4. `<p>&nbsp;</p>` visual spacers → removed
 * 5. `<del>`/`<strike>` → `<s>` (Blok only recognises `<s>`)
 * 6. `<p>• text</p>` pseudo-lists → `<ul><li>text</li></ul>`
 *
 * Adapted from the knowledgebase frontend's preprocessKnowledgebaseHtml
 * for use with jsdom's DOM API in a Node.js CLI tool.
 */
export function preprocess(wrapper: HTMLElement): void {
  convertBackgroundDivsToCallouts(wrapper);
  stripSpuriousBackgroundColors(wrapper);
  convertTableCellParagraphs(wrapper);
  stripNbspOnlyParagraphs(wrapper);
  convertStrikethroughTags(wrapper);
  convertBulletParagraphsToLists(wrapper);
}

/**
 * Convert block-level `<div>` elements with background colors to `<aside>`.
 *
 * Skips divs inside tables and those with white/transparent backgrounds.
 * Unwraps non-semantic inner `<div>` wrappers and strips trailing `<br>`
 * inside paragraphs.
 */
function convertBackgroundDivsToCallouts(wrapper: HTMLElement): void {
  const doc = wrapper.ownerDocument;

  for (const div of Array.from(wrapper.querySelectorAll<HTMLElement>('div[style]'))) {
    if (div.closest('table')) {
      continue;
    }

    const bgColor = getBackgroundColor(div);

    if (!bgColor || isSpuriousBackgroundColor(bgColor)) {
      continue;
    }

    const aside = doc.createElement('aside');

    aside.style.backgroundColor = bgColor;
    aside.append(...Array.from(div.childNodes));

    // Unwrap non-semantic <div> wrappers so the aside's direct children are
    // the content elements (<p>, <a>, etc.), not intermediate <div> shells.
    let bareDivs: HTMLElement[];

    while ((bareDivs = Array.from(aside.querySelectorAll<HTMLElement>(':scope > div'))
      .filter((d) => !d.getAttribute('style') && !d.getAttribute('class'))).length > 0) {
      for (const child of bareDivs) {
        child.replaceWith(...Array.from(child.childNodes));
      }
    }

    // Strip trailing <br> inside paragraphs — the paste handler splits
    // content at <br> boundaries, so a trailing one creates an empty block.
    for (const p of Array.from(aside.querySelectorAll('p'))) {
      const lastChild = p.lastElementChild;

      if (lastChild?.tagName === 'BR') {
        lastChild.remove();
      }
    }

    div.replaceWith(aside);
  }
}

/**
 * Minimum channel brightness for a colour to be considered "near-white".
 *
 * Any `rgb(r, g, b)` where all three channels are >= this value is stripped.
 */
const NEAR_WHITE_MIN_CHANNEL = 250;

/**
 * Remove white/transparent `background-color` from inline elements.
 *
 * After stripping the property, empty wrapper elements (no remaining styles
 * and no text) are unwrapped.
 */
function stripSpuriousBackgroundColors(wrapper: HTMLElement): void {
  const candidates = wrapper.querySelectorAll<HTMLElement>('[style*="background-color"]');

  for (const el of Array.from(candidates)) {
    if (isSpuriousBackgroundColor(el.style.backgroundColor)) {
      el.style.removeProperty('background-color');

      if (el.getAttribute('style')?.trim() === '') {
        el.removeAttribute('style');
      }

      if (isEmptyWrapper(el)) {
        el.replaceWith(...Array.from(el.childNodes));
      }
    }
  }
}

/**
 * Check whether a computed `background-color` value is visually invisible
 * (white, near-white, or transparent).
 */
function isSpuriousBackgroundColor(value: string): boolean {
  if (!value) {
    return false;
  }

  const normalised = value.replace(/\s/g, '').toLowerCase();

  if (normalised === 'transparent') {
    return true;
  }

  const rgbaMatch = normalised.match(/^rgba?\((\d+),(\d+),(\d+)(?:,([^)]+))?\)$/);

  if (!rgbaMatch) {
    return false;
  }

  const alpha = rgbaMatch[4] !== undefined ? parseFloat(rgbaMatch[4]) : 1;

  if (alpha === 0) {
    return true;
  }

  const r = parseInt(rgbaMatch[1], 10);
  const g = parseInt(rgbaMatch[2], 10);
  const b = parseInt(rgbaMatch[3], 10);

  return r >= NEAR_WHITE_MIN_CHANNEL && g >= NEAR_WHITE_MIN_CHANNEL && b >= NEAR_WHITE_MIN_CHANNEL;
}

/**
 * Check whether an element is a pure wrapper with no semantic value
 * (no attributes and no text content, or just whitespace).
 */
function isEmptyWrapper(el: HTMLElement): boolean {
  if (el.attributes.length > 0) {
    return false;
  }

  const text = (el.textContent ?? '').replace(/[\s\u00A0]/g, '');

  return text.length === 0;
}

/**
 * Extract `background-color` from an element's style attribute.
 *
 * Handles both `background-color:` and `background:` (shorthand) properties.
 * Uses the element's computed style property first, falling back to manual
 * parsing of the style attribute for shorthand notation.
 */
function getBackgroundColor(el: HTMLElement): string {
  // Try the direct property first
  if (el.style.backgroundColor) {
    return el.style.backgroundColor;
  }

  // Fall back to parsing the style attribute for shorthand `background:`
  const styleAttr = el.getAttribute('style') ?? '';
  const match = styleAttr.match(/background:\s*([^;]+)/i);

  if (match) {
    const value = match[1].trim();
    // Only return color values, not url() or other background sub-properties
    const colorMatch = value.match(/^(rgb[a]?\([^)]+\)|#[0-9a-fA-F]{3,8}|[a-z]+)$/i);

    if (colorMatch) {
      return colorMatch[1];
    }
  }

  return '';
}

/**
 * Convert `<p>` boundaries to `<br>` line breaks inside table cells.
 *
 * Only targets `<td>` and `<th>` — top-level `<p>` tags are left intact.
 */
function convertTableCellParagraphs(wrapper: HTMLElement): void {
  const doc = wrapper.ownerDocument;

  for (const cell of Array.from(wrapper.querySelectorAll('td, th'))) {
    const paragraphs = cell.querySelectorAll('p');

    if (paragraphs.length === 0) {
      continue;
    }

    for (const p of Array.from(paragraphs)) {
      if (p.innerHTML.trim() === '' || p.innerHTML.trim() === '&nbsp;') {
        p.remove();
        continue;
      }

      const fragment = doc.createDocumentFragment();

      fragment.append(...Array.from(p.childNodes));
      fragment.append(doc.createElement('br'));
      p.replaceWith(fragment);
    }

    stripTrailingBreaks(cell);
  }
}

/**
 * Remove paragraphs whose only content is non-breaking spaces or whitespace.
 */
function stripNbspOnlyParagraphs(wrapper: HTMLElement): void {
  for (const p of Array.from(wrapper.querySelectorAll('p'))) {
    // Skip paragraphs inside table cells — those are handled by convertTableCellParagraphs
    if (p.closest('td') || p.closest('th')) {
      continue;
    }

    const textContent = p.textContent ?? '';
    const stripped = textContent.replace(/[\s\u00A0]/g, '');

    if (stripped.length === 0) {
      p.remove();
    }
  }
}

/**
 * Convert `<del>` and `<strike>` elements to `<s>`.
 */
function convertStrikethroughTags(wrapper: HTMLElement): void {
  const doc = wrapper.ownerDocument;

  for (const el of Array.from(wrapper.querySelectorAll('del, strike'))) {
    const replacement = doc.createElement('s');

    replacement.append(...Array.from(el.childNodes));
    el.replaceWith(replacement);
  }
}

/**
 * Bullet characters that indicate a pseudo-list paragraph.
 *
 * Matches: `\u2022` (bullet), `\u00B7` (middle dot), or `- ` (hyphen + space).
 */
const BULLET_PREFIX = /^[\u2022\u00B7][\s\u00A0]*|^-\s/;

/**
 * Convert `<p>• text</p>` pseudo-lists into proper `<ul><li>` markup.
 *
 * Groups consecutive bullet paragraphs into a single `<ul>` and strips
 * the bullet prefix. Only processes direct children of the wrapper.
 */
function convertBulletParagraphsToLists(wrapper: HTMLElement): void {
  const doc = wrapper.ownerDocument;
  const children = Array.from(wrapper.childNodes);
  let currentList: HTMLUListElement | null = null;

  for (const child of children) {
    if (child.nodeType !== Node.ELEMENT_NODE) {
      continue;
    }

    const el = child as HTMLElement;

    if (el.tagName !== 'P') {
      currentList = null;
      continue;
    }

    const textContent = el.textContent ?? '';

    if (!BULLET_PREFIX.test(textContent)) {
      currentList = null;
      continue;
    }

    if (!currentList) {
      currentList = doc.createElement('ul');
      el.before(currentList);
    }

    const li = doc.createElement('li');

    // Strip the bullet character and any leading nbsp/whitespace from
    // the first text node, preserving any inline HTML that follows.
    const firstTextNode = findFirstTextNode(el);

    if (firstTextNode) {
      firstTextNode.textContent = (firstTextNode.textContent ?? '').replace(BULLET_PREFIX, '');
    }

    li.append(...Array.from(el.childNodes));
    currentList.appendChild(li);
    el.remove();
  }
}

/**
 * Remove trailing `<br>` elements and whitespace-only text nodes from the end
 * of an element.
 */
function stripTrailingBreaks(element: Element): void {
  let node = element.lastChild;

  while (node) {
    if (node.nodeType === Node.ELEMENT_NODE && (node as Element).tagName === 'BR') {
      const prev = node.previousSibling;

      node.remove();
      node = prev;
    } else if (node.nodeType === Node.TEXT_NODE && node.textContent?.trim() === '') {
      const prev = node.previousSibling;

      node.remove();
      node = prev;
    } else {
      break;
    }
  }
}

/**
 * Walk the DOM tree depth-first to find the first Text node.
 */
function findFirstTextNode(node: Node): Text | null {
  if (node.nodeType === Node.TEXT_NODE) {
    return node as Text;
  }

  for (const child of Array.from(node.childNodes)) {
    const found = findFirstTextNode(child);

    if (found) {
      return found;
    }
  }

  return null;
}
