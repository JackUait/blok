import type { ConvertedMedia, MediaVariant } from '../../../types/configs/media';
import { UNIVERSAL_IMAGE_MIMES, sortBestFirst } from './rank';

export type VariantRole = 'original' | 'variant';

export type VariantUpload = (
  file: File,
  variant: { mimeType: string; role: VariantRole },
  onProgress: (percent: number) => void
) => Promise<{ url: string; fileName?: string }>;

const EXTENSION: Record<string, string> = {
  'image/avif': 'avif',
  'image/webp': 'webp',
  'image/jpeg': 'jpg',
  'image/png': 'png',
};

const nameFor = (original: string, mime: string): string => {
  const dot = original.lastIndexOf('.');
  const base = dot > 0 ? original.slice(0, dot) : original;

  return `${base}.${EXTENSION[mime] ?? 'bin'}`;
};

type Job = { file: File; mimeType: string; role: VariantRole };

/**
 * Upload every rendition. The most compatible one becomes `url`: it is
 * uploaded first and must succeed. A better format that fails to upload is
 * dropped, so one rejected type never costs the user the image.
 * @param original - the file the user picked
 * @param produced - renditions made from it, any order
 * @param upload - stores one file
 * @param onProgress - overall progress, 0–100
 * @param prepareOriginal - shapes the original before it is kept as the fallback
 * @returns `variants` is best-first, and undefined when only one file was stored
 */
export const uploadImageVariants = async (
  original: File,
  produced: readonly ConvertedMedia[],
  upload: VariantUpload,
  onProgress?: (percent: number) => void,
  prepareOriginal: (file: File) => Promise<File> = async (file) => file
): Promise<{ url: string; fileName?: string; variants?: MediaVariant[] }> => {
  const better: Job[] = sortBestFirst(produced).map((item) => ({
    file: new File([item.file], nameFor(original.name, item.mimeType), { type: item.mimeType }),
    mimeType: item.mimeType,
    role: 'variant',
  }));
  const universal = better.filter((job) => UNIVERSAL_IMAGE_MIMES.has(job.mimeType)).at(-1);
  const needed: Job = universal ?? await prepareOriginal(original).then((file) => ({ file, mimeType: file.type, role: 'original' as const }));
  const rest = better.filter((job) => job !== needed);
  const total = rest.length + 1;
  const progressFor = (index: number) => (percent: number): void =>
    onProgress?.(Math.round(((index + percent / 100) / total) * 100));

  const main = await upload(needed.file, { mimeType: needed.mimeType, role: needed.role }, progressFor(0));
  const stored: MediaVariant[] = [];

  // One at a time, so a host endpoint never sees a burst.
  for (const [index, job] of rest.entries()) {
    const result = await upload(job.file, { mimeType: job.mimeType, role: job.role }, progressFor(index + 1))
      .catch(() => null);

    stored.push(...(result ? [{ url: result.url, mimeType: job.mimeType }] : []));
  }

  // `rest` is already best-first; `url` stays last whatever its type.
  const variants = [...stored, { url: main.url, mimeType: needed.mimeType }];

  return { url: main.url, fileName: main.fileName, variants: variants.length > 1 ? variants : undefined };
};
