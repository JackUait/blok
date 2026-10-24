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
const TERTIARY_TOKEN = 'var(--blok-database-ink-tertiary)';
const MENU_BG_DARK = 'rgb(37, 37, 37)';
const MENU_SHADOW_LIGHT = 'rgba(25, 25, 25, 0.05) 0 20px 24px, rgba(25, 25, 25, 0.027) 0 5px 8px, rgba(42, 28, 0, 0.07) 0 0 0 1px';
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
    expect(tokenValues('--blok-database-tab-bg-hover')).toEqual(['var(--blok-database-hover-bg)', BUTTON_BORDER_DARK, BUTTON_BORDER_DARK]);
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
    expect(tokenValues('--blok-database-popover-shadow')).toEqual([MENU_SHADOW_LIGHT, MENU_SHADOW_DARK, MENU_SHADOW_DARK]);
  });
});

describe('OPEN button in dark (research/22 §12)', () => {
  it('takes Notion\'s measured dark shadow and inner fill', () => {
    const shadow = 'rgb(56, 56, 54) 0 0 0 1px, rgba(25, 25, 25, 0.08) 0 4px 12px -2px';

    expect(tokenValues('--blok-database-table-open-shadow').slice(1)).toEqual([shadow, shadow]);
    // findings K06 (live): the pill is rgb(32, 32, 32), darker than the menus.
    expect(tokenValues('--blok-database-table-open-bg').slice(1)).toEqual(['rgb(32, 32, 32)', 'rgb(32, 32, 32)']);
  });
});

describe('"+ New page" in dark (research/22 §12)', () => {
  it('fills only the button on hover, with the header hover fill', () => {
    const hover = ruleBody('[data-blok-database-table-add-row]:hover');

    expect(hover).toContain('background-color: var(--blok-database-table-header-hover-bg)');
    expect(ruleBody('[data-blok-database-table-add-row]')).toContain('width: fit-content');
    expect(tokenValues('--blok-database-table-header-hover-bg')).toEqual(['var(--blok-database-hover-bg)', 'rgba(255, 255, 255, 0.055)', 'rgba(255, 255, 255, 0.055)']);
  });

  it('greys its words to the dark tertiary AA step and its plus to the measured dark ink', () => {
    expect(tokenValues('--blok-database-table-muted-text').slice(1)).toEqual([TERTIARY_TOKEN, TERTIARY_TOKEN]);
    expect(tokenValues('--blok-database-table-gutter-icon').slice(1)).toEqual(['rgb(125, 122, 117)', 'rgb(125, 122, 117)']);
  });
});

describe('select pills in dark (research/22 §12)', () => {
  it.each([
    ['default', 'rgba(255, 255, 243, 0.082)', 'rgb(240, 239, 237)'],
    ['brown', 'rgba(255, 184, 132, 0.365)', 'rgb(245, 237, 233)'],
    ['red', 'rgba(255, 116, 105, 0.525)', 'rgb(252, 233, 231)'],
  ])('%s keeps the measured dark fill and ink', (color, bg, ink) => {
    expect(tokenValues(`--blok-database-option-${color}-bg`).slice(1)).toEqual([bg, bg]);
    expect(tokenValues(`--blok-database-option-${color}-text`).slice(1)).toEqual([ink, ink]);
  });
});

/** Notion's dark tertiary ink (research/21 §1a); it fails AA on Blok's dark surfaces. */
const NOTION_DARK_TERTIARY = 'rgb(125, 122, 117)';
const DARK_MENU = 'rgb(37, 37, 37)';
/** Blok's dark page #191919, and #1d1d1c, which hosts can keep by setting --blok-bg-primary. */
const DARK_PAGES = ['rgb(25, 25, 25)', 'rgb(29, 29, 28)'];

/** One shared AA step; database-notion-colours.test.ts pins why it is this value. */
const darkTertiary = (): string => {
  const dark = tokenValues('--blok-database-ink-tertiary').slice(1);

  expect(dark).toEqual(['rgb(143, 140, 135)', 'rgb(143, 140, 135)']);

  return dark[0];
};

