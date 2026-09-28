import type { MediaVariant } from '../../types/configs/media';
import { hasUnsafeUrlProtocol } from './url-policy';

/**
 * Stored data is untrusted (hand-edited JSON, old versions), so only clean
 * `{ url, mimeType }` pairs reach a renderer.
 * @param value - `data.variants` as stored
 */
export const readVariants = (value: unknown): MediaVariant[] | undefined => {
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

  return clean.length > 0 ? clean : undefined;
};
