/**
 * Database surfaces take Notion's measured colours (USER 2026-10-21; audit in
 * docs/plans/2026-10-09-database-notion-parity/34-colour-audit-2026-10-21.md).
 * Text that fails WCAG AA at Notion's value keeps the nearest passing step.
 * jsdom has no CSS, so these read the source; the computed look is checked in a built page.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { TOOLTIP_MUTED_INK } from '../../../src/components/modules/toolbar/tooltip';

const read = (file: string): string => readFileSync(resolve(__dirname, '../../../src/styles', file), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/\s+/g, ' ');

const database = read('database.css');
const colors = read('colors.css');
const tokens = read('tokens.css');

/** The light token block, the prefers-color-scheme dark block and the data-blok-theme dark block. */
const blocks = (css: string): [string, string, string] => {
  const light = css.match(/:where\(\[data-blok-interface\]\), :where\(\[data-blok-popover\]\), :where\(\[data-blok-top-layer\]\) \{([^}]*)\}/);
  const media = css.match(/:where\(:root:not\(\[data-blok-theme="light"\]\) \[data-blok-top-layer\]\) \{([^}]*)\}/);
  const attr = css.match(/:where\(\[data-blok-theme="dark"\] \[data-blok-top-layer\]\) \{([^}]*)\}/);

  if (light === null || media === null || attr === null) {
    throw new Error('token blocks not found');
  }

  return [light[1], media[1], attr[1]];
};

const [dbLight, dbMedia, dbAttr] = blocks(database);
const [colorsLight, colorsMedia, colorsAttr] = blocks(colors);

const value = (block: string, name: string): string | undefined =>
  block.match(new RegExp(`${name}: ([^;]+);`))?.[1].trim();

/** A token's light value and its value in both dark blocks (dark falls back to light when unset). */
const themed = (name: string): { light: string | undefined; dark: string | undefined; attr: string | undefined } => {
  const light = value(dbLight, name);

  return { light, dark: value(dbMedia, name) ?? light, attr: value(dbAttr, name) ?? light };
};

/** Rules outside the three token blocks. */
const rules = database
  .replace(/:where\(\[data-blok-interface\]\), :where\(\[data-blok-popover\]\), :where\(\[data-blok-top-layer\]\) \{[^}]*\}/, '')
  .replace(/:where\(:root:not\(\[data-blok-theme="light"\]\) \[data-blok-interface\]\), :where\(:root:not\(\[data-blok-theme="light"\]\) \[data-blok-popover\]\), :where\(:root:not\(\[data-blok-theme="light"\]\) \[data-blok-top-layer\]\) \{[^}]*\}/, '')
  .replace(/:where\(\[data-blok-theme="dark"\] \[data-blok-interface\]\), :where\(\[data-blok-theme="dark"\] \[data-blok-popover\]\), :where\(\[data-blok-theme="dark"\] \[data-blok-top-layer\]\) \{[^}]*\}/, '');

const ruleBody = (selector: string): string =>
  [ ...rules.matchAll(/(?<=^|[{}])\s*([^{}@]+?)\s*\{([^{}]*)\}/g) ]
    .filter((rule) => rule[1].split(/,(?![^(]*\))/).map((part) => part.trim()).includes(selector))
    .map((rule) => rule[2])
    .join(';');

const channels = (css: string): number[] => {
  const match = css.match(/rgba?\(([^)]+)\)/);

  if (match === null) {
    throw new Error(`not an rgb colour: ${css}`);
  }

  return match[1].split(',').map((part) => Number(part.trim()));
};

const linear = (c: number): number => {
  const v = c / 255;

  return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
};

const luminance = ([r, g, b]: number[]): number => 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);

/** Paints `top` (rgba allowed) over an opaque `base`. */
const over = (top: number[], base: number[]): number[] => {
  const alpha = top[3] ?? 1;

  return [0, 1, 2].map((i) => top[i] * alpha + base[i] * (1 - alpha));
};

const contrast = (ink: string, surface: number[]): number => {
  const a = luminance(over(channels(ink), surface));
  const b = luminance(surface);

  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
};

const WHITE = [255, 255, 255];
const LIGHT_HOVER = over([33, 27, 23, 0.051], WHITE);
const DARK_PAGE = [25, 25, 25];
const DARK_MENU = [37, 37, 37];
const DARK_CARD_HOVER = [38, 38, 38];

beforeEach(() => vi.clearAllMocks());
afterEach(() => vi.restoreAllMocks());

