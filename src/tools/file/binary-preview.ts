export type BinaryLoadResult =
  | { ok: true; buf: ArrayBuffer }
  | { ok: false; reason: 'fetch-error' };

/**
 * Fetch a file's body as an ArrayBuffer for in-modal office rendering. Same
 * reach as loadTextPreview (blob: URLs and same-origin / CORS http(s)). Any
 * failure (non-2xx, thrown fetch, malformed URL) resolves to fetch-error.
 */
export async function loadBinaryPreview(url: string): Promise<BinaryLoadResult> {
  try {
    const response = await fetch(url);
    if (!response.ok) {
      return { ok: false, reason: 'fetch-error' };
    }

    return { ok: true, buf: await response.arrayBuffer() };
  } catch {
    return { ok: false, reason: 'fetch-error' };
  }
}
