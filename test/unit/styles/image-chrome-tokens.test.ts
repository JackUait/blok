import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const css = readFileSync(resolve(__dirname, '../../../src/styles/colors.css'), 'utf-8');
const TOKENS = ['--blok-image-frame-ring', '--blok-image-frame-ring-strong', '--blok-image-readout-bg', '--blok-image-readout-fg'];

describe('image chrome tokens', () => {
  it.each(TOKENS)('%s is defined for light, system-dark and forced-dark', (token) => {
    expect(css.split(`${token}:`).length - 1).toBe(3);
  });

  it('the selection ring is not blue', () => {
    const values = css.match(/--blok-image-frame-ring(?:-strong)?:\s*[^;]+;/g) ?? [];

    expect(values).toHaveLength(6);
    for (const v of values) expect(v).not.toMatch(/accent|#2383e2|blue/i);
  });
});
