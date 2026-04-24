import { dimensionsFromSvg } from './dimensions-from-svg';
import { dimensionsFromUrl } from './dimensions-from-url';

type Dims = { width: number; height: number };

function probeViaImage(url: string): Promise<Dims | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = (): void => {
      const width = img.naturalWidth;
      const height = img.naturalHeight;
      if (width > 0 && height > 0) {
        resolve({ width, height });
      } else {
        resolve(null);
      }
    };
    img.onerror = (): void => resolve(null);
    img.src = url;
  });
}

/**
 * Resolve an image's intrinsic dimensions ahead of display.
 * Tries synchronous URL/filename parsing first (common CDN hints),
 * falls back to parsing SVG text, finally loads the image via `new Image()`.
 * Returns null when no strategy succeeds or the image has no intrinsic size.
 */
export async function probeImageDimensions(url: string): Promise<Dims | null> {
  if (!url) return null;
  const fromUrl = dimensionsFromUrl(url);
  if (fromUrl) return fromUrl;
  const fromSvg = await dimensionsFromSvg(url);
  if (fromSvg) return fromSvg;
  return probeViaImage(url);
}
