import type { ConvertedMedia, MediaVariant, VideoFormat } from '../../../types/configs/media';
import { sortBestFirst } from './rank';

/** Most compatible first, so the universal fallback lands soonest. */
const ORDER: readonly VideoFormat[] = ['mp4', 'webm', 'av1'];

/** Every browser plays it. Once made, it replaces the original as `url`. */
const UNIVERSAL: VideoFormat = 'mp4';

const SUFFIX: Record<VideoFormat, string> = { mp4: 'mp4', webm: 'webm', av1: 'av1.webm' };

export interface BackgroundVideoDeps {
  produce(format: VideoFormat, onProgress: (fraction: number) => void): Promise<ConvertedMedia | null>;
  upload(file: File, variant: { mimeType: string; role: 'variant' }): Promise<{ url: string }>;
  /** Whether the block still shows `expectedUrl`; false stops the run. */
  isCurrent(expectedUrl: string): boolean;
  write(next: { url: string; variants?: MediaVariant[] }): void;
  /** Overall progress, 0–100. */
  onProgress?(percent: number): void;
}

const nameFor = (original: string, format: VideoFormat): string => {
  const dot = original.lastIndexOf('.');

  return `${dot > 0 ? original.slice(0, dot) : original}.${SUFFIX[format]}`;
};

/**
 * `url` is always last. Until an MP4 exists the original stays as `url`.
 * @param original - the uploaded original
 * @param made - stored renditions
 */
const compose = (
  original: { file: File; url: string },
  made: Array<MediaVariant & { format: VideoFormat }>
): { url: string; variants?: MediaVariant[] } => {
  const universal = made.find((item) => item.format === UNIVERSAL);
  const fallback = universal ?? { url: original.url, mimeType: original.file.type };
  const better = sortBestFirst(made.filter((item) => item !== universal)).map(({ url, mimeType }) => ({ url, mimeType }));
  const variants = [...better, { url: fallback.url, mimeType: fallback.mimeType }];

  return { url: fallback.url, variants: variants.length > 1 ? variants : undefined };
};

/**
 * Make, upload and store each listed format in turn. Every step is optional:
 * a format that cannot be made or uploaded is skipped.
 * @param original - the file the user picked and where it was stored
 * @param formats - formats the host listed
 * @param deps - conversion, upload and block access
 */
export const convertVideoInBackground = async (
  original: { file: File; url: string },
  formats: readonly VideoFormat[],
  deps: BackgroundVideoDeps
): Promise<void> => {
  const queue = ORDER.filter((format) => formats.includes(format));
  const made: Array<MediaVariant & { format: VideoFormat }> = [];

  for (const [index, format] of queue.entries()) {
    if (!deps.isCurrent(compose(original, made).url)) {
      return;
    }

    const converted = await deps.produce(format, (fraction) =>
      deps.onProgress?.(Math.round(((index + fraction) / queue.length) * 100)));
    const stored = converted === null
      ? null
      : await deps.upload(
        new File([converted.file], nameFor(original.file.name, format), { type: converted.mimeType }),
        { mimeType: converted.mimeType, role: 'variant' }
      ).catch(() => null);

    if (converted !== null && stored !== null && deps.isCurrent(compose(original, made).url)) {
      made.push({ url: stored.url, mimeType: converted.mimeType, format });
      deps.write(compose(original, made));
    }
  }
};
