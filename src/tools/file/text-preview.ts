export type TextLoadResult =
  | { ok: true; text: string }
  | { ok: false; reason: 'fetch-error' };

/**
 * Fetch a file's body as text for in-modal preview. Works for blob: URLs and
 * same-origin / CORS-enabled http(s) URLs. There is no size cap by design.
 * Any failure (non-2xx, thrown fetch, malformed URL) resolves to fetch-error.
 */
export async function loadTextPreview(url: string): Promise<TextLoadResult> {
  try {
    const response = await fetch(url);
    if (!response.ok) {
      return { ok: false, reason: 'fetch-error' };
    }

    return { ok: true, text: await response.text() };
  } catch {
    return { ok: false, reason: 'fetch-error' };
  }
}
