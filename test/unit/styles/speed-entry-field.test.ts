/**
 * The typed-speed field stands in for the big number at the same size.
 * jsdom has no CSS, so this reads the source.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const read = (file: string): string =>
  readFileSync(resolve(__dirname, '../../../src/styles', file), 'utf-8').replace(/\/\*[\s\S]*?\*\//g, '');

const body = (css: string, selector: string): string => {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  return css.match(new RegExp(`(?:^|\\})\\s*${escaped}\\s*\\{([^}]*)\\}`))?.[1] ?? '';
};

describe.each(['audio', 'video'])('%s speed field', (tool) => {
  const css = read(`${tool}.css`);
  const scope = `[data-blok-tool="${tool}"] .blok-${tool}-controls__`;

  it('shows a text cursor over the number', () => {
    expect(body(css, `${scope}speed-readout[role="button"]`)).toMatch(/cursor: text;/);
  });

  it('rings the number only for the keyboard', () => {
    expect(css).toContain(`:where(:root:not([data-blok-modality="pointer"])) ${scope}speed-readout[role="button"]:focus-visible`);
  });

  it('draws the field as bare text in the number\'s own font', () => {
    const field = body(css, `${scope}speed-entry-input`);

    expect(field).toMatch(/font: inherit;/);
    expect(field).toMatch(/border: 0;/);
    expect(field).toMatch(/background: transparent;/);
    expect(field).toMatch(/outline: none;/);
  });
});
