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
  const light = css.match(/:where\(\[data-blok-interface\]\), :where\(\[data-blok-popover\]\), :where\(\[data-blok-top-layer\]:not\(\[data-blok-interface\] \*\)\) \{([^}]*)\}/);
  const media = css.match(/:where\(:root:not\(\[data-blok-theme="light"\]\) \[data-blok-top-layer\]:not\(\[data-blok-interface\] \*\)\) \{([^}]*)\}/);
  const attr = css.match(/:where\(\[data-blok-theme="dark"\] \[data-blok-top-layer\]:not\(\[data-blok-interface\] \*\)\) \{([^}]*)\}/);

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
  .replace(/:where\(\[data-blok-theme="dark"\] \[data-blok-interface\]\), :where\(\[data-blok-theme="dark"\] \[data-blok-popover\]\), :where\(\[data-blok-theme="dark"\] \[data-blok-top-layer\]:not\(\[data-blok-interface\] \*\)\) \{[^}]*\}/, '');

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
/** Blok's dark page #191919, and #1d1d1c, which hosts can keep by setting --blok-bg-primary. Inks must pass on both. */
const DARK_PAGES = [[25, 25, 25], [29, 29, 28]];
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
    const dark = /\[data-blok-theme="dark"\] \[data-blok-popover\]\[data-blok-popover-custom-class~='blok-database-menu'\][^{]*\{([^}]*)\}/;
    const media = /:root:not\(\[data-blok-theme="light"\]\) \[data-blok-popover\]\[data-blok-popover-custom-class~='blok-database-menu'\][^{]*\{([^}]*)\}/;

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

  // notion-spec-2 §21.9: calendar card values are 12/18 ink. calendar-card.png: the email, date and phone glyphs are rgb(44, 44, 43).
  it('calendar event values take the database ink', () => {
    expect(ruleBody('[data-blok-database-calendar-event-property]')).toContain('color: var(--blok-database-ink)');
    expect(themed('--blok-database-calendar-event-muted-text')).toEqual({ light: undefined, dark: undefined, attr: undefined });
  });

  it('the form respondent chip takes Notion\'s dark fill (research/36 §13); light is unmeasured', () => {
    expect(themed('--blok-database-form-respondent-bg')).toEqual({ light: 'var(--blok-database-column-bg)', dark: 'rgba(255, 255, 255, 0.03)', attr: 'rgba(255, 255, 255, 0.03)' });
    expect(ruleBody('[data-blok-database-form-respondent]')).toContain('background-color: var(--blok-database-form-respondent-bg)');
    expect(ruleBody('[data-blok-database-form-anonymous]')).toContain('background-color: var(--blok-database-column-bg)');
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
  });

  // findings-board B21: the nearest AA step of Notion's hue, on the tint and under both hover fills ("+ New page", count, header buttons).
  it('board: the blue and green counts are Notion\'s hue darkened to the nearest AA step', () => {
    const blueTint = over([0, 128, 213, 0.047], WHITE);
    const greenTint = over([3, 87, 31, 0.035], WHITE);
    const fills = (tint: number[]): number[][] =>
      [tint, over([55, 53, 47, 0.06], tint), over([33, 27, 23, 0.051], tint)];

    expect(value(dbLight, '--blok-database-column-blue-accent')).toBe('rgb(33, 109, 185)');
    expect(value(dbLight, '--blok-database-column-green-accent')).toBe('rgb(52, 120, 85)');
    fills(blueTint).forEach((fill) => expect(contrast('rgb(33, 109, 185)', fill)).toBeGreaterThanOrEqual(4.5));
    fills(greenTint).forEach((fill) => expect(contrast('rgb(52, 120, 85)', fill)).toBeGreaterThanOrEqual(4.5));
    // One step lighter fails under a hover fill, so these are the nearest.
    expect(contrast('rgb(34, 110, 187)', fills(blueTint)[1])).toBeLessThan(4.5);
    expect(contrast('rgb(53, 122, 86)', fills(greenTint)[1])).toBeLessThan(4.5);
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
    expect(ruleBody('[data-blok-database-view-toolbar] [data-blok-database-no-date-button]')).toContain('color: var(--blok-database-ink-secondary)');
  });

  it('timeline zoom, "+ New" and "Show table" labels are icon-gray text at the AA step (research/07:195)', () => {
    expect(ruleBody('[data-blok-database-timeline-toolbar] [data-blok-database-timeline-zoom]')).toContain('color: var(--blok-database-ink-secondary)');
  });
});

