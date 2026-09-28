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

/**
 * Upload every rendition, best first. The last one is the most compatible
 * and becomes `url`.
 * @param original - the file the user picked
 * @param produced - renditions made from it, any order
 * @param upload - stores one file
 * @param onProgress - overall progress, 0–100
 * @returns `variants` is undefined when only one file was uploaded
 */
export const uploadImageVariants = async (
  original: File,
  produced: readonly ConvertedMedia[],
  upload: VariantUpload,
  onProgress?: (percent: number) => void
): Promise<{ url: string; fileName?: string; variants?: MediaVariant[] }> => {
  const jobs: Array<{ file: File; mimeType: string; role: VariantRole }> = sortBestFirst(produced).map((item) => ({
    file: new File([item.file], nameFor(original.name, item.mimeType), { type: item.mimeType }),
    mimeType: item.mimeType,
    role: 'variant',
  }));

  if (!jobs.some((job) => UNIVERSAL_IMAGE_MIMES.has(job.mimeType))) {
    jobs.push({ file: original, mimeType: original.type, role: 'original' });
  }

  const uploaded: Array<{ url: string; fileName?: string; mimeType: string }> = [];

  // One at a time, so a host endpoint never sees a burst.
  for (const [index, job] of jobs.entries()) {
    const result = await upload(job.file, { mimeType: job.mimeType, role: job.role }, (percent) =>
      onProgress?.(Math.round(((index + percent / 100) / jobs.length) * 100)));

    uploaded.push({ ...result, mimeType: job.mimeType });
  }

  const last = uploaded[uploaded.length - 1];
  const variants = uploaded.map(({ url, mimeType }) => ({ url, mimeType }));

  return { url: last.url, fileName: last.fileName, variants: variants.length > 1 ? variants : undefined };
};
