import { describe, it, expect } from 'vitest';

import { humanFileSize } from '../../../../src/tools/file/format';

describe('humanFileSize mutants', () => {
  it('says nothing for a size it was not given', () => {
    expect(humanFileSize(undefined)).toBe('');
  });

  // Zero has no logarithm, so it has to be answered before the unit maths.
  it('reports small sizes in bytes, zero included', () => {
    expect(humanFileSize(0)).toBe('0 B');
    expect(humanFileSize(1023)).toBe('1023 B');
  });

  it('steps up to the next unit on its own multiple', () => {
    expect(humanFileSize(1024)).toBe('1 KB');
    expect(humanFileSize(1536)).toBe('1.5 KB');
    expect(humanFileSize(1024 ** 2)).toBe('1 MB');
  });

  // Past the largest unit the count keeps growing rather than running off the
  // end of the list.
  it('stays on the largest unit it knows', () => {
    expect(humanFileSize(1024 ** 4)).toBe('1 TB');
    expect(humanFileSize(1024 ** 5)).toBe('1024 TB');
  });
});