describe('pass 2: research/33 §4 colour dump', () => {
  const both = (name: string, dark: string): void => {
    expect(value(dbMedia, name)).toBe(dark);
    expect(value(dbAttr, name)).toBe(dark);
  };

  it.each([
    ['orange', 'rgba(186, 72, 3, 0.043)', 'rgba(224, 101, 1, 0.13)', 'rgba(254, 139, 71, 0.043)', 'rgba(255, 134, 51, 0.157)'],
    ['purple', 'rgba(98, 3, 161, 0.03)', 'rgba(102, 0, 178, 0.08)', 'rgba(196, 101, 253, 0.05)', 'rgba(201, 122, 255, 0.165)'],
    ['pink', 'rgba(161, 3, 66, 0.03)', 'rgba(197, 0, 93, 0.086)', 'rgba(255, 78, 149, 0.055)', 'rgba(255, 104, 171, 0.165)'],
    ['red', 'rgba(199, 3, 3, 0.035)', 'rgba(223, 22, 0, 0.094)', 'rgba(251, 107, 107, 0.047)', 'rgba(255, 106, 94, 0.173)'],
  ])('board: the %s column takes Notion\'s tint and card ring in both themes', (color, lightBg, lightRing, darkBg, darkRing) => {
    expect(value(dbLight, `--blok-database-column-${color}-bg`)).toBe(lightBg);
    expect(value(dbLight, `--blok-database-column-${color}-ring`)).toBe(lightRing);
    both(`--blok-database-column-${color}-bg`, darkBg);
    both(`--blok-database-column-${color}-ring`, darkRing);
  });

  it('board: the light brown card ring is Notion\'s', () => {
    expect(value(dbLight, '--blok-database-column-brown-ring')).toBe('rgba(139, 46, 0, 0.086)');
    both('--blok-database-column-brown-ring', 'rgba(255, 174, 122, 0.133)');
  });

  // Worst surfaces: the hovered count (tint and the 0.055 hover over each dark page) and, where measured,
  // the hovered "+ New" row, which takes the hovered card's fill (research/36 §11).
  const DARK_ADD_HOVER = (tint: number[]): number[][] => DARK_PAGES.map((page) => over([255, 255, 255, 0.055], over(tint, page)));
  const DARK_ROW_HOVER: Record<string, number[]> = { red: [73, 44, 42] };
  const darkSurfaces = (color: string, tint: number[]): number[][] => [...DARK_ADD_HOVER(tint), ...(color in DARK_ROW_HOVER ? [DARK_ROW_HOVER[color]] : [])];
  const passesAll = (ink: string, surfaces: number[][]): boolean => surfaces.every((surface) => contrast(ink, surface) >= 4.5);

  it.each([
    ['orange', [213, 128, 59], [186, 72, 3, 0.043], [254, 139, 71, 0.043], 'rgb(214, 129, 60)'],
    ['purple', [181, 119, 214], [98, 3, 161, 0.03], [196, 101, 253, 0.05], 'rgb(186, 124, 219)'],
    ['red', [229, 100, 88], [199, 3, 3, 0.035], [251, 107, 107, 0.047], 'rgb(245, 116, 104)'],
    ['blue', [39, 131, 222], [0, 128, 213, 0.047], [41, 139, 253, 0.063], 'rgb(62, 154, 245)'],
    ['green', [70, 161, 113], [3, 87, 31, 0.035], [83, 255, 140, 0.035], 'rgb(77, 168, 120)'],
    ['brown', [182, 137, 101], [115, 59, 3, 0.035], [253, 158, 101, 0.05], 'rgb(187, 142, 106)'],
    ['pink', [219, 105, 153], [161, 3, 66, 0.03], [255, 78, 149, 0.055], 'rgb(226, 112, 160)'],
  ])('board: Notion\'s %s dot ink fails AA as a count in both themes, so dark takes the nearest step', (color, dot, lightTint, darkTint, step) => {
    const ink = `rgb(${dot.join(', ')})`;
    const lightAccent = value(dbLight, `--blok-database-column-${color}-accent`);

    expect(contrast(ink, over(lightTint, WHITE))).toBeLessThan(4.5);
    // Blue and green take the nearest light step (findings-board B21, tested above); the rest keep the pill text.
    const LIGHT_STEP: Record<string, string> = { blue: 'rgb(33, 109, 185)', green: 'rgb(52, 120, 85)' };

    expect(lightAccent === undefined || lightAccent === (LIGHT_STEP[color] ?? `var(--blok-database-option-${color}-text)`)).toBe(true);
    expect(passesAll(ink, darkSurfaces(color, darkTint))).toBe(false);
    both(`--blok-database-column-${color}-accent`, step);
    expect(passesAll(step, darkSurfaces(color, darkTint))).toBe(true);
    // Nearest: one channel step darker fails.
    expect(passesAll(`rgb(${channels(step).map((c) => c - 1).join(', ')})`, darkSurfaces(color, darkTint))).toBe(false);
  });

  it('board: dark cards in yellow and red columns take Notion\'s tinted card', () => {
    both('--blok-database-column-yellow-card-bg', 'rgb(55, 51, 37)');
    both('--blok-database-column-red-card-bg', 'rgb(65, 39, 37)');
    both('--blok-database-column-yellow-card-hover-bg', 'rgb(63, 58, 42)');
    both('--blok-database-column-red-card-hover-bg', 'rgb(73, 44, 42)');
  });

  it('board: a light red card hovers to Notion\'s red wash (research/36 §1.1)', () => {
    expect(value(dbLight, '--blok-database-column-red-card-hover-bg')).toBe('rgba(186, 3, 3, 0.035)');
    expect(value(dbLight, '--blok-database-column-red-bg')).toBe('rgba(199, 3, 3, 0.035)');
    both('--blok-database-column-red-bg', 'rgba(251, 107, 107, 0.047)');
  });

  it.each([
    ['brown', 'rgb(182, 137, 101)'],
    ['orange', 'rgb(213, 128, 59)'],
    ['yellow', 'rgb(216, 163, 47)'],
    ['purple', 'rgb(181, 119, 214)'],
    ['pink', 'rgb(219, 105, 153)'],
    ['red', 'rgb(229, 100, 88)'],
  ])('status: the %s dot is Notion\'s, the same in both themes', (color, dot) => {
    expect(themed(`--blok-database-status-dot-${color}`)).toEqual({ light: dot, dark: dot, attr: dot });
    expect(ruleBody(`[data-blok-database-option-pill][data-status-group][data-color="${color}"]::before`)).toContain(`background-color: var(--blok-database-status-dot-${color})`);
  });

  it('pressed: header cells and toolbar icons darken to Notion\'s pressed fill', () => {
    expect(themed('--blok-database-pressed-bg')).toEqual({ light: 'rgba(33, 27, 23, 0.102)', dark: 'rgba(255, 255, 255, 0.11)', attr: 'rgba(255, 255, 255, 0.11)' });
    expect(ruleBody('[data-blok-database-table-column-header]:active')).toContain('background-image: linear-gradient(var(--blok-database-pressed-bg), var(--blok-database-pressed-bg))');
    expect(ruleBody('[data-blok-database-view-toolbar] > button:active')).toContain('background-color: var(--blok-database-pressed-bg)');
  });

  it('pressed: a gallery card takes Notion\'s pressed fill', () => {
    expect(themed('--blok-database-gallery-card-active-bg')).toEqual({ light: 'rgba(55, 53, 47, 0.06)', dark: 'rgb(37, 37, 37)', attr: 'rgb(37, 37, 37)' });
    expect(ruleBody('[data-blok-database-gallery-card]:active')).toContain('background-color: var(--blok-database-gallery-card-active-bg)');
  });

  it('calendar: the dark today digit is Notion\'s black, which passes AA where white does not', () => {
    const today = [229, 100, 88];

    expect(contrast('rgb(255, 255, 255)', today)).toBeLessThan(4.5);
    expect(contrast('rgb(0, 0, 0)', today)).toBeGreaterThanOrEqual(4.5);
    expect(themed('--blok-database-calendar-day-today-text')).toEqual({ light: '#ffffff', dark: 'rgb(0, 0, 0)', attr: 'rgb(0, 0, 0)' });
    expect(ruleBody('[data-blok-database-calendar-day][data-today] [data-blok-database-calendar-day-number]')).toContain('color: var(--blok-database-calendar-day-today-text)');
  });

  it('row page: the line under the properties is Notion\'s divider', () => {
    expect(themed('--blok-database-page-divider')).toEqual({ light: 'rgba(55, 53, 47, 0.09)', dark: 'rgba(255, 255, 255, 0.094)', attr: 'rgba(255, 255, 255, 0.094)' });
    expect(ruleBody('[data-blok-database-drawer] hr')).toContain('border-top: 1px solid var(--blok-database-page-divider)');
  });

  // Notion rings the picked tile in blue (research/33 §3.2); the no-blue law keeps Blok's ink ring.
  it('card layout: the picked tile has an ink ring, not blue, and an ink label', () => {
    const picked = ruleBody('[data-blok-database-card-layout-tile][aria-pressed="true"] [data-blok-database-card-layout-drawing]');

    expect(picked).toContain('box-shadow: 0 0 0 1px var(--blok-database-ink)');
    expect(picked).not.toMatch(/39, 131, 222|35, 131, 226|focus-ring/);
    expect(ruleBody('[data-blok-database-card-layout-tile][aria-pressed="true"]')).toContain('color: var(--blok-database-ink)');
  });
});