describe('date picker in dark (research/21 §1l, research/08)', () => {
  it('inks the weekday header with the measured dark value, light unchanged', () => {
    expect(ruleBody('[data-blok-database-date-weekday]')).toContain('color: var(--blok-database-date-weekday-text)');
    expect(tokenValues('--blok-database-date-weekday-text')).toEqual(['var(--blok-database-ink-tertiary)', 'rgb(139, 152, 152)', 'rgb(139, 152, 152)']);
    expect(contrast('rgb(139, 152, 152)', DARK_MENU)).toBeGreaterThanOrEqual(4.5);
  });

  it('sets "Today" at 12px weight 500 in tertiary ink, the measured gray in dark', () => {
    const body = ruleBody('[data-blok-database-date-today]');

    expect(body).toContain('font-size: 12px');
    expect(body).toContain('font-weight: 500');
    expect(body).toContain('color: var(--blok-database-date-today-text)');
    expect(tokenValues('--blok-database-date-today-text')).toEqual(['var(--blok-database-ink-tertiary)', 'rgb(142, 139, 134)', 'rgb(142, 139, 134)']);
    expect(contrast('rgb(142, 139, 134)', DARK_MENU)).toBeGreaterThanOrEqual(4.5);
  });

  it('inks the Remind and date setting values with the measured dark secondary', () => {
    expect(ruleBody('[data-blok-database-date-remind-value]')).toContain('color: var(--blok-database-date-setting-value-text)');
    expect(tokenValues('--blok-database-date-setting-value-text')).toEqual(['var(--blok-database-ink-secondary)', 'rgb(173, 169, 163)', 'rgb(173, 169, 163)']);
  });
});

describe('panels in dark (research/21 §1c, §1l)', () => {
  it('inks row values and the rule operator with the AA step of Notion\'s tertiary', () => {
    expect(ruleBody('[data-blok-database-panel-value]')).toContain('color: var(--blok-database-panel-value-text)');
    const [light, ...dark] = tokenValues('--blok-database-panel-value-text');

    expect(light).toBe(TERTIARY_TOKEN);
    expect(dark).toEqual([TERTIARY_TOKEN, TERTIARY_TOKEN]);
    expect(contrast(NOTION_DARK_TERTIARY, DARK_MENU)).toBeLessThan(4.5);
    expect(contrast(darkTertiary(), DARK_MENU)).toBeGreaterThanOrEqual(4.5);
  });

  it('fills a panel field with Notion\'s dark menu field fill', () => {
    expect(ruleBody('[data-blok-database-panel-input]')).toContain('background-color: var(--blok-database-panel-input-bg)');
    expect(tokenValues('--blok-database-panel-input-bg')).toEqual(['rgba(66, 35, 3, 0.03)', 'rgba(252, 252, 252, 0.03)', 'rgba(252, 252, 252, 0.03)']);
  });

  it('inks "Add sort" and "Delete sort" secondary, the measured dark value in dark', () => {
    expect(ruleBody('[data-blok-database-panel-row][data-muted]')).toContain('color: var(--blok-database-panel-muted-text)');
    expect(tokenValues('--blok-database-panel-muted-text')).toEqual(['var(--blok-database-ink-secondary)', 'rgb(173, 169, 163)', 'rgb(173, 169, 163)']);
  });
});

describe('"+ Filter" in dark (research/21 §1c)', () => {
  it('takes the AA step of Notion\'s tertiary on the dark page', () => {
    expect(ruleBody('[data-blok-database-filter-add]')).toContain('color: var(--blok-database-filter-add-text)');
    const [light, ...dark] = tokenValues('--blok-database-filter-add-text');

    expect(light).toBe(TERTIARY_TOKEN);
    expect(dark).toEqual([TERTIARY_TOKEN, TERTIARY_TOKEN]);
    for (const page of DARK_PAGES) {
      expect(contrast(NOTION_DARK_TERTIARY, page)).toBeLessThan(4.5);
      expect(contrast(darkTertiary(), page)).toBeGreaterThanOrEqual(4.5);
    }
  });
});

describe('form answer field in dark (research/21 §1k)', () => {
  it('rings the field with the measured value in both themes', () => {
    expect(ruleBody('[data-blok-database-form-question] :is(input:not([type="checkbox"], [type="radio"]), textarea, select, [data-blok-database-form-provider-answer])'))
      .toContain('border: 1px solid var(--blok-database-form-answer-border)');
    expect(tokenValues('--blok-database-form-answer-border')).toEqual(['rgb(240, 239, 237)', 'rgb(44, 44, 43)', 'rgb(44, 44, 43)']);
  });
});

describe('"Empty" in the row page, dark (research/21 §1m)', () => {
  it('takes the AA step of Notion\'s tertiary on the peek', () => {
    const peek = 'rgb(32, 32, 32)';

    expect(ruleBody('[data-blok-database-cell][data-empty]')).toContain('color: var(--blok-database-cell-empty-text)');
    const [light, ...dark] = tokenValues('--blok-database-cell-empty-text');

    expect(light).toBe(TERTIARY_TOKEN);
    expect(dark).toEqual([TERTIARY_TOKEN, TERTIARY_TOKEN]);
    expect(contrast(NOTION_DARK_TERTIARY, peek)).toBeLessThan(4.5);
    expect(contrast(darkTertiary(), peek)).toBeGreaterThanOrEqual(4.5);
  });
});
