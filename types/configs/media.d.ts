/** Image formats Blok can produce. */
export type ImageFormat = 'avif' | 'webp' | 'jpeg' | 'png';

/**
 * Video formats Blok can produce.
 * - `'av1'`: WebM, AV1 video, Opus audio.
 * - `'webm'`: WebM, VP9 video, Opus audio.
 * - `'mp4'`: MP4, H.264 video, AAC audio.
 */
export type VideoFormat = 'av1' | 'webm' | 'mp4';

/** One stored rendition of a media asset. */
export interface MediaVariant {
  /** Public URL of this rendition. */
  url: string;
  /** Full MIME type, e.g. `image/avif` or `video/webm; codecs="vp9, opus"`. */
  mimeType: string;
}

/** One file returned by a custom {@link MediaConfig.convert}. */
export interface ConvertedMedia {
  file: Blob;
  mimeType: string;
}

export interface MediaConvertContext {
  kind: 'image' | 'video';
  /** Progress from 0 to 1. */
  onProgress?(fraction: number): void;
  /** Aborted when the editor or the block goes away. */
  signal?: AbortSignal;
}

/**
 * Automatic conversion of uploaded photos and videos into several formats.
 * Off unless a `formats` list is set for that kind.
 */
export interface MediaConfig {
  /**
   * Formats to produce per kind. The order does not matter: Blok stores and
   * renders them best-first, and the most compatible one becomes `url`.
   */
  formats?: {
    image?: ImageFormat[];
    video?: VideoFormat[];
  };
  /**
   * Replace the built-in converter. Return `null` to use Blok's own.
   * @param file - the file the user picked
   * @param formats - the formats listed for `ctx.kind`
   * @param ctx - kind, progress and cancellation
   */
  convert?(file: File, formats: readonly string[], ctx: MediaConvertContext): Promise<ConvertedMedia[] | null>;
  /** Videos longer than this (seconds) are not re-encoded. Default 600. */
  maxTranscodeDuration?: number;
  /**
   * Loads Mediabunny for the built-in video converter:
   * `mediabunny: () => import('mediabunny')`.
   *
   * Blok does not bundle it (it is MPL-2.0), so install it yourself. Without
   * it, video formats come only from `convert`.
   */
  mediabunny?: () => Promise<unknown>;
}
