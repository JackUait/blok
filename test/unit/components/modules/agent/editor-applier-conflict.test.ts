import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ConvertConflictError } from '../../../../../src/components/errors/convert-conflict';

describe('concurrent convert', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('keeps the shipped Error message, name and string representation', () => {
    const error = new ConvertConflictError('b1');

    expect(error.message).toBe('Could not convert Block «b1»: it is being edited by someone else. Nothing was changed.');
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe('Error');
    expect(String(error)).toBe('Error: Could not convert Block «b1»: it is being edited by someone else. Nothing was changed.');
    expect(error.blockId).toBe('b1');
  });
});
