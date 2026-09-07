import { describe, it, expect } from 'vitest';

import { FileToolError } from '../../../../src/tools/file/errors';

describe('FileToolError mutants', () => {
  it('keeps the code and the detail apart, and puts both in the message', () => {
    const error = new FileToolError('FILE_TOO_LARGE', 'over 20 MB');

    expect(error.code).toBe('FILE_TOO_LARGE');
    expect(error.detail).toBe('over 20 MB');
    expect(error.message).toBe('FILE_TOO_LARGE: over 20 MB');
  });

  it('names itself, so a catch can tell it from any other Error', () => {
    const error = new FileToolError('INVALID_URL', 'not http');

    expect(error.name).toBe('FileToolError');
    expect(error).toBeInstanceOf(Error);
    expect(error).toBeInstanceOf(FileToolError);
  });

  it.each(['UNSUPPORTED_TYPE', 'FILE_TOO_LARGE', 'INVALID_URL', 'UPLOAD_FAILED'] as const)(
    'carries the %s code through unchanged',
    (code) => {
      expect(new FileToolError(code, 'why').code).toBe(code);
    },
  );
});
