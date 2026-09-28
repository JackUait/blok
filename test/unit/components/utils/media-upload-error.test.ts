import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { resolveUploadError } from '../../../../src/components/utils/media-upload-error';
import type { MediaUploadError } from '../../../../types/tools/upload-error';

const file = new File([new Uint8Array(4)], 'clip.mp4', { type: 'video/mp4' });

describe('resolveUploadError', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.restoreAllMocks());

  it('keeps the default message when no handler is configured', () => {
    const outcome = resolveUploadError({
      tool: 'video',
      error: { code: 'UPLOAD_FAILED' },
      cause: new Error('boom'),
      message: 'Upload failed',
      source: { file },
    });

    expect(outcome).toEqual({ kind: 'message', message: 'Upload failed' });
  });

  it('hands the handler the code, sizes, source, default message and cause', () => {
    const cause = new Error('FILE_TOO_LARGE: 2000 > 1000');
    const onUploadError = vi.fn<(error: MediaUploadError) => void>();

    resolveUploadError({
      tool: 'video',
      error: { code: 'FILE_TOO_LARGE', detail: '2000 > 1000' },
      cause,
      message: 'Too large',
      source: { file },
      onUploadError,
    });

    expect(onUploadError).toHaveBeenCalledTimes(1);
    expect(onUploadError.mock.calls[0][0]).toEqual({
      code: 'FILE_TOO_LARGE',
      tool: 'video',
      message: 'Too large',
      file,
      size: 2000,
      maxSize: 1000,
      cause,
    });
  });

  it('reports the url for a link upload and no sizes for other codes', () => {
    const onUploadError = vi.fn<(error: MediaUploadError) => void>();

    resolveUploadError({
      tool: 'image',
      error: { code: 'INVALID_URL', detail: 'ftp:' },
      cause: null,
      message: 'Upload failed',
      source: { url: 'ftp://x/y.png' },
      onUploadError,
    });

    const reported = onUploadError.mock.calls[0][0];

    expect(reported.url).toBe('ftp://x/y.png');
    expect(reported.file).toBeUndefined();
    expect(reported).not.toHaveProperty('size');
    expect(reported).not.toHaveProperty('maxSize');
  });

  it('reports an error that is not a Blok upload error as UPLOAD_FAILED', () => {
    const onUploadError = vi.fn<(error: MediaUploadError) => void>();
    const cause = new Error('403 from my server');

    resolveUploadError({
      tool: 'file',
      error: null,
      cause,
      message: 'Upload failed',
      source: { file },
      onUploadError,
    });

    expect(onUploadError.mock.calls[0][0].code).toBe('UPLOAD_FAILED');
    expect(onUploadError.mock.calls[0][0].cause).toBe(cause);
  });

  it('reports a code outside the published union as UPLOAD_FAILED', () => {
    const onUploadError = vi.fn<(error: MediaUploadError) => void>();

    resolveUploadError({
      tool: 'image',
      error: { code: 'LOAD_FAILED' },
      cause: null,
      message: 'Upload failed',
      source: { file },
      onUploadError,
    });

    expect(onUploadError.mock.calls[0][0].code).toBe('UPLOAD_FAILED');
  });

  it('replaces the message with a string the handler returns', () => {
    const outcome = resolveUploadError({
      tool: 'audio',
      error: { code: 'UPLOAD_FAILED' },
      cause: null,
      message: 'Upload failed',
      source: { file },
      onUploadError: () => 'Try again later',
    });

    expect(outcome).toEqual({ kind: 'message', message: 'Try again later' });
  });

  it('dismisses the error when the handler returns false', () => {
    const outcome = resolveUploadError({
      tool: 'audio',
      error: { code: 'UPLOAD_FAILED' },
      cause: null,
      message: 'Upload failed',
      source: { file },
      onUploadError: () => false,
    });

    expect(outcome).toEqual({ kind: 'dismiss' });
  });

  it('keeps the default message when the handler returns an empty string', () => {
    const outcome = resolveUploadError({
      tool: 'audio',
      error: { code: 'UPLOAD_FAILED' },
      cause: null,
      message: 'Upload failed',
      source: { file },
      onUploadError: () => '',
    });

    expect(outcome).toEqual({ kind: 'message', message: 'Upload failed' });
  });

  it('logs a throwing handler and falls back to the default message', () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const thrown = new Error('handler bug');

    const outcome = resolveUploadError({
      tool: 'image',
      error: { code: 'UPLOAD_FAILED' },
      cause: null,
      message: 'Upload failed',
      source: { file },
      onUploadError: () => {
        throw thrown;
      },
    });

    expect(outcome).toEqual({ kind: 'message', message: 'Upload failed' });
    expect(log).toHaveBeenCalledWith('[image] onUploadError threw', thrown);
  });
});
