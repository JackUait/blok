import type { MediaVariant } from '../../types/configs/media';
import { hasUnsafeUrlProtocol } from './url-policy';

/**
 * Stored data is untrusted (hand-edited JSON, old versions), so only clean
 * `{ url, mimeType }` pairs reach a renderer.
 *
 * `url` is always one of its own variants. A list that lacks it belongs to an
 * earlier image (a host `blocks.update({ url })` merges and keeps the old
 * list), and rendering it would hide the new image behind the old sources.
 * @param value - `data.variants` as stored
 * @param url - the block's `data.url`; when given, a list without it is dropped
 */
export const readVariants = (value: unknown, url?: unknown): MediaVariant[] | undefined => {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const clean = value.flatMap((entry: unknown): MediaVariant[] => {
    if (typeof entry !== 'object' || entry === null) {
      return [];
    }

    const { url, mimeType } = entry as Record<string, unknown>;

    if (typeof url !== 'string' || url === '' || typeof mimeType !== 'string' || mimeType === '') {
      return [];
    }

    return hasUnsafeUrlProtocol(url, 'src') ? [] : [{ url, mimeType }];
  });

  if (clean.length === 0 || (url !== undefined && !clean.some((variant) => variant.url === url))) {
    return undefined;
  }

  return clean;
};
