/**
 * Shared URL scheme policy for values placed into href/src attributes.
 *
 * Extracted from `src/components/utils/sanitizer.ts` so the decision logic is
 * usable both by the DOM-bound editor sanitizer and the DOM-free view
 * sanitizer (`src/view/sanitize.ts`). Pure module: no DOM access and no
 * parse5 import — it is part of the editor bundle graph.
 */
import { isSafeRasterImageDataUrl, stripIgnoredUrlChars } from '../components/utils/sanitize-url';

/**
 * Script-capable schemes hard-stripped from href/src regardless of tool
 * config. Deliberately NOT a full allowlist: unknown custom schemes
 * (slack://, ftp:) in existing documents must keep working.
 */
export const SCRIPT_CAPABLE_SCHEME_PATTERN = /^(?:javascript|vbscript):/i;
export const DATA_SCHEME_PATTERN = /^data:/i;
export const BLOB_SCHEME_PATTERN = /^blob:/i;

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
