import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { renderTabsPreview } from '../../../../src/tools/tabs/preview';

const css = readFileSync(resolve(__dirname, '../../../../src/styles/block-preview/structure.css'), 'utf8');
const MOTION = '@media (prefers-reduced-motion: no-preference)';
const still = css.slice(0, css.indexOf(MOTION));
const motion = css.slice(css.indexOf(MOTION));

const rulesFor = (source: string): RegExpMatchArray[] =>
  [...source.matchAll(/\[data-blok-preview='tabs'\][^{]*\{([^}]*)\}/g)];

describe('tabs toolbox preview', () => {
  it('is keyed as the tabs drawing and is fresh on every render', () => {
    const drawing = renderTabsPreview();

    expect(drawing.getAttribute('data-blok-preview')).toBe('tabs');
    expect(renderTabsPreview()).not.toBe(drawing);
  });

  it('shows a strip of three tabs with only the first active, above the tab content', () => {
    const drawing = renderTabsPreview();
    const tabs = [...drawing.querySelectorAll('[data-strip] [data-tab]')];

    expect(tabs.map((tab) => tab.getAttribute('data-tab'))).toStrictEqual(['active', '', '']);
    expect(tabs.every((tab) => (tab.textContent ?? '').length > 0)).toBe(true);
    expect(drawing.querySelector('[data-strip] + [data-panel]')).not.toBeNull();
    expect(drawing.querySelectorAll('[data-panel] [data-line]').length).toBeGreaterThanOrEqual(3);
  });

  it('styles every drawn part', () => {
    const parts = [...renderTabsPreview().querySelectorAll('*')]
      .flatMap((el) => el.getAttributeNames().filter((name) => name.startsWith('data-')));

    new Set(parts).forEach((part) => {
      expect(still, part).toContain(`[data-blok-preview='tabs'] [${part}]`);
    });
  });

  it('marks the active tab with neutral selected tokens, never blue', () => {
    const active = rulesFor(still).find((rule) => rule[0].includes("[data-tab='active']"));

    expect(active?.[1]).toContain('var(--blok-icon-active-bg)');
    expect(active?.[1]).toContain('var(--blok-icon-active-text)');
    expect(active?.[1]).not.toMatch(/blue|#[0-9a-f]{3,6}|rgb\(/i);
  });

  it('moves only when motion is allowed', () => {
    rulesFor(still).forEach((rule) => {
      expect(rule[1]).not.toMatch(/\banimation\s*:/);
    });
    expect(rulesFor(motion).some((rule) => /\banimation\s*:/.test(rule[1]))).toBe(true);
  });
});
