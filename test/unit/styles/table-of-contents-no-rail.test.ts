import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const read = (file: string): string =>
  readFileSync(resolve(__dirname, '../../../src/styles', file), 'utf-8').replace(/\/\*[\s\S]*?\*\//g, '');

describe('table of contents has no left rail', () => {
  it('draws no dash beside an entry', () => {
    expect(read('table-of-contents.css')).not.toMatch(/\[data-blok-toc-list\][^{]*::before/);
  });

  it('leaves no empty gutter where the rail was', () => {
    expect(read('table-of-contents.css')).not.toMatch(/--blok-toc-gutter/);
  });

  it('draws no dash beside a toolbox preview entry', () => {
    expect(read('block-preview/structure.css')).not.toMatch(/\[data-blok-preview='table-of-contents'\][^{]*::before/);
  });
});
