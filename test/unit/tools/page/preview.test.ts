import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { IconPage } from '../../../../src/components/icons';
import { renderPagePreview } from '../../../../src/tools/page/preview';

const css = readFileSync(resolve(__dirname, '../../../../src/styles/block-preview/lists.css'), 'utf8');
const MOTION = '@media (prefers-reduced-motion: no-preference)';
const still = css.slice(0, css.indexOf(MOTION));
const motion = css.slice(css.indexOf(MOTION));

const svgMarkup = (markup: string): string | undefined =>
  new DOMParser().parseFromString(markup, 'text/html').querySelector('svg')?.outerHTML;

describe('page toolbox preview', () => {
  it('is keyed as the page drawing and is fresh on every render', () => {
    const drawing = renderPagePreview();

    expect(drawing.getAttribute('data-blok-preview')).toBe('page');
    expect(renderPagePreview()).not.toBe(drawing);
  });

  it('shows a sub-page row with the page icon and a title between lines of the parent page', () => {
    const drawing = renderPagePreview();
    const row = drawing.querySelector('[data-row]');
    const svg = row?.querySelector('[data-icon] svg');

    expect(svg?.outerHTML).toBe(svgMarkup(IconPage));
    expect(row?.querySelector('[data-title]')?.textContent).toBe('Project notes');
    expect(drawing.firstElementChild?.tagName).toBe('P');
    expect(drawing.lastElementChild?.tagName).toBe('P');
  });

  it('styles every drawn part', () => {
    const parts = [...renderPagePreview().querySelectorAll('*')]
      .flatMap((el) => el.getAttributeNames().filter((name) => name.startsWith('data-')));

    new Set(parts).forEach((part) => {
      expect(still, part).toContain(`[data-blok-preview='page'] [${part}]`);
    });
  });

  it('moves only when motion is allowed', () => {
    const rules = [...css.matchAll(/\[data-blok-preview='page'\][^{]*\{([^}]*)\}/g)];

    expect(rules.length).toBeGreaterThan(0);
    rules.forEach((rule) => {
      if (/\banimation\s*:/.test(rule[1])) {
        expect(motion).toContain(rule[0]);
      }
    });
  });

  it('marks the row with neutral ink, never blue', () => {
    const rules = [...css.matchAll(/\[data-blok-preview='page'\][^{]*\{([^}]*)\}/g)].map((rule) => rule[1]);

    rules.forEach((body) => {
      expect(body).not.toMatch(/blue|--blok-link/);
    });
  });
});
