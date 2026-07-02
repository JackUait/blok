/**
 * Trigger a browser download for an image.
 *
 * A cross-origin `<a download>` is ignored by browsers, so the file just opens
 * in a new tab instead of downloading. To force an actual download we fetch the
 * image, wrap it in a same-origin object URL (where `download` is honored), and
 * click an anchor pointing at that. When the fetch is blocked (CORS) we fall
 * back to a direct anchor — without `target="_blank"` so it never opens a page.
 */
export async function downloadImage(url: string, fileName?: string): Promise<void> {
  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Failed to fetch image: ${response.status}`);
    const blob = await response.blob();
    const objectUrl = URL.createObjectURL(blob);
    triggerAnchorDownload(objectUrl, fileName);
    URL.revokeObjectURL(objectUrl);
  } catch {
    triggerAnchorDownload(url, fileName);
  }
}

function triggerAnchorDownload(href: string, fileName?: string): void {
  const a = document.createElement('a');
  a.href = href;
  a.download = fileName ?? '';
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
}