describe('tooltips take Notion\'s look in both themes (research/26 §5, research/31 §1)', () => {
  it.each([
    ['light', colorsLight],
    ['dark (media)', colorsMedia],
    ['dark (attribute)', colorsAttr],
  ])('%s: bg rgb(44, 44, 43), ink rgb(240, 239, 237)', (_theme, block) => {
    expect(value(block, '--blok-tooltip-bg')).toBe('rgb(44, 44, 43)');
    expect(value(block, '--blok-tooltip-font')).toBe('rgb(240, 239, 237)');
  });

  it('the tooltip shadow is Notion\'s soft drop plus a 5% inner ring', () => {
    expect(value(tokens, '--shadow-tooltip')).toBe('0 4px 12px -2px rgba(0, 0, 0, 0.08), inset 0 0 0 1px rgba(255, 255, 255, 0.05)');
  });

  it('a hint\'s highlighted word uses the tooltip ink, and the lightbox shortcut the second-line ink', () => {
    const tooltip = readFileSync(resolve(__dirname, '../../../src/components/modules/toolbar/tooltip.ts'), 'utf8');

    expect(tooltip).toContain("span.style.color = 'var(--blok-tooltip-font)';");
    expect(value(colorsLight, '--blok-image-lightbox-shortcut-fg')).toBe('rgb(173, 169, 163)');
  });

  it('the toolbox preview card, Notion\'s slash-menu hint, writes in the tooltip ink', () => {
    const preview = read('block-preview.css');

    expect(preview).toContain("[data-blok-interface='block-preview'] [data-blok-preview-card] { padding: var(--blok-preview-card-pad); border-radius: var(--blok-radius-surface); --blok-radius-inner: max(var(--blok-radius-floor), calc(var(--blok-radius-surface) - var(--blok-preview-card-pad))); background: var(--blok-tooltip-bg); color: var(--blok-tooltip-font);");
  });

  it('a hint\'s second line is Notion\'s inverse secondary ink', () => {
    expect(TOOLTIP_MUTED_INK).toBe('rgb(173, 169, 163)');
    expect(contrast(TOOLTIP_MUTED_INK, [44, 44, 43])).toBeGreaterThanOrEqual(4.5);
  });
});

describe('database inks', () => {
  it('primary ink is Notion\'s in both themes', () => {
    expect(themed('--blok-database-ink')).toEqual({ light: 'rgb(44, 44, 43)', dark: 'rgb(240, 239, 237)', attr: 'rgb(240, 239, 237)' });
  });

  it('secondary ink: Notion\'s 125,122,117 is 4.27:1 in light, so the AA step; dark is Notion\'s', () => {
    expect(contrast('rgb(125, 122, 117)', WHITE)).toBeLessThan(4.5);
    expect(themed('--blok-database-ink-secondary')).toEqual({ light: 'rgb(114, 111, 106)', dark: 'rgb(173, 169, 163)', attr: 'rgb(173, 169, 163)' });
  });

  it('tertiary ink fails AA at Notion\'s value in both themes, so both take the AA step', () => {
    expect(contrast('rgb(161, 158, 153)', WHITE)).toBeLessThan(4.5);
    expect(contrast('rgb(125, 122, 117)', DARK_PAGE)).toBeLessThan(4.5);
    expect(themed('--blok-database-ink-tertiary')).toEqual({ light: 'rgb(114, 111, 106)', dark: 'rgb(143, 140, 135)', attr: 'rgb(143, 140, 135)' });
  });

  it('every step passes AA on the worst surface it sits on', () => {
    expect(contrast('rgb(114, 111, 106)', LIGHT_HOVER)).toBeGreaterThanOrEqual(4.5);
    expect(contrast('rgb(143, 140, 135)', DARK_CARD_HOVER)).toBeGreaterThanOrEqual(4.5);
    expect(contrast('rgb(143, 140, 135)', DARK_MENU)).toBeGreaterThanOrEqual(4.5);
  });

  it('hover fill is Notion\'s 0.051 in light and 0.055 white in dark', () => {
    expect(themed('--blok-database-hover-bg')).toEqual({ light: 'rgba(33, 27, 23, 0.051)', dark: 'rgba(255, 255, 255, 0.055)', attr: 'rgba(255, 255, 255, 0.055)' });
  });

  it('the database title is inked inline in the database ink, not the core primary (black)', () => {
    const tool = readFileSync(resolve(__dirname, '../../../src/tools/database/index.ts'), 'utf8');

    expect(tool).toContain("titleEl.style.color = 'var(--blok-database-ink)';");
    expect(tool).not.toContain('var(--blok-text-primary)');
  });

  it('the database root paints its text in the database ink, so cards, list rows and titles inherit it', () => {
    expect(ruleBody('[data-blok-database-wrapper]')).toContain('color: var(--blok-database-ink)');
  });

  it.each([
    '--blok-text-primary',
    '--blok-text-secondary',
    '--blok-text-tertiary',
    '--blok-item-hover-bg',
    '--blok-popover-border',
    '--blok-accent',
    '--blok-text-on-dark',
    '--blok-toggle-on-bg',
    '--blok-border-primary',
    '--blok-bg-hover',
  ])('no database rule paints with the core %s (it is not Notion\'s value)', (token) => {
    expect(database).not.toMatch(new RegExp(`var\\(${token}[,)]`));
  });
});

