/**
 * Why a media upload failed.
 *
 * - `FILE_TOO_LARGE` — the file is bigger than `maxSize`.
 * - `UNSUPPORTED_TYPE` — the file's MIME type is not in `types`.
 * - `INVALID_URL` — the link is not a valid http(s) URL.
 * - `NOT_MEDIA_URL` — the link points to a page, not a media file (video).
 * - `GOOGLE_DRIVE_NEEDS_UPLOADER` / `ONEDRIVE_NEEDS_UPLOADER` — a share link
 *   that cannot play directly and no uploader is configured (audio).
 * - `UPLOAD_FAILED` — anything else, including a rejection from your own
 *   uploader. The original error is in {@link MediaUploadError.cause}.
 */
export type MediaUploadErrorCode =
  | 'FILE_TOO_LARGE'
  | 'UNSUPPORTED_TYPE'
  | 'INVALID_URL'
  | 'NOT_MEDIA_URL'
  | 'GOOGLE_DRIVE_NEEDS_UPLOADER'
  | 'ONEDRIVE_NEEDS_UPLOADER'
  | 'UPLOAD_FAILED';

/**
 * A failed upload, as passed to `onUploadError`.
 */
export interface MediaUploadError {
  code: MediaUploadErrorCode;
  /** The tool the upload happened in. */
  tool: 'image' | 'video' | 'audio' | 'file';
  /** The text the block shows by default, already translated. */
  message: string;
  /** The file being uploaded, when the user picked or pasted one. */
  file?: File;
  /** The link being uploaded, when the user entered one. */
  url?: string;
  /** File size in bytes. Set only for `FILE_TOO_LARGE`. */
  size?: number;
  /** The limit in bytes that the file exceeded. Set only for `FILE_TOO_LARGE`. */
  maxSize?: number;
  /** The original error. */
  cause: unknown;
}

/**
 * Called when a media upload fails. The return value decides what the block does:
 *
 * - nothing — the block shows its default message;
 * - a string — the block shows that string instead;
 * - `false` — the block goes back to its empty state and shows no error,
 *   so you can report the failure your own way (a toast, a dialog).
 *
 * Runs synchronously. If it throws, the error is logged and the block shows
 * its default message.
 */
export type UploadErrorHandler = (error: MediaUploadError) => string | false | void;
