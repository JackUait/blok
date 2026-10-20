/**
 * Table chrome in dark against Notion's measured dark values (research/21 §1).
 * jsdom has no CSS, so these read the authored source; the computed look is
 * pinned in test/playwright/tests/database/database-dark-table-chrome.spec.ts.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const database = readFileSync(resolve(__dirname, '../../../src/styles/database.css'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/\s+/g, ' ');

const ruleBody = (selector: string): string =>
  [ ...database.matchAll(/(?<=^|[{}])\s*([^{}@]+?)\s*\{([^{}]*)\}/g) ]
    .filter((rule) => rule[1].split(/,(?![^(]*\))/).map((part) => part.trim()).includes(selector))
    .map((rule) => rule[2])
    .join(';');

/** A token's values in source order: light, system dark, forced dark. */
const tokenValues = (name: string): string[] =>
  [ ...database.matchAll(new RegExp(`${name}: ([^;]+);`, 'g')) ].map((m) => m[1].trim());

/** The declarations of the first block whose selector starts with `prefix`. */
const declarations = (prefix: string): Map<string, string> => {
  const start = database.indexOf(prefix);
  const open = database.indexOf('{', start);
  const body = database.slice(open + 1, database.indexOf('}', open));

  return new Map(body.split(';').map((d) => d.trim()).filter(Boolean).map((d) => {
    const colon = d.indexOf(':');

    return [d.slice(0, colon).trim(), d.slice(colon + 1).trim()];
  }));
};

const luminance = (rgb: string): number => {
  const channels = rgb.match(/\d+/g)?.slice(0, 3).map(Number) ?? [];

  const [r, g, b] = channels.map((v) => {
    const c = v / 255;

    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });

  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

const contrast = (a: string, b: string): number => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);

  return (hi + 0.05) / (lo + 0.05);
};

const BUTTON_BORDER_DARK = 'rgba(255, 255, 235, 0.1)';
const MENU_BG_DARK = 'rgb(37, 37, 37)';
const MENU_SHADOW_DARK = 'rgb(56, 56, 54) 0 0 0 1px, rgba(25, 25, 25, 0.2) 0 14px 28px -6px, rgba(25, 25, 25, 0.118) 0 2px 4px -1px';

describe('the two dark blocks', () => {
  it('declare the same tokens with the same values', () => {
    const system = declarations(':where(:root:not([data-blok-theme="light"]) [data-blok-interface])');
    const forced = declarations(':where([data-blok-theme="dark"] [data-blok-interface])');

    expect(system.size).toBeGreaterThan(0);
    expect(Object.fromEntries(forced)).toEqual(Object.fromEntries(system));
  });
});

describe('view tabs in dark (research/21 §1b)', () => {
  it('hover with Notion\'s dark tab hover fill', () => {
    expect(tokenValues('--blok-database-tab-bg-hover')).toEqual(['rgba(33, 27, 23, 0.05)', BUTTON_BORDER_DARK, BUTTON_BORDER_DARK]);
  });
});

describe('"New" split button in dark (research/21 §1b)', () => {
  it('gets lighter on hover, as Notion\'s does, and still passes AA for its words', () => {
    const [lightBg, darkBg] = tokenValues('--blok-database-new-bg');
    const [lightHover, ...darkHover] = tokenValues('--blok-database-new-hover-bg');
    const [text] = tokenValues('--blok-database-new-text');

    expect(darkHover).toEqual([ 'rgb(36, 115, 201)', 'rgb(36, 115, 201)' ]);
    expect(luminance(darkHover[0])).toBeGreaterThan(luminance(darkBg));
    expect(contrast(darkHover[0], text)).toBeGreaterThanOrEqual(4.5);
    // Light keeps Notion's darker hover.
    expect(luminance(lightHover)).toBeLessThan(luminance(lightBg));
  });

  it('splits the chevron with the dark button border', () => {
    expect(tokenValues('--blok-database-new-divider')).toEqual(['rgba(28, 19, 1, 0.11)', BUTTON_BORDER_DARK, BUTTON_BORDER_DARK]);
  });
});

describe('outline controls in dark (research/21 §1a)', () => {
  it('use Notion\'s dark button border', () => {
    expect(tokenValues('--blok-database-table-control-border')).toEqual(['rgba(28, 19, 1, 0.11)', BUTTON_BORDER_DARK, BUTTON_BORDER_DARK]);
  });
});

describe('selection bar in dark (research/21 §1e)', () => {
  it('keeps the OPEN shadow in light and takes the measured bar shadow in dark', () => {
    expect(ruleBody('[data-blok-database-table-selection-bar]')).toContain('box-shadow: var(--blok-database-table-selection-shadow)');
    const dark = 'rgb(56, 56, 54) 0 0 0 1px, rgba(25, 25, 25, 0.08) 0 4px 12px -2px';

    expect(tokenValues('--blok-database-table-selection-shadow')).toEqual(['var(--blok-database-table-open-shadow)', dark, dark]);
  });
});

describe('database menus in dark (research/21 §1a, §1l)', () => {
  it('re-set the menu fill and shadow in both dark blocks', () => {
    expect(tokenValues('--blok-database-popover-bg')).toEqual([MENU_BG_DARK, MENU_BG_DARK]);
    expect(tokenValues('--blok-database-popover-shadow')).toEqual([MENU_SHADOW_DARK, MENU_SHADOW_DARK]);
  });
});
