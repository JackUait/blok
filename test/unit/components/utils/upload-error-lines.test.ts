import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { uploadErrorLines, type UploadErrorLineKeys } from '../../../../src/components/utils/upload-error-lines';

const KEYS: UploadErrorLineKeys = {
  failed: 'k.failed',
  failedDetail: 'k.failedDetail',
  tooLargeTitle: 'k.tooLargeTitle',
  tooLargeDetail: 'k.tooLargeDetail',
  unsupportedTitle: 'k.unsupportedTitle',
  unsupportedDetail: 'k.unsupportedDetail',
  invalidUrlTitle: 'k.invalidUrlTitle',
  invalidUrlDetail: 'k.invalidUrlDetail',
};
const MESSAGES: Record<string, string> = {
  'k.failed': 'Upload failed',
  'k.failedDetail': 'Check your connection and try again.',
  'k.tooLargeTitle': 'Audio is too large',
  'k.tooLargeDetail': '{size} exceeds the {max} limit.',
  'k.unsupportedTitle': 'This file type isn’t supported',
  'k.unsupportedDetail': 'Choose a different file.',
  'k.invalidUrlTitle': 'This link doesn’t work',
  'k.invalidUrlDetail': 'Check the link and try again.',
};
const t = (key: string): string => MESSAGES[key] ?? key;
const OWN = 'the one-sentence default';

const lines = (error: { code: string; detail?: string } | null, shown = OWN): { title: string; detail: string } =>
  uploadErrorLines({ error, own: OWN, shown, t, keys: KEYS });

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('uploadErrorLines', () => {
  it.each([
    ['a failure that is not the tool\'s own', null],
    ['the tool\'s own UPLOAD_FAILED', { code: 'UPLOAD_FAILED' }],
    ['a code it does not know', { code: 'SOMETHING_NEW' }],
  ])('gives %s a title and a line of advice', (_name, error) => {
    expect(lines(error)).toEqual({ title: 'Upload failed', detail: 'Check your connection and try again.' });
  });

  it('names both sizes when the file is over the limit', () => {
    expect(lines({ code: 'FILE_TOO_LARGE', detail: '88080384 > 52428800' }))
      .toEqual({ title: 'Audio is too large', detail: '84 MB exceeds the 50 MB limit.' });
  });

  it('fills every size placeholder, however often a locale repeats it', () => {
    const twice = (key: string): string => (key === 'k.tooLargeDetail' ? '{size} / {max} ({size} > {max})' : t(key));

    expect(uploadErrorLines({ error: { code: 'FILE_TOO_LARGE', detail: '2048 > 1024' }, own: OWN, shown: OWN, t: twice, keys: KEYS }).detail)
      .toBe('2 KB / 1 KB (2 KB > 1 KB)');
  });

  it('falls back to the plain failure when a size error carries no sizes', () => {
    expect(lines({ code: 'FILE_TOO_LARGE', detail: 'nonsense' }))
      .toEqual({ title: 'Upload failed', detail: 'Check your connection and try again.' });
  });

  it('says a refused file type is the file\'s problem, not the connection\'s', () => {
    expect(lines({ code: 'UNSUPPORTED_TYPE', detail: 'text/plain' }))
      .toEqual({ title: 'This file type isn’t supported', detail: 'Choose a different file.' });
  });

  it('says a bad link is the link\'s problem', () => {
    expect(lines({ code: 'INVALID_URL' }))
      .toEqual({ title: 'This link doesn’t work', detail: 'Check the link and try again.' });
  });

  it('shows the host app\'s own text as the detail, under the plain title', () => {
    expect(lines({ code: 'FILE_TOO_LARGE', detail: '2048 > 1024' }, 'Ask your admin for more space.'))
      .toEqual({ title: 'Upload failed', detail: 'Ask your admin for more space.' });
  });

  it.each([null, { code: 'UPLOAD_FAILED' }, { code: 'FILE_TOO_LARGE', detail: '2048 > 1024' }, { code: 'UNSUPPORTED_TYPE' }, { code: 'INVALID_URL' }, { code: 'X' }])(
    'never leaves a line empty (%j)',
    (error) => {
      const { title, detail } = lines(error);

      expect(title).not.toBe('');
      expect(detail).not.toBe('');
    }
  );
});