describe('database menus built on the shared popover (research/08:267, research/21 §1a)', () => {
  const MENU = "[data-blok-popover][data-blok-popover-custom-class~='blok-database-menu']";

  it('re-set the core popover tokens to Notion\'s menu shadow, inks and hover fill', () => {
    const body = ruleBody(MENU);

    expect(body).toContain('--blok-popover-box-shadow: var(--blok-database-cell-editor-shadow)');
    expect(body).toContain('--blok-text-primary: var(--blok-database-ink)');
    expect(body).toContain('--blok-text-secondary: var(--blok-database-ink-secondary)');
    expect(body).toContain('--blok-icon-active-text: var(--blok-database-ink)');
  });

  // A literal per theme: the selected-state law rejects a token that aliases an alias.
  it('re-set the hover fill to Notion\'s, light and both dark shapes', () => {
    const dark = /\[data-blok-theme="dark"\] \[data-blok-popover\]\[data-blok-popover-custom-class~='blok-database-menu'\] \{([^}]*)\}/;
    const media = /:root:not\(\[data-blok-theme="light"\]\) \[data-blok-popover\]\[data-blok-popover-custom-class~='blok-database-menu'\] \{([^}]*)\}/;

    expect(ruleBody(MENU)).toContain('--blok-item-hover-bg: rgba(33, 27, 23, 0.051)');
    expect(rules.match(media)?.[1]).toContain('--blok-item-hover-bg: rgba(255, 255, 255, 0.055)');
    expect(rules.match(dark)?.[1]).toContain('--blok-item-hover-bg: rgba(255, 255, 255, 0.055)');
  });
});

