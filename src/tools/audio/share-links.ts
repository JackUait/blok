/**
 * Share-link recognition for the audio tool.
 *
 * Users paste share-page URLs from file-hosting services; those pages are
 * HTML, not audio. Each recognizer below rewrites a share link into the
 * service's direct-content URL so the `<audio>` element (or the consumer's
 * `uploadByUrl` backend) receives a playable stream.
 *
 * `requiresProxy` marks services that block browser hotlinking server-side
 * (Google Drive rejects any request carrying `Sec-Fetch-Site: cross-site`),
 * so their direct URL is only useful to a backend fetch via `uploadByUrl`.
 */

export interface NormalizedShareLink {
  /** Direct-content URL to stream or hand to `uploadByUrl`. */
  url: string;
  service: 'google-drive' | 'dropbox' | 'onedrive' | 'github' | 'gitlab' | 'huggingface' | 'gcs' | 'internet-archive';
  /** True when the URL only works from a backend fetch, never the browser. */
  requiresProxy: boolean;
}

const DRIVE_FILE_PATH = /^\/file\/d\/([\w-]+)/;

function parseUrl(raw: string): URL | null {
  try {
    return new URL(raw);
  } catch {
    return null;
  }
}

/** `confirm=t` skips the virus-scan interstitial Drive shows for large files. */
function googleDrive(url: URL): NormalizedShareLink | null {
  if (url.hostname !== 'drive.google.com') return null;

  const id = DRIVE_FILE_PATH.exec(url.pathname)?.[1]
    ?? (url.pathname === '/open' ? url.searchParams.get('id') : null);
  if (!id) return null;

  return {
    url: `https://drive.usercontent.google.com/download?id=${id}&export=download&confirm=t`,
    service: 'google-drive',
    requiresProxy: true,
  };
}

/** Legacy `/s/` and current `/scl/fi/` links serve raw bytes from the dl host. */
function dropbox(url: URL): NormalizedShareLink | null {
  if (url.hostname !== 'www.dropbox.com' && url.hostname !== 'dropbox.com') return null;
  if (!url.pathname.startsWith('/s/') && !url.pathname.startsWith('/scl/fi/')) return null;

  const direct = new URL(url.href);

  direct.hostname = 'dl.dropboxusercontent.com';
  direct.searchParams.delete('dl');

  return { url: direct.href, service: 'dropbox', requiresProxy: false };
}

/**
 * The OneDrive shares API accepts any share URL encoded as a base64url
 * token: `u!<token>/root/content` 302-redirects to the file bytes.
 */
function onedrive(url: URL): NormalizedShareLink | null {
  if (url.hostname !== '1drv.ms' && url.hostname !== 'onedrive.live.com') return null;

  const token = btoa(url.href).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

  return {
    url: `https://api.onedrive.com/v1.0/shares/u!${token}/root/content`,
    service: 'onedrive',
    requiresProxy: false,
  };
}

function github(url: URL): NormalizedShareLink | null {
  if (url.hostname !== 'github.com') return null;

  const segments = url.pathname.split('/').filter(Boolean);
  if (segments.length < 5 || (segments[2] !== 'blob' && segments[2] !== 'raw')) return null;

  const [owner, repo, , ...rest] = segments;

  return {
    url: `https://raw.githubusercontent.com/${owner}/${repo}/${rest.join('/')}`,
    service: 'github',
    requiresProxy: false,
  };
}

function gitlab(url: URL): NormalizedShareLink | null {
  if (url.hostname !== 'gitlab.com' || !url.pathname.includes('/-/blob/')) return null;

  const direct = new URL(url.href);

  direct.pathname = url.pathname.replace('/-/blob/', '/-/raw/');

  return { url: direct.href, service: 'gitlab', requiresProxy: false };
}

function huggingface(url: URL): NormalizedShareLink | null {
  if (url.hostname !== 'huggingface.co' || !url.pathname.includes('/blob/')) return null;

  const direct = new URL(url.href);

  direct.pathname = url.pathname.replace('/blob/', '/resolve/');

  return { url: direct.href, service: 'huggingface', requiresProxy: false };
}

/** The authenticated console host requires a Google session; the API host is public. */
function googleCloudStorage(url: URL): NormalizedShareLink | null {
  if (url.hostname !== 'storage.cloud.google.com') return null;

  const direct = new URL(url.href);

  direct.hostname = 'storage.googleapis.com';

  return { url: direct.href, service: 'gcs', requiresProxy: false };
}

function internetArchive(url: URL): NormalizedShareLink | null {
  if (url.hostname !== 'archive.org' && url.hostname !== 'www.archive.org') return null;

  const segments = url.pathname.split('/').filter(Boolean);
  if (segments.length < 3 || segments[0] !== 'details') return null;

  return {
    url: `https://archive.org/download/${segments.slice(1).join('/')}`,
    service: 'internet-archive',
    requiresProxy: false,
  };
}

const RECOGNIZERS = [
  googleDrive,
  dropbox,
  onedrive,
  github,
  gitlab,
  huggingface,
  googleCloudStorage,
  internetArchive,
];

/**
 * Returns the direct-content form of a known service's share link, or null
 * when the input is not a recognized share URL (including unparseable input).
 */
export function normalizeAudioShareLink(raw: string): NormalizedShareLink | null {
  const url = parseUrl(raw);
  if (url === null) return null;

  for (const recognize of RECOGNIZERS) {
    const normalized = recognize(url);
    if (normalized) return normalized;
  }

  return null;
}
