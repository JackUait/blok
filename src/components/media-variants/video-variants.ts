import type { ConvertedMedia, VideoFormat } from '../../../types/configs/media';

// Type-only: erased at build, so Blok never bundles the MPL-2.0 package.
import type * as MediabunnyModule from 'mediabunny';

type Mediabunny = typeof MediabunnyModule;

interface VideoTarget {
  container: 'mp4' | 'webm';
  video: 'avc' | 'vp9' | 'av1';
  audio: 'aac' | 'opus';
}

export const VIDEO_TARGETS: Record<VideoFormat, VideoTarget> = {
  mp4: { container: 'mp4', video: 'avc', audio: 'aac' },
  webm: { container: 'webm', video: 'vp9', audio: 'opus' },
  av1: { container: 'webm', video: 'av1', audio: 'opus' },
};

export interface VideoVariantOptions {
  /** Longer videos (seconds) are only remuxed, never re-encoded. */
  maxTranscodeDuration: number;
  /** Progress from 0 to 1. */
  onProgress?: (fraction: number) => void;
  signal?: AbortSignal;
  /** The host's loader, `media.mediabunny`. */
  load: () => Promise<unknown>;
}

/**
 * Convert `file` into one format. Mediabunny copies a track whose codec
 * already fits the container, so that case is lossless.
 * @param file - the uploaded video
 * @param format - the format to make
 * @param opts - duration cap, progress and cancellation
 * @returns null whenever the format cannot be made in full
 */
export const produceVideoVariant = async (
  file: File,
  format: VideoFormat,
  opts: VideoVariantOptions
): Promise<ConvertedMedia | null> => {
  const target = VIDEO_TARGETS[format];
  // A call, not a property read: the flag flips during the awaits below.
  const aborted = (): boolean => opts.signal?.aborted === true;
  const mb = (await opts.load().catch(() => null)) as Mediabunny | null;

  // A missing or wrong module means no built-in conversion, not a crash.
  if (mb === null || typeof mb.Input !== 'function' || typeof mb.Conversion?.init !== 'function') {
    return null;
  }

  const input = new mb.Input({ formats: mb.ALL_FORMATS, source: new mb.BlobSource(file) });

  try {
    const copyOnly = (await input.computeDuration()) > opts.maxTranscodeDuration;
    const output = new mb.Output({
      format: target.container === 'mp4' ? new mb.Mp4OutputFormat() : new mb.WebMOutputFormat(),
      target: new mb.BufferTarget(),
    });
    const quality = new mb.Quality('high');
    const conversion = await mb.Conversion.init({
      input,
      output,
      video: { codec: target.video, quality },
      audio: { codec: target.audio, quality },
      ...(copyOnly ? { copy: { mode: 'forced' as const } } : {}),
    });

    // A dropped track (often audio with no encoder) would ship a broken file.
    if (!conversion.isValid || conversion.discardedTracks.length > 0) {
      return null;
    }
    if (aborted()) {
      await conversion.cancel();

      return null;
    }
    opts.signal?.addEventListener('abort', () => void conversion.cancel(), { once: true });
    conversion.onProgress = (progress: number): void => opts.onProgress?.(progress);
    await conversion.execute();

    const bytes = output.target.buffer;

    if (bytes === null || aborted()) {
      return null;
    }

    const mimeType = await output.getMimeType();

    return { file: new Blob([bytes], { type: mimeType }), mimeType };
  } catch {
    return null;
  } finally {
    input.dispose();
  }
};
