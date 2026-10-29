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

/**
 * Codecs safe to copy: H.264 Baseline/Main/High, VP9 profile 0 and 8-bit
 * 4:2:0 AV1. Mediabunny copies on family alone, so without this it would
 * copy 10-bit or 4:4:4 video that some browsers never load.
 */
const COPY_SAFE_CODEC = /^(avc1\.(42|4d|64)|vp09\.00\.|av01\.0\.\d+[MH]\.08)/i;

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
 * Convert `file` into one format. A track whose codec already fits is copied,
 * so that case is lossless; any other track is re-encoded at high quality.
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
    // No quality: any quality forces a re-encode. Mediabunny encodes at 'high' by default.
    const conversion = await mb.Conversion.init({
      input,
      output,
      video: async (track) => {
        const codec = (await track.getCodecParameterString()) ?? '';
        const copySafe = COPY_SAFE_CODEC.test(codec);
        const width = await track.getDisplayWidth();
        const oddSize = width % 2 === 1 || (await track.getDisplayHeight()) % 2 === 1;
        // H.264 encoders need even sizes; Mediabunny rounds both sides up only when given a width.
        // A copyable H.264 track keeps its size, since a width forces a re-encode.
        const evenSize = target.video === 'avc' && oddSize && !(copySafe && codec.startsWith('avc1'));

        return {
          codec: target.video,
          ...(copySafe ? {} : { forceTranscode: true }),
          ...(evenSize ? { width } : {}),
        };
      },
      audio: { codec: target.audio },
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
