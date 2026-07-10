/**
 * Recover collapsed toggles from GitHub-flavored-markdown (GFM) clipboard HTML.
 *
 * buildin.ai and Notion serialize a toggle into their lossy `text/html` twin as
 * a single-item bullet list whose one `<li>` carries the toggle title followed
 * by its revealed body blocks:
 *
 *   <ul><li><p>Toggle title</p><p>body…</p></li></ul>
 *
 * When the lossless JSON flavour is absent (e.g. a partial selection that ships
 * only the GFM twin), this markup is all Blok receives, and the `<ul>` is
 * claimed by the list tool — so the toggle arrives as a bullet list.
 *
 * This preprocessor rewrites that ONE structure into `<details><summary>` so the
 * HTML handler's existing DETAILS expansion turns it into a Blok toggle (title +
 * child blocks). It is deliberately narrow: only a SINGLE-item `<ul>` whose lone
 * `<li>` holds a `<p>` title plus at least one NON-LIST block sibling qualifies.
 * Every ordinary bullet list differs — it is multi-item, holds a single block,
 * or nests its children as a sub-`<ul>`/`<ol>` (which stays a list here) — so a
 * genuine bullet list is never converted into a toggle.
 */

import { Dom as dom$ } from '../../dom';

/** Block tags that, as the body of a single-item `<li>`, mark it as a toggle. */
const NON_LIST_BODY_TAGS = new Set(['P', 'BLOCKQUOTE', 'PRE', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'DETAILS', 'TABLE']);

/**
 * Rewrite GFM single-item toggle lists into `<details>` elements. Returns the
 * input unchanged when no such structure is present (the common case).
 *
 * @param html - raw clipboard HTML (already past any source-specific preprocess)
 * @returns HTML with recovered toggles, or the original string when none match
 */
export function recoverGfmToggles(html: string): string {
  if (!html || !/<ul[\s>]/i.test(html)) {
    return html;
  }

  const wrapper = dom$.make('div');

  wrapper.innerHTML = html;

  const recovered = Array.from(wrapper.querySelectorAll('ul')).map((ul) => {
    // The static NodeList still references lists that a prior replacement may
    // have detached from the working tree; skip those (`wrapper.contains`, not
    // `isConnected` — the wrapper itself is never attached to a document).
    const details = wrapper.contains(ul) ? toggleFromList(ul) : null;

    if (details !== null) {
      ul.replaceWith(details);
    }

    return details;
  });

  return recovered.some((details) => details !== null) ? wrapper.innerHTML : html;
}

/**
 * Build a `<details>` from a `<ul>` when it matches the GFM toggle shape, else
 * `null`. The shape: exactly one `<li>`, whose children are all elements (no
 * bare text), the first a `<p>` title, with 2+ children of which at least one
 * non-title child is a non-list block.
 */
function toggleFromList(ul: HTMLUListElement): HTMLElement | null {
  if (ul.children.length !== 1) {
    return null;
  }

  const li = ul.firstElementChild;

  if (li === null || li.tagName !== 'LI') {
    return null;
  }

  // Bare (non-whitespace) text directly under the <li> means a normal bullet
  // whose label is inline text — not the block-structured toggle body.
  const hasInlineText = Array.from(li.childNodes).some(
    (node) => node.nodeType === Node.TEXT_NODE && (node.textContent ?? '').trim() !== ''
  );

  if (hasInlineText) {
    return null;
  }

  const children = Array.from(li.children);
  const [title, ...body] = children;

  if (children.length < 2 || title === undefined || title.tagName !== 'P') {
    return null;
  }

  // A body made up only of nested lists is an ordinary bullet with sub-items;
  // require at least one non-list block for it to read as a toggle's revealed
  // content.
  if (!body.some((el) => NON_LIST_BODY_TAGS.has(el.tagName))) {
    return null;
  }

  const details = dom$.make('details');

  details.setAttribute('open', '');

  const summary = dom$.make('summary');

  summary.innerHTML = title.innerHTML;
  details.appendChild(summary);
  body.forEach((el) => details.appendChild(el));

  return details;
}
