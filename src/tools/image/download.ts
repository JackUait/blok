import { safeDownloadHref, stripIgnoredUrlChars } from '../../components/utils/sanitize-url';
import { createSafeObjectUrl } from '../../shared/safe-object-url';

/**
 * Trigger a browser download for an image.
 *
 * A cross-origin `<a download>` is ignored by browsers, so the file just opens
 * in a new tab instead of downloading. To force an actual download we fetch the
 * image, wrap it in a same-origin object URL (where `download` is honored), and
 * click an anchor pointing at that. When the fetch is blocked (CORS) we fall
 * back to a direct anchor — without `target="_blank"` so it never opens a page.
 *
 * The stored URL is scheme-gated first: that fallback anchor would otherwise
 * carry a persisted `javascript:` URL straight into a click (stored XSS).
 */
export async function downloadImage(url: string, fileName?: string): Promise<void> {
  if (SVG_DATA.test(stripIgnoredUrlChars(url))) {
    downloadSvgData(url, fileName);

    return;
  }

  const safeUrl = safeDownloadHref(url);

  if (safeUrl === null) {
    return;
  }

  try {
    const response = await fetch(safeUrl);
    if (!response.ok) throw new Error(`Failed to fetch image: ${response.status}`);
    const blob = await response.blob();
    const objectUrl = createSafeObjectUrl(blob, { svgImage: true });
    triggerAnchorDownload(objectUrl, fileName);
    URL.revokeObjectURL(objectUrl);
  } catch {
    triggerAnchorDownload(safeUrl, fileName);
  }
}

const SVG_DATA = /^data:image\/svg\+xml[;,]/i;

/**
 * A no-uploader SVG is a data: URL (see localImageUrl). It must never sit on
 * an anchor: opened as a page it runs its script. So its bytes go into a
 * blob that only a plain `download` click uses. Decoded here, not fetched,
 * so a host CSP without `connect-src data:` still downloads it.
 */
function downloadSvgData(url: string, fileName?: string): void {
  const clean = stripIgnoredUrlChars(url);
  const comma = clean.indexOf(',');
  const payload = clean.slice(comma + 1);

  try {
    const bytes = /;base64$/i.test(clean.slice(0, comma))
      ? Uint8Array.from(atob(payload), (char) => char.charCodeAt(0))
      : new TextEncoder().encode(decodeURIComponent(payload));
    const objectUrl = createSafeObjectUrl(new Blob([bytes], { type: 'image/svg+xml' }), { svgImage: true });

    triggerAnchorDownload(objectUrl, fileName);
    URL.revokeObjectURL(objectUrl);
  } catch {
    // Bytes that do not decode: nothing to save.
  }
}

function triggerAnchorDownload(href: string, fileName?: string): void {
  // Both call sites pass an already-gated URL; re-gating here keeps the sink
  // safe by construction rather than by caller discipline.
  const safe = safeDownloadHref(href);

  if (safe === null) {
    return;
  }

  const a = document.createElement('a');
  a.href = safe;
  a.download = fileName ?? '';
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
}
