/**
 * Shared URL scheme policy for values placed into href/src attributes.
 *
 * Extracted from `src/components/utils/sanitizer.ts` so the decision logic is
 * usable both by the DOM-bound editor sanitizer and the DOM-free view
 * sanitizer (`src/view/sanitize.ts`). Pure module: no DOM access and no
 * HTML parser import — it is part of the editor bundle graph.
 */
import { isSafeRasterImageDataUrl, safeImageSrc, stripIgnoredUrlChars } from './sanitize-url';

/**
 * Script-capable schemes hard-stripped from href/src regardless of tool
 * config. Deliberately NOT a full allowlist: unknown custom schemes
 * (slack://, ftp:) in existing documents must keep working.
 */
export const SCRIPT_CAPABLE_SCHEME_PATTERN = /^(?:javascript|vbscript):/i;
export const DATA_SCHEME_PATTERN = /^data:/i;
export const BLOB_SCHEME_PATTERN = /^blob:/i;

/**
 * Attributes a browser follows as a URL, besides `href`/`src`, which the URL
 * passes check on their own. `to`/`from`/`values`/`by` are SVG animation
 * values: `<animate attributeName="href" to="javascript:…">` rewrites a link.
 */
export const OTHER_URL_ATTRIBUTES: ReadonlySet<string> = new Set([
  'xlink:href', 'action', 'formaction', 'background', 'poster', 'cite', 'data', 'codebase', 'longdesc',
  'lowsrc', 'dynsrc', 'ping', 'to', 'from', 'values', 'by',
]);

/**
 * Check whether a URL resolves to a script-capable scheme once the characters
 * browsers ignore during scheme resolution are removed — closes the
 * whitespace-smuggling class ("java\nscript:", "v\tbscript:", …).
 * @param value - raw attribute value
 * @param attribute - attribute the value belongs to ('href' or 'src')
 */
export const hasUnsafeUrlProtocol = (value: string | null, attribute: string): boolean => {
  if (!value) {
    return false;
  }

  const normalized = stripIgnoredUrlChars(value);

  if (SCRIPT_CAPABLE_SCHEME_PATTERN.test(normalized)) {
    return true;
  }

  if (DATA_SCHEME_PATTERN.test(normalized)) {
    // Raster image data: URLs cannot carry script and stay valid in src;
    // every other data: payload (text/html, svg+xml, …) can execute.
    return !(attribute === 'src' && isSafeRasterImageDataUrl(normalized));
  }

  return attribute === 'href' && BLOB_SCHEME_PATTERN.test(normalized);
};

/**
 * Whether an image URL is one Blok renders: http(s), relative, or raster data.
 * The same check as the renderers' `safeImageSrc`, so a write never stores a URL that shows blank.
 * @param url - image source
 */
export const isSafeImageUrl = (url: string): boolean => safeImageSrc(url) !== null;

/**
 * Whether every sanitizer drops this attribute, whatever its rule says: an
 * event handler, an iframe's inline document, or a URL attribute holding a
 * script-capable URL. `values` is a `;`-separated list, so each entry counts;
 * `poster` is an image, so it takes `src`'s data: rule.
 * @param name - attribute name
 * @param value - attribute value
 */
export const isScriptCarryingAttribute = (name: string, value: string): boolean => {
  const lower = name.toLowerCase();

  if (lower.startsWith('on') || lower === 'srcdoc') {
    return true;
  }

  if (lower === 'values') {
    return value.split(';').some((entry) => hasUnsafeUrlProtocol(entry.trim(), lower));
  }

  if (lower !== 'href' && lower !== 'src' && !OTHER_URL_ATTRIBUTES.has(lower)) {
    return false;
  }

  return hasUnsafeUrlProtocol(value, lower === 'poster' ? 'src' : lower);
};
