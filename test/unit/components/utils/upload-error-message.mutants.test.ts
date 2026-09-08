import { describe, it, expect, vi } from 'vitest';

import { uploadErrorMessage } from '../../../../src/components/utils/upload-error-message';

const KEYS = { tooLarge: 'too-large', generic: 'generic' };
const translate = vi.fn((key: string) => (key === 'too-large' ? '{size} exceeds the {max} limit' : 'Upload failed'));

/**
 * One survivor is equivalent: the `?? ''` fallback for a missing detail. The
 * detail pattern is anchored and numeric, so it fails to match the empty string
 * and the replacement string alike, and both fall through to the generic copy.
 */
describe('uploadErrorMessage mutants', () => {
  it('formats both sizes for a size failure', () => {
    expect(uploadErrorMessage({ code: 'FILE_TOO_LARGE', detail: '1048576 > 31457280' }, translate, KEYS))
      .toBe('1.0 MB exceeds the 30 MB limit');
  });

  it('falls back to the generic copy for a malformed or missing detail', () => {
    expect(uploadErrorMessage({ code: 'FILE_TOO_LARGE', detail: 'huge' }, translate, KEYS)).toBe('Upload failed');
    expect(uploadErrorMessage({ code: 'FILE_TOO_LARGE' }, translate, KEYS)).toBe('Upload failed');
  });

  // Only the size code may take the size copy, however the detail happens to
  // read.
  it('leaves another code on the generic copy even with a size-shaped detail', () => {
    expect(uploadErrorMessage({ code: 'NETWORK', detail: '1024 > 2048' }, translate, KEYS)).toBe('Upload failed');
  });
});
