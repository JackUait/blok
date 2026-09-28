import type {
  MediaUploadError,
  MediaUploadErrorCode,
  UploadErrorHandler,
} from '../../../types/tools/upload-error';
import { parseTooLargeDetail } from './upload-error-message';

export type UploadErrorOutcome =
  | { kind: 'message'; message: string }
  | { kind: 'dismiss' };

interface ResolveOptions {
  tool: MediaUploadError['tool'];
  /** The tool's own upload error, or null when the failure came from elsewhere. */
  error: { code: string; detail?: string } | null;
  cause: unknown;
  /** The text the block would show by default. */
  message: string;
  source: { file?: File; url?: string };
  onUploadError?: UploadErrorHandler;
}

const PUBLISHED_CODES: ReadonlySet<string> = new Set<MediaUploadErrorCode>([
  'FILE_TOO_LARGE',
  'UNSUPPORTED_TYPE',
  'INVALID_URL',
  'NOT_MEDIA_URL',
  'GOOGLE_DRIVE_NEEDS_UPLOADER',
  'ONEDRIVE_NEEDS_UPLOADER',
  'UPLOAD_FAILED',
]);

const isPublishedCode = (code: string): code is MediaUploadErrorCode => PUBLISHED_CODES.has(code);

/**
 * Tell the consumer's `onUploadError` about a failed upload and decide what the
 * block shows: its default message, the consumer's text, or nothing at all.
 */
export function resolveUploadError(options: ResolveOptions): UploadErrorOutcome {
  const { tool, error, cause, message, source, onUploadError } = options;

  if (!onUploadError) return { kind: 'message', message };

  const code = error && isPublishedCode(error.code) ? error.code : 'UPLOAD_FAILED';
  const report: MediaUploadError = { code, tool, message, cause };

  if (source.file) report.file = source.file;
  if (source.url !== undefined) report.url = source.url;

  const sizes = code === 'FILE_TOO_LARGE' ? parseTooLargeDetail(error?.detail) : null;

  if (sizes) {
    report.size = sizes.size;
    report.maxSize = sizes.max;
  }

  try {
    const result = onUploadError(report);

    if (result === false) return { kind: 'dismiss' };
    if (typeof result === 'string' && result !== '') return { kind: 'message', message: result };
  } catch (thrown) {
    console.error(`[${tool}] onUploadError threw`, thrown);
  }

  return { kind: 'message', message };
}
