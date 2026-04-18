import { describe, it, expect } from 'vitest';
import { ImageError, type ImageErrorCode } from '../../../../src/tools/image/errors';

describe('ImageError', () => {
  it('extends Error', () => {
    const err = new ImageError('INVALID_URL', 'http://nope');
    expect(err).toBeInstanceOf(Error);
  });

  it('exposes code and detail', () => {
    const err = new ImageError('FILE_TOO_LARGE', '12345');
    expect(err.code).toBe<ImageErrorCode>('FILE_TOO_LARGE');
    expect(err.detail).toBe('12345');
  });

  it('formats message as "<code>: <detail>"', () => {
    const err = new ImageError('UNSUPPORTED_TYPE', 'application/pdf');
    expect(err.message).toBe('UNSUPPORTED_TYPE: application/pdf');
  });
});