describe('round 13: research/35 §1.1-§1.3, §1.8', () => {
  const both = (name: string, dark: string): void => {
    expect(value(dbMedia, name)).toBe(dark);
    expect(value(dbAttr, name)).toBe(dark);
  };
  const LIGHT_TINT = over([66, 35, 3, 0.03], WHITE);
  const DARK_TINTS = DARK_PAGES.map((page) => over([252, 252, 252, 0.03], page));
  // Worst surfaces: the hovered "+ New" row and the hovered count button.
  const LIGHT_SURFACES = [over([54, 29, 2, 0.031], LIGHT_TINT), over([33, 27, 23, 0.051], LIGHT_TINT)];
  // research/36 §11: a hovered gray "+ New" row is the hovered card, 50,50,49.
  const DARK_SURFACES = [...DARK_TINTS.map((tint) => over([255, 255, 255, 0.055], tint)), [50, 50, 49]];
  const passes = (ink: string, surfaces: number[][]): boolean => surfaces.every((s) => contrast(ink, s) >= 4.5);
  const shift = (ink: string, by: number): string => `rgb(${channels(ink).map((c) => c + by).join(', ')})`;

  it('board: a gray column keeps the plain tint and ring', () => {
    expect(value(dbLight, '--blok-database-column-gray-bg')).toBe('var(--blok-database-column-bg)');
    expect(value(dbLight, '--blok-database-column-gray-ring')).toBe('var(--blok-database-card-ring)');
  });

  it('board: Notion\'s gray count 142,139,134 fails AA in both themes, so each takes the nearest passing step', () => {
    expect(passes('rgb(142, 139, 134)', LIGHT_SURFACES)).toBe(false);
    expect(passes('rgb(142, 139, 134)', DARK_SURFACES)).toBe(false);

    const light = value(dbLight, '--blok-database-column-gray-accent') ?? '';

    expect(light).toBe('rgb(110, 107, 102)');
    expect(passes(light, LIGHT_SURFACES)).toBe(true);
    expect(passes(shift(light, 1), LIGHT_SURFACES)).toBe(false);
    both('--blok-database-column-gray-accent', 'rgb(156, 153, 148)');
    expect(passes('rgb(156, 153, 148)', DARK_SURFACES)).toBe(true);
    expect(passes('rgb(155, 152, 147)', DARK_SURFACES)).toBe(false);
  });

  it('board: the default column keeps Notion\'s 95,94,89 / 188,186,182 count', () => {
    expect(value(dbLight, '--blok-database-column-default-accent')).toBe('var(--blok-database-column-accent)');
    expect(themed('--blok-database-column-accent')).toEqual({ light: 'rgb(95, 94, 89)', dark: 'rgb(188, 186, 182)', attr: 'rgb(188, 186, 182)' });
  });

  it('board: dark gray cards are 44,44,43 and hover to 50,50,49; light gray cards stay white', () => {
    both('--blok-database-column-gray-card-bg', 'rgb(44, 44, 43)');
    both('--blok-database-column-gray-card-hover-bg', 'rgb(50, 50, 49)');
    expect(value(dbLight, '--blok-database-column-gray-card-bg')).toBeUndefined();
    expect(value(dbLight, '--blok-database-column-gray-card-hover-bg')).toBeUndefined();
  });

  it('board: default cards are white / 32 and hover to Notion\'s translucent wash / 38', () => {
    expect(themed('--blok-database-card-bg-hover')).toEqual({ light: 'rgba(54, 29, 2, 0.031)', dark: 'rgb(38, 38, 38)', attr: 'rgb(38, 38, 38)' });
    both('--blok-database-card-bg', 'rgb(32, 32, 32)');
  });

  it('board: a yellow card hovers to Notion\'s yellow wash in light and 63,58,42 in dark', () => {
    expect(value(dbLight, '--blok-database-column-yellow-card-hover-bg')).toBe('rgba(194, 164, 0, 0.063)');
    both('--blok-database-column-yellow-card-hover-bg', 'rgb(63, 58, 42)');
  });

  it('board: a dragged or picked card keeps its column\'s hover fill', () => {
    expect(ruleBody('[data-blok-database-card][data-blok-database-drag-source]')).toContain('background-color: var(--_blok-group-card-hover, var(--blok-database-card-bg-hover))');
    expect(ruleBody('[data-blok-database-card-active]')).toContain('background-color: var(--_blok-group-card-hover, var(--blok-database-card-bg-hover))');
  });

  it('toolbar: Filter and Sort hover to 0.051 / 0.055 and press to double', () => {
    expect(ruleBody('[data-blok-database-view-toolbar] > button:hover')).toContain('background-color: var(--blok-database-table-header-hover-bg)');
    expect(themed('--blok-database-table-header-hover-bg')).toEqual({ light: 'var(--blok-database-hover-bg)', dark: 'rgba(255, 255, 255, 0.055)', attr: 'rgba(255, 255, 255, 0.055)' });
    expect(themed('--blok-database-hover-bg').light).toBe('rgba(33, 27, 23, 0.051)');
    expect(ruleBody('[data-blok-database-view-toolbar] > button:active')).toContain('background-color: var(--blok-database-pressed-bg)');
  });

  // Notion's blue fails AA under its words (rest 3.67, light hover 4.37, dark hover 3.15, dark pressed 2.73).
  // Blok keeps the AA steps and Notion's direction: light darkens on hover and press, dark lightens.
  it('toolbar: "New" and its chevron darken on hover and press in light, lighten in dark, all AA', () => {
    const text = themed('--blok-database-new-text').light ?? '';
    const states = (theme: 'light' | 'dark'): number[] => ['--blok-database-new-bg', '--blok-database-new-hover-bg', '--blok-database-new-active-bg']
      .map((name) => themed(name)[theme] ?? '')
      .map((css) => {
        expect(contrast(text, channels(css))).toBeGreaterThanOrEqual(4.5);

        return luminance(channels(css));
      });

    expect(contrast(text, [31, 118, 204])).toBeLessThan(4.5);
    expect(themed('--blok-database-new-active-bg')).toEqual({ light: 'rgb(21, 85, 153)', dark: 'rgb(36, 115, 201)', attr: 'rgb(36, 115, 201)' });

    const [lightRest, lightHover, lightPressed] = states('light');
    const [darkRest, darkHover, darkPressed] = states('dark');

    expect(lightHover).toBeLessThan(lightRest);
    expect(lightPressed).toBeLessThan(lightHover);
    expect(darkHover).toBeGreaterThan(darkRest);
    expect(darkPressed).toBeGreaterThanOrEqual(darkHover);
    expect(ruleBody('[data-blok-database-new] > button:active')).toContain('background-color: var(--blok-database-new-active-bg)');
  });

  const MORE = "[data-blok-popover][data-blok-popover-custom-class~='blok-database-menu'] [data-blok-popover-item-more]";

  it('template "…": Notion\'s icon gray glyph (a non-text 3:1 icon), the menu hover fill, double when pressed', () => {
    expect(ruleBody(MORE)).toContain('color: var(--blok-database-table-header-icon)');
    expect(themed('--blok-database-table-header-icon')).toEqual({ light: 'rgb(142, 139, 134)', dark: 'rgb(173, 169, 163)', attr: 'rgb(173, 169, 163)' });
    expect(contrast('rgb(142, 139, 134)', WHITE)).toBeGreaterThanOrEqual(3);
    expect(ruleBody(`${MORE}:active`)).toContain('background-color: var(--blok-database-pressed-bg)');
  });

  it('template "…": keeps its hover fill while its submenu is open', () => {
    expect(ruleBody("[data-blok-popover][data-blok-popover-custom-class~='blok-database-menu'] [aria-expanded=\"true\"] > [data-blok-popover-item-more]"))
      .toContain('background-color: var(--blok-database-hover-bg)');
  });

  // r35:150: rows 352x28 with the "…" 2px below the row top. Only the templates menu's own rows: its submenu is a child popover.
  it('templates menu rows are 28px, and no other menu\'s rows change', () => {
    const ROW = '[data-blok-database-template-menu] > [data-blok-popover-container] [data-blok-popover-item]';

    expect(ruleBody(ROW)).toContain('height: 28px');
    expect(ruleBody(ROW)).toContain('padding-block: 0');
    expect(ruleBody("[data-blok-popover][data-blok-popover-custom-class~='blok-database-menu'] [data-blok-popover-item]")).toBe('');
  });
});

