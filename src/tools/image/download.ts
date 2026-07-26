import { safeDownloadHref } from '../../components/utils/sanitize-url';

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
  const safeUrl = safeDownloadHref(url);

  if (safeUrl === null) {
    return;
  }

  try {
    const response = await fetch(safeUrl);
    if (!response.ok) throw new Error(`Failed to fetch image: ${response.status}`);
    const blob = await response.blob();
    const objectUrl = URL.createObjectURL(blob);
    triggerAnchorDownload(objectUrl, fileName);
    URL.revokeObjectURL(objectUrl);
  } catch {
    triggerAnchorDownload(safeUrl, fileName);
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