describe('text tokens that held a failing Notion value take the AA step', () => {
  it.each([
    ['--blok-database-table-header-text', '--blok-database-ink-secondary'],
    ['--blok-database-table-calc-value', '--blok-database-ink-secondary'],
    ['--blok-database-tab-text', '--blok-database-ink-secondary'],
    ['--blok-database-peek-label', '--blok-database-ink-secondary'],
    ['--blok-database-gallery-preview-text', '--blok-database-ink-secondary'],
    ['--blok-database-table-muted-text', '--blok-database-ink-tertiary'],
    ['--blok-database-calendar-muted-text', '--blok-database-ink-tertiary'],
    ['--blok-database-timeline-muted-text', '--blok-database-ink-tertiary'],
    ['--blok-database-gallery-muted-text', '--blok-database-ink-tertiary'],
  ])('light %s takes the AA step %s', (name, step) => {
    expect(themed(name).light).toBe(`var(${step})`);
  });

  it.each([
    '--blok-database-table-muted-text',
    '--blok-database-calendar-muted-text',
    '--blok-database-timeline-muted-text',
    '--blok-database-gallery-muted-text',
    '--blok-database-cell-empty-text',
    '--blok-database-filter-add-text',
    '--blok-database-panel-value-text',
  ])('%s takes the dark tertiary step', (name) => {
    const { dark, attr } = themed(name);

    expect(dark).toBe('var(--blok-database-ink-tertiary)');
    expect(attr).toBe('var(--blok-database-ink-tertiary)');
  });

  it('calendar event text passes on the hovered card too, which is darker in light and lighter in dark', () => {
    const { light, dark, attr } = themed('--blok-database-calendar-event-muted-text');
    const lightHover = over([84, 72, 49, 0.08], WHITE);

    expect(contrast('rgb(114, 111, 106)', lightHover)).toBeLessThan(4.5);
    expect(light).toBe('rgb(112, 109, 104)');
    expect(dark).toBe('rgb(162, 159, 154)');
    expect(attr).toBe('rgb(162, 159, 154)');
    expect(contrast('rgb(112, 109, 104)', lightHover)).toBeGreaterThanOrEqual(4.5);
    expect(contrast('rgb(162, 159, 154)', [55, 55, 55])).toBeGreaterThanOrEqual(4.5);
    expect(ruleBody('[data-blok-database-calendar-event-property]')).toContain('color: var(--blok-database-calendar-event-muted-text)');
  });

  it('reminder dates keep Notion\'s blue hue at the nearest passing step', () => {
    expect(contrast('rgb(39, 131, 222)', WHITE)).toBeLessThan(4.5);
    expect(themed('--blok-database-reminder-text')).toEqual({ light: 'rgb(35, 119, 211)', dark: 'rgb(41, 137, 232)', attr: 'rgb(41, 137, 232)' });
    expect(contrast('rgb(35, 119, 211)', WHITE)).toBeGreaterThanOrEqual(4.5);
    expect(contrast('rgb(41, 137, 232)', [32, 32, 32])).toBeGreaterThanOrEqual(4.5);
  });

  it('the destructive outline button keeps Notion\'s red hue at the nearest passing step in light', () => {
    expect(contrast('rgb(229, 100, 88)', WHITE)).toBeLessThan(4.5);
    expect(themed('--blok-database-confirm-destructive-text').light).toBe('rgb(182, 79, 70)');
    expect(contrast('rgb(182, 79, 70)', LIGHT_HOVER)).toBeGreaterThanOrEqual(4.5);
    expect(contrast('rgb(229, 100, 88)', DARK_MENU)).toBeGreaterThanOrEqual(4.5);
  });

  it('dark unselected structure tile labels take the step (Notion\'s 90,90,90 is 2.5:1)', () => {
    expect(themed('--blok-database-builder-tile-text').dark).toBe('var(--blok-database-ink-tertiary)');
  });
});

