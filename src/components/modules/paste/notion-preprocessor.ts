/**
 * Pre-process Notion clipboard HTML before sanitization.
 *
 * Notion encodes block/inline state with classes (`to-do-list`, `checkbox-on`,
 * `toggle`, `callout`, `block-color-*`) and non-semantic markup that Blok's
 * sanitizer strips.  This function rewrites that markup into Blok's allowed
 * semantic tag set BEFORE the sanitizer runs.  It mirrors
 * `preprocessGoogleDocsHtml` and is a no-op when the source is not Notion.
 *
 * Scope note: this is the HTML *fallback* path (Notion desktop app /
 * cross-browser paste).  The higher-fidelity path parses Notion's proprietary
 * `text/_notion-blocks-v3-production` JSON flavor directly when present
 * (web→web); see docs/plans/2026-06-22-notion-paste-migration-design.md §4.1b.
 *
 * @param html - raw clipboard HTML string
 * @returns preprocessed HTML string (unchanged when not Notion)
 */
export function preprocessNotionHtml(html: string): string {
  const wrapper = document.createElement('div');

  wrapper.innerHTML = html;

  if (!isNotionClipboard(wrapper)) {
    return html;
  }

  normalizeInlineMarks(wrapper);

  return wrapper.innerHTML;
}

/**
 * Centralized Notion clipboard signature.  This is the ONE place to update
 * when Notion changes its class names.
 */
const NOTION_SIGNATURE_SELECTOR = [
  'figure.callout',
  'ul.to-do-list',
  'ul.toggle',
  'ol.numbered-list',
  'ul.bulleted-list',
  '.notion-text-equation-token',
  '[class*="block-color-"]',
  'figure.equation',
].join(', ');

/**
 * Whether the pasted markup originated from Notion.
 */
function isNotionClipboard(wrapper: HTMLElement): boolean {
  return wrapper.querySelector(NOTION_SIGNATURE_SELECTOR) !== null;
}

/**
 * Rewrite inline marks that Blok's sanitizer strips into allowed equivalents.
 *
 * Notion emits strikethrough as `<del>`/`<strike>`, but Blok's strikethrough
 * inline tool only whitelists `<s>` — so the others are dropped unless rewritten.
 */
function normalizeInlineMarks(wrapper: HTMLElement): void {
  wrapper.querySelectorAll('del, strike').forEach((el) => {
    const s = document.createElement('s');

    s.innerHTML = el.innerHTML;
    el.replaceWith(s);
  });
}
