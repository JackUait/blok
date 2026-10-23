/**
 * The dark page is Notion's rgb(25, 25, 25) (research/21 §1d, research/37 §4).
 * Sticky database headers paint --blok-bg-primary, so any other value shows a band on a Notion-dark page.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const colors = readFileSync(resolve(__dirname, '../../../src/styles/colors.css'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '');

describe('page colour', () => {
  it('is white in light and Notion\'s #191919 in system dark and forced dark', () => {
    const values = [ ...colors.matchAll(/--blok-bg-primary:\s*([^;]+);/g) ].map((m) => m[1].trim());

    expect(values).toEqual(['#ffffff', '#191919', '#191919']);
  });
});
