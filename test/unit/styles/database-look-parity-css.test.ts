/**
 * Database chrome against Notion's measured values (research/07 and 08).
 * jsdom has no CSS, so these read the authored source; the computed look is
 * pinned in test/playwright/tests/database/database-look-parity.spec.ts.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const database = readFileSync(resolve(__dirname, '../../../src/styles/database.css'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/\s+/g, ' ');

/** Every declaration block whose selector list contains `selector`, joined. */
const ruleBody = (selector: string): string =>
  [ ...database.matchAll(/(?<=^|[{}])\s*([^{}@]+?)\s*\{([^{}]*)\}/g) ]
    .filter((rule) => rule[1].split(/,(?![^(]*\))/).map((part) => part.trim()).includes(selector))
    .map((rule) => rule[2])
    .join(';');

/** A token's value in the light block, then the two dark blocks. */
const tokenValues = (name: string): string[] =>
  [ ...database.matchAll(new RegExp(`${name}: ([^;]+);`, 'g')) ].map((m) => m[1].trim());

const reducedMotion = (): string =>
  [ ...database.matchAll(/@media \(prefers-reduced-motion: reduce\) \{((?:[^{}]*\{[^{}]*\})*[^{}]*)\}/g) ].map((m) => m[1]).join(' ');

describe('view tabs (research/07:45-50, 222)', () => {
  it('are 6px 12px pills with a 14px/16.8px 500 label and a 20px icon', () => {
    const body = ruleBody('[data-blok-database-tab]');

    expect(body).toContain('padding: var(--blok-space-1-5) var(--blok-space-3)');
    expect(body).toContain('border-radius: var(--blok-radius-pill)');
    expect(body).toContain('line-height: 16.8px');
    expect(body).toContain('font-weight: 500');
    expect(ruleBody('[data-blok-database-tab] svg')).toContain('width: 20px');
  });

  it('take Notion ink and fill in light and dark', () => {
    expect(tokenValues('--blok-database-tab-bg-active')).toEqual(['rgba(33, 27, 23, 0.05)', 'rgba(255, 255, 255, 0.055)', 'rgba(255, 255, 255, 0.055)']);
    expect(tokenValues('--blok-database-tab-text')).toEqual(['rgb(125, 122, 117)', 'rgb(173, 169, 163)', 'rgb(173, 169, 163)']);
    expect(tokenValues('--blok-database-tab-text-active')).toEqual(['rgb(44, 44, 43)', 'rgb(240, 239, 237)', 'rgb(240, 239, 237)']);
  });
});

describe('tab "Display as" (research/03 §1.2)', () => {
  it('drops the icon for text only, and hides the name visually, not from screen readers, for icon only', () => {
    expect(ruleBody('[data-blok-database-tab-bar][data-display="text"] [data-blok-database-tab-icon]')).toContain('display: none');
    const iconOnly = ruleBody('[data-blok-database-tab-bar][data-display="icon"] [data-blok-database-tab-name]');

    expect(iconOnly).toContain('clip-path: inset(50%)');
    expect(iconOnly).not.toContain('display: none');
  });
});

describe('toolbar Filter and Sort (research/07:53)', () => {
  it('are 28px icon buttons in Notion icon gray', () => {
    const body = ruleBody('[data-blok-database-view-toolbar] [data-blok-database-toolbar-icon]');

    expect(body).toContain('width: 28px');
    expect(body).toContain('height: 28px');
    expect(body).toContain('color: var(--blok-database-table-header-icon)');
  });
});

