import { safeHref, safeImageSrc } from '../components/utils/sanitize-url';

/**
 * Block-level raw HTML in a Markdown document (e.g. a README's centred-logo
 * `<p align="center"><img></p>`) is rendered through a strict allowlist rather
 * than escaped, so common layout markup survives while script-bearing tags do
 * not. Inline raw HTML stays escaped at the caller — balancing split open/close
 * tag fragments through a sanitizer is unsafe.
 */
const ALLOWED_TAGS = [
  'p', 'div', 'span', 'a', 'img', 'picture', 'source',
  'strong', 'em', 'b', 'i', 'u', 's', 'del', 'ins', 'mark', 'small', 'abbr',
  'code', 'pre', 'kbd', 'samp', 'br', 'hr', 'sub', 'sup',
  'ul', 'ol', 'li', 'dl', 'dt', 'dd', 'blockquote',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td', 'caption',
  'figure', 'figcaption', 'details', 'summary',
];

const ALLOWED_ATTR = [
  'href', 'src', 'alt', 'title', 'align', 'width', 'height',
  'colspan', 'rowspan', 'start', 'open',
];

interface PurifyHookNode {
  tagName?: string;
  getAttribute(name: string): string | null;
  setAttribute(name: string, value: string): void;
  removeAttribute(name: string): void;
  hasAttribute(name: string): boolean;
}

interface PurifyLike {
  sanitize(dirty: string, config: Record<string, unknown>): string;
  addHook(entryPoint: string, cb: (node: PurifyHookNode) => void): void;
}

/** Resolve a possibly-relative URL against the document's base, if known. */
function resolveUrl(url: string, base: string | undefined): string {
  if (base === undefined || base === '') {
    return url;
  }
  try {
    return new URL(url, base).href;
  } catch {
    return url;
  }
}

// `current.base` is read by the synchronous afterSanitizeAttributes hook. Because
// DOMPurify.sanitize runs synchronously, setting it immediately before each call
// is race-free even across concurrent renders. A const holder lets the hook share
// the active base without module-level reassignment. `current.purify` memoizes the
// loaded DOMPurify instance so the dynamic import and hook registration happen once.
const current: { base: string | undefined; purify: Promise<PurifyLike> | null } = {
  base: undefined,
  purify: null,
};

/** Harden a sanitized anchor: resolve its href, drop unsafe schemes, prevent tab-nabbing. */
function hardenAnchor(node: PurifyHookNode): void {
  if (node.tagName !== 'A' || !node.hasAttribute('href')) {
    return;
  }
  const safe = safeHref(resolveUrl(node.getAttribute('href') ?? '', current.base));
  if (safe === null) {
    node.removeAttribute('href');

    return;
  }
  node.setAttribute('href', safe);
  node.setAttribute('target', '_blank');
  node.setAttribute('rel', 'noopener noreferrer nofollow');
}

/** Harden a sanitized image: strip srcset and resolve/validate its src. */
function hardenImage(node: PurifyHookNode): void {
  if (node.tagName !== 'IMG') {
    return;
  }
  node.removeAttribute('srcset');
  if (!node.hasAttribute('src')) {
    return;
  }
  const safe = safeImageSrc(resolveUrl(node.getAttribute('src') ?? '', current.base));
  if (safe === null) {
    node.removeAttribute('src');
  } else {
    node.setAttribute('src', safe);
  }
}

async function getPurify(): Promise<PurifyLike> {
  if (current.purify === null) {
    current.purify = import('dompurify').then(({ default: DOMPurify }) => {
      const purify = DOMPurify as unknown as PurifyLike;

      // Re-apply Blok's URL policy after sanitizing: resolve relative URLs to
      // absolute, drop unsafe schemes, and harden anchors against tab-nabbing.
      purify.addHook('afterSanitizeAttributes', (node) => {
        hardenAnchor(node);
        hardenImage(node);
      });

      return purify;
    });
  }

  return current.purify;
}

/**
 * Sanitize a block of raw HTML to a safe subset. Relative `href`/`src` values
 * are resolved against `baseUrl` (the source document's URL) so README-relative
 * assets load. Script-capable tags/attributes and unsafe URL schemes are
 * stripped.
 */
export async function sanitizeBlockHtml(raw: string, baseUrl?: string): Promise<string> {
  const purify = await getPurify();

  current.base = baseUrl;

  return purify.sanitize(raw, {
    ALLOWED_TAGS,
    ALLOWED_ATTR,
    FORBID_ATTR: ['style'],
    ALLOW_DATA_ATTR: false,
  });
}
