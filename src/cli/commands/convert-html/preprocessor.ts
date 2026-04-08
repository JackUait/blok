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
    unwrapBareDivs(aside);

    // Strip trailing <br> inside paragraphs — the paste handler splits
    // content at <br> boundaries, so a trailing one creates an empty block.
    stripTrailingBrInParagraphs(aside);

    div.replaceWith(aside);
  }
}

/**
 * Repeatedly unwrap non-semantic `<div>` wrappers (no style or class) that are
 * direct children of the given element, replacing them with their child nodes.
 */
function unwrapBareDivs(parent: HTMLElement): void {
  for (;;) {
    const bareDivs = Array.from(parent.querySelectorAll<HTMLElement>(':scope > div'))
      .filter((d) => !d.getAttribute('style') && !d.getAttribute('class'));

    if (bareDivs.length === 0) {
      break;
    }

    for (const child of bareDivs) {
      child.replaceWith(...Array.from(child.childNodes));
    }
  }
}

/**
 * Remove trailing `<br>` elements from paragraphs inside the given element.
 */
function stripTrailingBrInParagraphs(parent: HTMLElement): void {
  for (const p of Array.from(parent.querySelectorAll('p'))) {
    const lastChild = p.lastElementChild;

    if (lastChild?.tagName === 'BR') {
      lastChild.remove();
    }
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
    if (!isSpuriousBackgroundColor(el.style.backgroundColor)) {
      continue;
    }

    el.style.removeProperty('background-color');

    if (el.getAttribute('style')?.trim() === '') {
      el.removeAttribute('style');
    }

    if (isEmptyWrapper(el)) {
      el.replaceWith(...Array.from(el.childNodes));
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
  for (const cell of Array.from(wrapper.querySelectorAll('td, th'))) {
    const paragraphs = cell.querySelectorAll('p');

    if (paragraphs.length === 0) {
      continue;
    }

    for (const p of Array.from(paragraphs)) {
      replaceParagraphWithBr(p);
    }

    stripTrailingBreaks(cell);
  }
}

/**
 * Replace a `<p>` element with its child nodes followed by a `<br>`,
 * or remove it entirely if it is empty / nbsp-only.
 */
function replaceParagraphWithBr(p: HTMLParagraphElement): void {
  if (p.innerHTML.trim() === '' || p.innerHTML.trim() === '&nbsp;') {
    p.remove();

    return;
  }

  const doc = p.ownerDocument;
  const fragment = doc.createDocumentFragment();

  fragment.append(...Array.from(p.childNodes));
  fragment.append(doc.createElement('br'));
  p.replaceWith(fragment);
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

  // Collect runs of consecutive bullet paragraphs. Each run is a group
  // that will become a single <ul>.
  const groups = collectBulletGroups(wrapper);

  for (const group of groups) {
    const ul = doc.createElement('ul');

    group[0].before(ul);

    for (const p of group) {
      convertBulletParagraphToListItem(p, ul);
    }
  }
}

/**
 * Strip the bullet prefix from a paragraph and append its content as
 * a `<li>` to the given list.
 */
function convertBulletParagraphToListItem(p: HTMLParagraphElement, ul: HTMLUListElement): void {
  const li = p.ownerDocument.createElement('li');

  // Strip the bullet character and any leading nbsp/whitespace from
  // the first text node, preserving any inline HTML that follows.
  const firstTextNode = findFirstTextNode(p);

  if (firstTextNode) {
    firstTextNode.textContent = (firstTextNode.textContent ?? '').replace(BULLET_PREFIX, '');
  }

  li.append(...Array.from(p.childNodes));
  ul.appendChild(li);
  p.remove();
}

/**
 * Walk direct children of an element and return groups of consecutive `<p>`
 * elements whose text starts with a bullet character.
 */
function collectBulletGroups(wrapper: HTMLElement): HTMLParagraphElement[][] {
  const groups: HTMLParagraphElement[][] = [];
  const children = Array.from(wrapper.childNodes);

  for (const child of children) {
    if (child.nodeType !== Node.ELEMENT_NODE) {
      continue;
    }

    const el = child as HTMLElement;
    const isBulletParagraph = el.tagName === 'P' && BULLET_PREFIX.test(el.textContent ?? '');

    if (!isBulletParagraph) {
      continue;
    }

    const lastGroup = groups[groups.length - 1];
    const previousSibling = findPreviousElementSibling(el);
    const belongsToCurrentGroup = lastGroup
      && previousSibling !== null
      && lastGroup[lastGroup.length - 1] === previousSibling;

    if (belongsToCurrentGroup) {
      lastGroup.push(el as HTMLParagraphElement);
    } else {
      groups.push([el as HTMLParagraphElement]);
    }
  }

  return groups;
}

/**
 * Find the previous sibling that is an element, skipping non-element nodes.
 */
function findPreviousElementSibling(el: HTMLElement): Element | null {
  const prev = el.previousSibling;

  if (!prev) {
    return null;
  }

  if (prev.nodeType === Node.ELEMENT_NODE) {
    return prev as Element;
  }

  return null;
}

/**
 * Remove trailing `<br>` elements and whitespace-only text nodes from the end
 * of an element.
 */
function stripTrailingBreaks(element: Element): void {
  for (;;) {
    const node = element.lastChild;

    if (!node) {
      break;
    }

    const isBr = node.nodeType === Node.ELEMENT_NODE && (node as Element).tagName === 'BR';
    const isBlankText = node.nodeType === Node.TEXT_NODE && node.textContent?.trim() === '';

    if (!isBr && !isBlankText) {
      break;
    }

    node.remove();
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