describe('board card (research/07:132-135, 08:73, 317)', () => {
  it('is at least 40px with an ink title', () => {
    expect(ruleBody('[data-blok-database-card]')).toContain('min-height: 40px');
    expect(ruleBody('[data-blok-database-card-title]')).toContain('color: var(--blok-database-table-cell-text)');
  });

  it('shows a white action pill with the menu shadow that fades in 200ms', () => {
    const body = ruleBody('[data-blok-database-card-actions]');

    expect(body).toContain('background: var(--blok-database-card-actions-bg)');
    expect(body).toContain('box-shadow: var(--blok-database-table-open-shadow)');
    expect(body).toContain('transition: opacity 200ms ease');
    expect(tokenValues('--blok-database-card-actions-bg')).toEqual(Array(3).fill('var(--blok-database-table-open-bg)'));
    expect(ruleBody('[data-blok-database-card-menu]')).toContain('height: 24px');
  });

  it('keeps the action icons readable on hover: no white-on-dark ink left', () => {
    expect(ruleBody('[data-blok-database-card-menu]:hover')).not.toContain('--blok-text-on-dark');
  });

  it('stops the pill fade under reduced motion', () => {
    expect(reducedMotion()).toMatch(/\[data-blok-database-card-actions\][^{]*\{[^}]*transition: none/);
  });
});

describe('table cells (research/07:69-75, 98; 08:279-280, 380)', () => {
  it('keep 37px rows with a 24px file chip or button: 6px block padding', () => {
    const body = ruleBody('[data-blok-database-table-cell]:is([data-type="files"], [data-type="button"])');

    expect(body).toContain('padding-block: var(--blok-space-1-5)');
  });

  it('pad person cells 8px like select', () => {
    expect(ruleBody('[data-blok-database-table-cell][data-type="person"]')).toContain('padding: var(--blok-space-2)');
  });

  it('space multi-select pills 8px', () => {
    expect(ruleBody('[data-blok-database-table-cell][data-type="multiSelect"] > [data-blok-database-cell]')).toContain('gap: var(--blok-space-2)');
  });

  it('draw URL, email and phone in ink with no underline, beating the holder link utility', () => {
    const body = ruleBody('[data-blok-database-cell] [data-blok-database-cell-link]');

    expect(body).toContain('color: inherit');
    expect(body).toContain('text-decoration: none');
    expect(body).toContain('white-space: pre-wrap');
  });

  it('keep an unwrapped table cell on one line', () => {
    expect(ruleBody('[data-blok-database-table-cell]:not([data-wrap]) [data-blok-database-cell-link]')).toContain('white-space: inherit');
  });

  it('set the button label 500 on a 16.8px line', () => {
    const body = ruleBody('[data-blok-database-button]');

    expect(body).toContain('font-weight: 500');
    expect(body).toContain('line-height: 16.8px');
  });
});

describe('select editor head (research/08:306)', () => {
  it('tints the chips and search area, pads it 4px and draws an inset bottom line', () => {
    const body = ruleBody('[data-blok-database-select-chips]');

    expect(body).toContain('background-color: var(--blok-database-select-head-bg)');
    expect(body).toContain('padding: var(--blok-space-1)');
    expect(body).toContain('box-shadow: var(--blok-database-table-control-border) 0 -1px 0 0 inset');
    expect(tokenValues('--blok-database-select-head-bg')[0]).toBe('rgba(242, 241, 238, 0.6)');
  });
});

describe('fill handle (D3)', () => {
  it('rings in the gray anchor ink, never the blue focus ring', () => {
    const body = ruleBody('[data-blok-database-table-fill-handle]');

    expect(body).toContain('border: 2px solid var(--blok-database-table-cell-ring)');
    expect(body).not.toContain('--blok-focus-ring');
  });
});

describe('side peek properties (research/08:329)', () => {
  it('use 34px rows and Notion secondary ink labels', () => {
    expect(ruleBody('[data-blok-database-drawer-prop-row]')).toContain('min-height: 34px');
    expect(ruleBody('[data-blok-database-drawer-prop-label]')).toContain('color: var(--blok-database-peek-label)');
    expect(tokenValues('--blok-database-peek-label')[0]).toBe('rgb(125, 122, 117)');
  });
});

describe('dark option pills (research/08:294-296)', () => {
  it.each([
    ['purple', 'rgba(208, 147, 255, 0.427)', 'rgb(243, 235, 249)'],
    ['pink', 'rgba(255, 133, 192, 0.427)', 'rgb(250, 233, 241)'],
    ['red', 'rgba(255, 116, 105, 0.525)', 'rgb(252, 233, 231)'],
  ])('%s uses the measured values in both dark blocks', (color, bg, text) => {
    expect(tokenValues(`--blok-database-option-${color}-bg`).slice(1)).toEqual([bg, bg]);
    expect(tokenValues(`--blok-database-option-${color}-text`).slice(1)).toEqual([text, text]);
  });
});
