import { formatBytes } from './format-bytes';

export interface UploadErrorLike {
  code: string;
  detail?: string;
}

export interface UploadErrorMessageKeys {
  /** i18n key for the "file too large" copy; interpolates {size} and {max}. */
  tooLarge: string;
  /** i18n key for every other (or unparseable) upload failure. */
  generic: string;
}

// Matches the public `api.i18n.t(key)` signature; interpolation is done here.
type Translate = (key: string) => string;

// The uploaders encode FILE_TOO_LARGE detail as `${file.size} > ${maxSize}`.
const TOO_LARGE_DETAIL = /^\s*(\d+)\s*>\s*(\d+)\s*$/;

/**
 * Read the file size and the limit out of a FILE_TOO_LARGE detail.
 * Returns null when the detail is missing or malformed.
 */
export function parseTooLargeDetail(detail: string | undefined): { size: number; max: number } | null {
  const match = TOO_LARGE_DETAIL.exec(detail ?? '');

  return match ? { size: Number(match[1]), max: Number(match[2]) } : null;
}

/**
 * Turn an upload error into human-readable copy. FILE_TOO_LARGE becomes a
 * specific message with both sizes formatted (e.g. "10.5 MB exceeds the 30 MB
 * limit"); anything else — including a malformed detail — falls back to the
 * generic message so raw error codes never reach the user.
 */
export function uploadErrorMessage(
  error: UploadErrorLike,
  t: Translate,
  keys: UploadErrorMessageKeys,
): string {
  if (error.code === 'FILE_TOO_LARGE') {
    const sizes = parseTooLargeDetail(error.detail);

    if (sizes) {
      return t(keys.tooLarge)
        .replace(/\{size\}/g, formatBytes(sizes.size))
        .replace(/\{max\}/g, formatBytes(sizes.max));
    }
  }

  return t(keys.generic);
}