describe('research/35 §9 and 36 §7: the place editor after a pick', () => {
  const LINK = '[data-blok-database-place-view-map] + [data-blok-database-place-google-maps]';

  it('"Open in Google Maps" sits on white with a raised shadow in light, and on 25,25,25 in dark', () => {
    expect(themed('--blok-database-place-map-link-bg')).toEqual({ light: 'rgb(255, 255, 255)', dark: 'rgb(25, 25, 25)', attr: 'rgb(25, 25, 25)' });
    expect(ruleBody(LINK)).toContain('background-color: var(--blok-database-place-map-link-bg)');
    expect(ruleBody(LINK)).toContain('box-shadow: var(--blok-database-place-map-link-shadow)');
    // research/37 §4.2: in dark a 1px ring and a soft drop.
    expect(themed('--blok-database-place-map-link-shadow')).toEqual({
      light: 'rgba(25, 25, 25, 0.027) 0 8px 12px, rgba(25, 25, 25, 0.027) 0 2px 6px, rgba(42, 28, 0, 0.07) 0 0 0 1px',
      dark: 'rgb(56, 56, 54) 0 0 0 1px, rgba(25, 25, 25, 0.08) 0 4px 12px -2px',
      attr: 'rgb(56, 56, 54) 0 0 0 1px, rgba(25, 25, 25, 0.08) 0 4px 12px -2px',
    });
  });

  it('"Open in Google Maps" draws its glyph 142,139,134 and hovers to 244,243,243 in light', () => {
    expect(ruleBody(`${LINK} svg`)).toContain('color: var(--blok-database-place-map-link-icon)');
    expect(ruleBody(`${LINK}:hover`)).toContain('background-color: var(--blok-database-place-map-link-hover-bg)');
    // research/37 §4.2: dark glyph 173,169,163; hover lightens 25 to 38.
    expect(themed('--blok-database-place-map-link-icon')).toEqual({ light: 'rgb(142, 139, 134)', dark: 'rgb(173, 169, 163)', attr: 'rgb(173, 169, 163)' });
    expect(themed('--blok-database-place-map-link-hover-bg')).toEqual({ light: 'rgb(244, 243, 243)', dark: 'rgb(38, 38, 38)', attr: 'rgb(38, 38, 38)' });
    // A glyph needs 3:1, at rest and on hover, in both themes.
    expect(contrast('rgb(142, 139, 134)', [244, 243, 243])).toBeGreaterThanOrEqual(3);
    expect(contrast('rgb(173, 169, 163)', [25, 25, 25])).toBeGreaterThanOrEqual(3);
    expect(contrast('rgb(173, 169, 163)', [38, 38, 38])).toBeGreaterThanOrEqual(3);
  });

  it('"Open in Google Maps" sits 8px from the map\'s end and 10px from its bottom', () => {
    // The map is inset 4px inside the view, which positions the link.
    expect(ruleBody(LINK)).toContain('inset-block-end: calc(var(--blok-space-1) + var(--blok-space-2-5))');
    expect(ruleBody(LINK)).toContain('inset-inline-end: calc(var(--blok-space-1) + var(--blok-space-2))');
  });

  it('notion-spec-2 §19.18: the place sits in a 37px bar on 249,248,247 with 6px top corners and 4px padding', () => {
    const BAR = '[data-blok-database-place-view] > [data-blok-database-place-head]';

    expect(themed('--blok-database-place-view-head-bg').light).toBe('rgb(249, 248, 247)');
    expect(ruleBody(BAR)).toContain('background-color: var(--blok-database-place-view-head-bg)');
    expect(ruleBody(BAR)).toContain('block-size: 37px');
    expect(ruleBody(BAR)).toContain('padding: var(--blok-space-1)');
    expect(ruleBody(BAR)).toContain('border-start-start-radius: var(--blok-radius-control)');
    expect(ruleBody(BAR)).toContain('border-start-end-radius: var(--blok-radius-control)');
  });

  it('notion-spec-2 §19.18: the address chip is 20 tall, 12/14.4, 4px corners, padding 0 6px, on 33,27,23 at 5.1%, at most 198 wide and cut with "…"', () => {
    const CHIP = '[data-blok-database-place-view] [data-blok-database-place-chip]';

    expect(ruleBody(CHIP)).toContain('font-size: 12px');
    expect(ruleBody(CHIP)).toContain('line-height: 14.4px');
    expect(ruleBody(CHIP)).toContain('padding: 0 var(--blok-space-1-5)');
    expect(ruleBody(CHIP)).toContain('max-inline-size: 198px');
    expect(ruleBody(CHIP)).toContain('background-color: var(--blok-database-hover-bg)');
    expect(themed('--blok-database-hover-bg').light).toBe('rgba(33, 27, 23, 0.051)');
    expect(ruleBody('[data-blok-database-place-view] [data-blok-database-place-name]')).toContain('text-overflow: ellipsis');
  });

  it('notion-spec-2 §19.18: the hover card is a white menu surface with 6px corners and the menu shadow', () => {
    const CARD = '[data-blok-database-place-card]';

    expect(ruleBody(CARD)).toContain('background-color: var(--blok-database-popover-bg)');
    expect(ruleBody(CARD)).toContain('border-radius: var(--blok-radius-control)');
    expect(ruleBody(CARD)).toContain('box-shadow: var(--blok-database-popover-shadow)');
    expect(themed('--blok-database-popover-shadow').light).toBe('rgba(25, 25, 25, 0.05) 0 20px 24px, rgba(25, 25, 25, 0.027) 0 5px 8px, rgba(42, 28, 0, 0.07) 0 0 0 1px');
  });

  it('notion-live-3 hover-16, research/20 35-place-cell-hovercard: the card hugs its text with 12px sides (216 at least), the name 14/20 bold over a 12/16 grey address, and a 168-tall map with 6px corners', () => {
    const CARD = '[data-blok-database-place-card]';

    expect(ruleBody(CARD)).toContain('inline-size: max-content');
    expect(ruleBody(CARD)).toContain('min-inline-size: 216px');
    expect(ruleBody(CARD)).toContain('padding: var(--blok-space-2-5) var(--blok-space-3) var(--blok-space-2)');
    expect(ruleBody(CARD)).not.toContain('inline-size: 284px');
    expect(ruleBody(`${CARD} [data-blok-database-place-card-name]`)).toContain('font-size: 14px');
    expect(ruleBody(`${CARD} [data-blok-database-place-card-name]`)).toContain('line-height: 20px');
    expect(ruleBody(`${CARD} [data-blok-database-place-card-name]`)).toContain('font-weight: 600');
    expect(ruleBody(`${CARD} [data-blok-database-place-card-address]`)).toContain('color: var(--blok-database-ink-secondary)');
    expect(ruleBody(`${CARD} [data-blok-database-place-card-map]`)).toContain('block-size: 168px');
    expect(ruleBody(`${CARD} [data-blok-database-place-card-map]`)).toContain('margin-block-start: var(--blok-space-2)');
    expect(ruleBody(`${CARD} [data-blok-database-place-card-map]`)).toContain('border-radius: var(--blok-radius-control)');
  });

  it('notion-spec-2 §18.2, notion-live-3 created-by-editor: the profile card is 280x84, 10px corners, the menu shadow, a 56px round avatar 12px in, the name 14/24 bold 12px after it', () => {
    const CARD = '[data-blok-database-person-card]';

    expect(ruleBody(CARD)).toContain('inline-size: 280px');
    expect(ruleBody(CARD)).toContain('min-block-size: 84px');
    expect(ruleBody(CARD)).toContain('padding: var(--blok-space-3-5) var(--blok-space-3)');
    expect(ruleBody(CARD)).toContain('gap: var(--blok-space-3)');
    expect(ruleBody(CARD)).toContain('border-radius: var(--blok-radius-surface)');
    expect(ruleBody(CARD)).toContain('background-color: var(--blok-database-popover-bg)');
    expect(ruleBody(CARD)).toContain('box-shadow: var(--blok-database-popover-shadow)');
    expect(ruleBody(`${CARD} [data-blok-database-person-card-avatar]`)).toContain('inline-size: 56px');
    expect(ruleBody(`${CARD} [data-blok-database-person-card-avatar]`)).toContain('block-size: 56px');
    expect(ruleBody(`${CARD} [data-blok-database-person-card-avatar]`)).toContain('border-radius: 50%');
    expect(ruleBody(`${CARD} [data-blok-database-person-card-name]`)).toContain('font-size: 14px');
    expect(ruleBody(`${CARD} [data-blok-database-person-card-name]`)).toContain('line-height: 24px');
    expect(ruleBody(`${CARD} [data-blok-database-person-card-name]`)).toContain('font-weight: 600');
  });

  it('the × takes Notion\'s icon grey: 142,139,134 light, 173,169,163 dark', () => {
    expect(ruleBody('[data-blok-database-place-view] [data-blok-database-place-clear]')).toContain('color: var(--blok-database-table-header-icon)');
    expect(themed('--blok-database-table-header-icon')).toEqual({ light: 'rgb(142, 139, 134)', dark: 'rgb(173, 169, 163)', attr: 'rgb(173, 169, 163)' });
    expect(contrast('rgb(142, 139, 134)', LIGHT_HOVER)).toBeGreaterThanOrEqual(3);
    expect(ruleBody('[data-blok-database-place-view] [data-blok-database-place-clear]:hover')).toContain('background-color: var(--blok-database-hover-bg)');
  });
});