describe('fills and lines that differed from Notion', () => {
  it('hover fills are Notion\'s 0.051 in light', () => {
    for (const name of ['--blok-database-table-header-hover-bg', '--blok-database-tab-bg-hover', '--blok-database-card-menu-hover-bg', '--blok-database-popover-hover']) {
      expect(themed(name).light).toBe('var(--blok-database-hover-bg)');
    }
    expect(themed('--blok-database-popover-hover').dark).toBe('var(--blok-database-hover-bg)');
  });

  it('a checked checkbox is Notion\'s blue in both themes (research/07:75, 07:223)', () => {
    expect(themed('--blok-database-checkbox-checked-bg')).toEqual({ light: 'rgb(39, 131, 222)', dark: 'rgb(39, 131, 222)', attr: 'rgb(39, 131, 222)' });
    expect(ruleBody('[data-blok-database-checkbox][data-state="checked"]')).toContain('background-color: var(--blok-database-checkbox-checked-bg)');
  });

  it('a switch that is on is Notion\'s blue (research/08:109)', () => {
    expect(themed('--blok-database-switch-on-bg').light).toBe('rgb(39, 131, 222)');
  });

  it('board: light blue and green columns use the measured tint and card ring (research/21 §1f)', () => {
    expect(value(dbLight, '--blok-database-column-blue-bg')).toBe('rgba(0, 128, 213, 0.047)');
    expect(value(dbLight, '--blok-database-column-blue-ring')).toBe('rgba(0, 124, 215, 0.094)');
    expect(value(dbLight, '--blok-database-column-green-bg')).toBe('rgba(3, 87, 31, 0.035)');
    expect(value(dbLight, '--blok-database-column-green-ring')).toBe('rgba(0, 100, 45, 0.09)');
  });

  it('board: Notion\'s blue and green counts fail AA on their light tint, so they keep the pill text', () => {
    expect(contrast('rgb(39, 131, 222)', over([0, 128, 213, 0.047], WHITE))).toBeLessThan(4.5);
    expect(contrast('rgb(70, 161, 113)', over([3, 87, 31, 0.035], WHITE))).toBeLessThan(4.5);
    expect(value(dbLight, '--blok-database-column-blue-accent')).toBe('var(--blok-database-option-blue-text)');
    expect(value(dbLight, '--blok-database-column-green-accent')).toBe('var(--blok-database-option-green-text)');
  });

  it('board: the dark blue count takes the nearest passing step (Notion\'s is 4.2:1 on the tint)', () => {
    expect(value(dbMedia, '--blok-database-column-blue-accent')).toBe('rgb(41, 137, 232)');
    expect(value(dbAttr, '--blok-database-column-blue-accent')).toBe('rgb(41, 137, 232)');
  });

  it('board: the default column looks like the plain (gray) column (research/08:72, 08:345, 08:347)', () => {
    expect(value(dbLight, '--blok-database-column-default-bg')).toBe('var(--blok-database-column-bg)');
    expect(value(dbLight, '--blok-database-column-default-ring')).toBe('var(--blok-database-card-ring)');
    expect(value(dbLight, '--blok-database-column-default-accent')).toBe('var(--blok-database-column-accent)');
  });

  it('board: a hovered light card takes Notion\'s 3% warm wash (research/07:134)', () => {
    expect(value(dbLight, '--blok-database-card-bg-hover')).toBe('rgba(54, 29, 2, 0.031)');
  });

  it('menus: the tab overflow list uses Notion\'s menu shadow in light', () => {
    expect(value(dbLight, '--blok-database-popover-shadow')).toBe('rgba(25, 25, 25, 0.05) 0 20px 24px, rgba(25, 25, 25, 0.027) 0 5px 8px, rgba(42, 28, 0, 0.07) 0 0 0 1px');
  });

  it('menus: a field inside a panel is Notion\'s warm 3% fill in light (research/26 §4a)', () => {
    expect(value(dbLight, '--blok-database-panel-input-bg')).toBe('rgba(66, 35, 3, 0.03)');
  });

  it('menus: the dark select editor head is Notion\'s 3% white (research/22 §4)', () => {
    expect(themed('--blok-database-select-head-bg').dark).toBe('rgba(255, 255, 255, 0.03)');
    expect(themed('--blok-database-select-head-bg').attr).toBe('rgba(255, 255, 255, 0.03)');
  });

  it('dialogs: dark is the raised 32 surface with Notion\'s dialog shadow (research/26 §5a)', () => {
    const shadow = 'rgb(56, 56, 54) 0 0 0 1px, rgba(25, 25, 25, 0.64) 0 24px 48px, rgba(25, 25, 25, 0.56) 0 4px 12px';

    expect(themed('--blok-database-confirm-bg').dark).toBe('rgb(32, 32, 32)');
    expect(themed('--blok-database-confirm-bg').attr).toBe('rgb(32, 32, 32)');
    expect(themed('--blok-database-confirm-shadow').dark).toBe(shadow);
    expect(themed('--blok-database-confirm-shadow').attr).toBe(shadow);
  });

  it('templates: "More templates" cards use Notion\'s light border (research/26 §2)', () => {
    expect(value(dbLight, '--blok-database-tpl-border')).toBe('rgb(230, 229, 227)');
  });

  it('form: the light answer field ring is Notion\'s (research/21 §1k)', () => {
    expect(value(dbLight, '--blok-database-form-answer-border')).toBe('rgb(240, 239, 237)');
  });

  it('peek: the light title is Notion\'s primary ink (research/26 §1e)', () => {
    expect(value(dbLight, '--blok-database-peek-title')).toBe('var(--blok-database-ink)');
  });

  // Both need the toolbar prefix: the toolbar's own `button` rule is more specific and painted them in primary ink.
  it('calendar prev / next chevrons are Notion\'s icon gray (research/07:171)', () => {
    expect(ruleBody('[data-blok-database-calendar-nav] [data-blok-database-calendar-prev]')).toContain('color: var(--blok-database-calendar-nav-icon)');
  });

  it('"Edit filters" and "No date (N)" are icon-gray words, so light takes the AA step (research/08:239, 21:139)', () => {
    expect(ruleBody('[data-blok-database-table-edit-filters]')).toContain('color: var(--blok-database-ink-secondary)');
    expect(ruleBody('[data-blok-database-calendar-nav] [data-blok-database-calendar-no-date]')).toContain('color: var(--blok-database-ink-secondary)');
  });

  it('timeline zoom, "+ New" and "Show table" labels are icon-gray text at the AA step (research/07:195)', () => {
    expect(ruleBody('[data-blok-database-timeline-toolbar] [data-blok-database-timeline-zoom]')).toContain('color: var(--blok-database-ink-secondary)');
  });
});
