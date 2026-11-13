import { formatBytes } from './format-bytes';
import { parseTooLargeDetail, type UploadErrorLike } from './upload-error-message';

/** The two lines of an error card: what went wrong, then what to do about it. */
export interface UploadErrorLines {
  title: string;
  detail: string;
}

/** The i18n keys a tool supplies for the failures every media tool shares. */
export interface UploadErrorLineKeys {
  failed: string;
  failedDetail: string;
  tooLargeTitle: string;
  /** Interpolates {size} and {max}. */
  tooLargeDetail: string;
  unsupportedTitle: string;
  unsupportedDetail: string;
  invalidUrlTitle: string;
  invalidUrlDetail: string;
}

interface Options {
  /** The tool's own upload error, or null when the failure came from elsewhere. */
  error: UploadErrorLike | null;
  /** The tool's one-sentence default, as `onUploadError` received it. */
  own: string;
  /** The text the block was told to show: `own`, or the host app's replacement. */
  shown: string;
  // Matches the public `api.i18n.t(key)` signature; interpolation is done here.
  t: (key: string) => string;
  keys: UploadErrorLineKeys;
}

/**
 * Turn a failed upload into an error card's title and detail. Both lines are
 * always filled, so no card is left with a bare title.
 */
export function uploadErrorLines({ error, own, shown, t, keys }: Options): UploadErrorLines {
  // The host app replaced our sentence: it stands as the detail, whole.
  if (shown !== own) return { title: t(keys.failed), detail: shown };

  const sizes = error?.code === 'FILE_TOO_LARGE' ? parseTooLargeDetail(error.detail) : null;

  if (sizes) {
    return {
      title: t(keys.tooLargeTitle),
      detail: t(keys.tooLargeDetail)
        .replace(/\{size\}/g, formatBytes(sizes.size))
        .replace(/\{max\}/g, formatBytes(sizes.max)),
    };
  }
  if (error?.code === 'UNSUPPORTED_TYPE') return { title: t(keys.unsupportedTitle), detail: t(keys.unsupportedDetail) };
  if (error?.code === 'INVALID_URL') return { title: t(keys.invalidUrlTitle), detail: t(keys.invalidUrlDetail) };

  return { title: t(keys.failed), detail: t(keys.failedDetail) };
}
