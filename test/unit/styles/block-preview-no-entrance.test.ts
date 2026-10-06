import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const css = readFileSync(resolve(__dirname, '../../../src/styles/block-preview.css'), 'utf-8')
  .replace(/\/\*[\s\S]*?\*\//g, '');

describe('toolbox preview card appears without an entrance animation', () => {
  it('does not animate the card when it opens', () => {
    expect(css).not.toMatch(/\[data-blok-preview-card\][^{]*\{[^}]*animation/);
  });

  it('does not animate a drawing when it replaces the last one', () => {
    expect(css).not.toMatch(/\[data-blok-preview-paper\]\s*>\s*\[data-blok-preview\][^{]*\{[^}]*animation/);
  });
});
