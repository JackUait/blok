/**
 * Google Drive share-link recognition for the audio tool.
 *
 * Drive blocks browser hotlinking server-side (any request carrying
 * `Sec-Fetch-Site: cross-site` gets a 403 HTML page), so the normalized URL
 * is only useful to a backend fetch via the consumer's `uploadByUrl` hook.
 * `confirm=t` skips the virus-scan interstitial Drive shows for large files.
 */

const FILE_PATH_PATTERN = /^\/file\/d\/([\w-]+)/;

/**
 * Returns the direct-download URL for a Google Drive share link, or null when
 * the input is not a Drive file link.
 */
export function googleDriveDirectDownloadUrl(raw: string): string | null {
  const url = ((): URL | null => {
    try {
      return new URL(raw);
    } catch {
      return null;
    }
  })();
  if (url === null || url.hostname !== 'drive.google.com') return null;

  const id = FILE_PATH_PATTERN.exec(url.pathname)?.[1]
    ?? (url.pathname === '/open' ? url.searchParams.get('id') : null);
  if (!id) return null;

  return `https://drive.usercontent.google.com/download?id=${id}&export=download&confirm=t`;
}
