import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { validateCoverFile } from '../../../../src/tools/audio/cover-picker';
import { COVER_MAX_SIZE } from '../../../../src/tools/audio/constants';

const makeFile = (type: string, size: number): File => {
  const f = new File(['x'], 'cover', { type });
  Object.defineProperty(f, 'size', { value: size });
  return f;
};

beforeEach(() => vi.clearAllMocks());
afterEach(() => vi.restoreAllMocks());

describe('validateCoverFile', () => {
  it('accepts an image within the size cap', () => {
    expect(validateCoverFile(makeFile('image/png', 1024))).toBeNull();
  });

  it('rejects a non-image file', () => {
    expect(validateCoverFile(makeFile('audio/mpeg', 1024))).not.toBeNull();
  });

  it('rejects an oversized image', () => {
    expect(validateCoverFile(makeFile('image/png', COVER_MAX_SIZE + 1))).not.toBeNull();
  });
});