// notion-spec-2 §11: Notion rings every colour swatch (Color list, Color value, option colour menu)
// with 1px of its own colour: the fill itself in light (Default takes Gray's), a fainter step in dark.
describe('colour swatch ring', () => {
  const DARK_RING: Record<string, string> = {
    default: 'rgba(255, 255, 235, 0.1)',
    gray: 'rgba(255, 255, 235, 0.1)',
    brown: 'rgba(255, 177, 129, 0.192)',
    orange: 'rgba(255, 147, 75, 0.28)',
    yellow: 'rgba(255, 205, 75, 0.24)',
    green: 'rgba(108, 255, 172, 0.157)',
    blue: 'rgba(67, 155, 255, 0.24)',
    purple: 'rgba(200, 125, 255, 0.2)',
    pink: 'rgba(255, 103, 177, 0.23)',
    red: 'rgba(255, 104, 92, 0.24)',
  };

  it.each(Object.keys(DARK_RING))('rings %s in its own colour, light and dark', (color) => {
    const lightRing = color === 'default' ? 'gray' : color;

    expect(ruleBody(`[data-blok-database-option-swatch][data-color="${color}"]`))
      .toContain(`box-shadow: inset 0 0 0 1px var(--blok-database-option-${color}-ring, var(--blok-database-option-${lightRing}-bg))`);
    expect(value(dbLight, `--blok-database-option-${color}-ring`)).toBeUndefined();
    expect(value(dbMedia, `--blok-database-option-${color}-ring`)).toBe(DARK_RING[color]);
    expect(value(dbAttr, `--blok-database-option-${color}-ring`)).toBe(DARK_RING[color]);
  });
});

// notion-spec-2 §11, §12: the Color button keeps Notion's hover fill while its list is open.
describe('the Color dropdown button', () => {
  it.each([
    "[data-blok-popover][data-blok-popover-custom-class~='blok-database-row-page-menu'] [data-blok-popover-item][data-blok-item-name=\"color\"][data-blok-popover-item-children-open] [data-blok-popover-item-dropdown-button]",
    "[data-blok-popover][data-blok-popover-custom-class~='blok-database-header-menu'] [data-blok-popover][data-blok-nested] [data-blok-popover-item][data-blok-item-name=\"color\"][data-blok-popover-item-children-open] [data-blok-popover-item-dropdown-button]",
  ])('fills with the database hover fill while open: %s', (selector) => {
    expect(ruleBody(selector)).toContain('background-color: var(--blok-database-hover-bg)');
  });
});
