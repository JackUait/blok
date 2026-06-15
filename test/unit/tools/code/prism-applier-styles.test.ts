import { describe, it, expect, afterEach } from 'vitest';
import { ensurePrismStyles, disposePrismStyles } from '../../../../src/tools/code/prism-applier';

afterEach(() => {
  disposePrismStyles();
});

describe('ensurePrismStyles', () => {
  it('adopts the Prism token stylesheet exactly once', () => {
    const before = document.adoptedStyleSheets.length;
    ensurePrismStyles();
    ensurePrismStyles();
    expect(document.adoptedStyleSheets.length).toBe(before + 1);
  });
});
