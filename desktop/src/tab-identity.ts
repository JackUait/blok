import { isImageIcon } from '../../src/shell/page-icon';

/** Fallback brand, used until the server names the instance. */
export const APP_NAME = 'Blok';

/** The Blok mark — the drawing alone, no lettering, unreadable at 16px. */
export const BLOK_MARK_HREF = '/favicon-128x128.png';

const OWNED = 'data-desktop-favicon';

/**
 * A page icon is one glyph. Anything carrying ASCII letters is prose — an
 * unresolved placeholder, a stray paste — and drawing it into a 64px square
 * gives a smudge rather than an icon, so the mark serves instead. Keycaps
 * (1️⃣, #️⃣) keep their ASCII digit and sign, which is why only letters count.
 */
const PROSE = /[A-Za-z]/;
const GLYPH_LIMIT = 24;

function escapeXml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** What `<link rel="icon">` should point at for a page carrying `icon`. */
export function faviconHref(icon: string | undefined): string {
  const value = icon?.trim();
  if (!value) return BLOK_MARK_HREF;
  // Same test as the sidebar's: an icon drawn as an image there is an image here.
  if (isImageIcon(value)) return value;
  if (value.length > GLYPH_LIMIT || PROSE.test(value)) return BLOK_MARK_HREF;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">`
    + `<text x="32" y="34" font-size="56" text-anchor="middle" dominant-baseline="central">`
    + `${escapeXml(value)}</text></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

/**
 * Point the browser tab at `icon`, the way Notion shows the open page's emoji.
 *
 * One owned link, and the static ones from `index.html` go when it appears:
 * with several `rel="icon"` links a browser picks by best size match, so the
 * 128px mark could outrank an unsized emoji and the tab would never change.
 * The static set still covers the window before this module runs.
 */
export function applyFavicon(icon: string | undefined, doc: Document = document): void {
  const href = faviconHref(icon);
  const link = doc.head.querySelector<HTMLLinkElement>(`link[${OWNED}]`) ?? claimIconLink(doc);
  if (link.getAttribute('href') !== href) link.setAttribute('href', href);
}

function claimIconLink(doc: Document): HTMLLinkElement {
  doc.head.querySelectorAll('link[rel~="icon"]').forEach((node) => node.remove());
  const link = doc.createElement('link');
  link.rel = 'icon';
  link.setAttribute(OWNED, '');
  doc.head.append(link);
  return link;
}

/**
 * Title for a screen that is not a page. A page puts its own title in the tab
 * — bare, as Notion does — so the brand only shows where there is none.
 */
export function brandedTitle(label: string, brand: string = APP_NAME): string {
  const name = brand.trim() || APP_NAME;
  const screen = label.trim();
  return screen ? `${name} — ${screen}` : name;
}
