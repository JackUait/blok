/**
 * Database, table, columns and checklist radii follow the radius design system
 * (docs/plans/2026-09-30-radius-design-system.md): a role token, or the nesting
 * rule for a child of a rounded container. jsdom has no CSS cascade, so these
 * read the stylesheets.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const read = (file: string): string => readFileSync(resolve(__dirname, '../../../src/styles', file), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '');

const FILES = ['database.css', 'tables.css', 'columns.css', 'checklist.css'];

interface Rule {
  selector: string;
  body: string;
}

/** Innermost `selector { body }` blocks, so rules inside @supports are read too. */
const rules = (css: string): Rule[] => Array.from(css.matchAll(/([^{}]+)\{([^{}]*)\}/g))
  .map(match => ({
    selector: (match[1] ?? '').replace(/\s+/g, ' ').trim(),
    body: match[2] ?? '',
  }));

const declarations = (body: string, property: string): string[] =>
  Array.from(body.matchAll(new RegExp(`(?:^|;|\\s)${property}\\s*:\\s*([^;]+);`, 'g')))
    .map(match => (match[1] ?? '').replace(/\s+/g, ' ').trim());

const radiusOf = (file: string, selector: string): string[] =>
  rules(read(file))
    .filter(rule => rule.selector === selector)
    .flatMap(rule => declarations(rule.body, 'border-radius'));

const innerOf = (file: string, selector: string): string[] =>
  rules(read(file))
    .filter(rule => rule.selector === selector)
    .flatMap(rule => declarations(rule.body, '--blok-radius-inner'));

const ROLES = 'dialog|surface|block|field|control-lg|control|control-sm|mark|pill|notch|table';
const ALLOWED = new RegExp(
  `^(?:0|50%|inherit|var\\(--blok-radius-(?:${ROLES})\\)|var\\(--blok-radius-inner, var\\(--blok-radius-(?:${ROLES})\\)\\))$`
);

const role = (name: string): string => `var(--blok-radius-${name})`;
const inner = (fallback: string): string => `var(--blok-radius-inner, var(--blok-radius-${fallback}))`;
const derive = (outer: string, gap: string): string =>
  `max(var(--blok-radius-floor), calc(var(--blok-radius-${outer}) - var(--blok-space-${gap})))`;

describe('radius tokens in database, table, columns and checklist CSS', () => {
  it.each(FILES)('%s: every radius is a role token, the nesting rule, 0, a circle or inherit', (file) => {
    const values = rules(read(file)).flatMap(rule => [
      ...declarations(rule.body, 'border-radius'),
      ...declarations(rule.body, 'border-(?:top|bottom)-(?:left|right)-radius'),
    ]);

    expect(values.filter(value => !ALLOWED.test(value))).toEqual([]);
  });

  it.each(FILES)('%s: a selector declares its radius once', (file) => {
    const seen = new Map<string, number>();

    for (const rule of rules(read(file))) {
      for (const part of rule.selector.split(',').map(s => s.trim())) {
        seen.set(part, (seen.get(part) ?? 0) + declarations(rule.body, 'border-radius').length);
      }
    }

    expect(Array.from(seen).filter(([, count]) => count > 1)).toEqual([]);
  });
});

describe('database board', () => {
  // Notion measures the column body, the card and "+ New page" all at 10px
  // (research/08), so the card takes the block role instead of nesting.
  it('a column, its cards and its add-card button are blocks', () => {
    expect(radiusOf('database.css', '[data-blok-database-column]')).toEqual([role('block')]);
    expect(innerOf('database.css', '[data-blok-database-column]')).toEqual([]);
    expect(radiusOf('database.css', '[data-blok-database-card]')).toEqual([role('block')]);
    expect(radiusOf('database.css', '[data-blok-database-add-card]')).toEqual([role('block')]);
  });

  it('the column header nests its small-control radius', () => {
    expect(radiusOf('database.css', '[data-blok-database-column-header]')).toEqual([inner('control-sm')]);
  });

  it('the add-column button is a large control', () => {
    expect(radiusOf('database.css', '[data-blok-database-add-column]')).toEqual([role('control-lg')]);
  });

  it('the card action group is concentric with its buttons', () => {
    expect(radiusOf('database.css', '[data-blok-database-card-actions]')).toEqual([role('control-lg')]);
    expect(innerOf('database.css', '[data-blok-database-card-actions]')).toEqual([derive('control-lg', '0-5')]);
    expect(radiusOf('database.css', '[data-blok-database-edit-card], [data-blok-database-card-menu]'))
      .toEqual([inner('control')]);
  });

  it('the column pill (4px, research/08) and the delete button are small controls', () => {
    expect(radiusOf('database.css', '[data-blok-database-column-pill]')).toEqual([role('control-sm')]);
    expect(radiusOf('database.css', '[data-blok-database-delete-column]')).toEqual([role('control-sm')]);
  });

  it('scrollbar thumbs are small controls', () => {
    expect(radiusOf('database.css', '[data-blok-database-board]::-webkit-scrollbar-thumb')).toEqual([role('control-sm')]);
    expect(radiusOf('database.css', '[data-blok-database-drawer-content]::-webkit-scrollbar-thumb'))
      .toEqual([role('control-sm')]);
  });
});

describe('database tabs and menus', () => {
  it('a tab is a large control and its rename input nests inside it', () => {
    expect(radiusOf('database.css', '[data-blok-database-tab]')).toEqual([role('control-lg')]);
    expect(innerOf('database.css', '[data-blok-database-tab]')).toEqual([derive('control-lg', '2')]);
    expect(radiusOf('database.css', '[data-blok-database-tab-rename-input]')).toEqual([inner('control')]);
  });

  it('the tab ghost takes its radius from the tab it copies, not from CSS', () => {
    expect(radiusOf('database.css', '[data-blok-database-tab-ghost]')).toEqual([]);
  });

  it('tab buttons are controls', () => {
    expect(radiusOf('database.css', '[data-blok-database-add-view]')).toEqual([role('control')]);
    expect(radiusOf('database.css', '[data-blok-database-tab-more]')).toEqual([role('control')]);
    expect(radiusOf('database.css', '[data-blok-database-view-option-icon]')).toEqual([role('control')]);
  });

  it.each([
    '[data-blok-database-tab-overflow-dropdown]',
    '[data-blok-database-property-type-popover]',
  ])('%s is a surface with 4px padding, so its rows stay at 6px', (selector) => {
    const body = rules(read('database.css')).filter(rule => rule.selector === selector).map(rule => rule.body).join('');

    expect(radiusOf('database.css', selector)).toEqual([role('surface')]);
    expect(declarations(body, 'padding')).toEqual(['var(--blok-space-1)']);
    expect(innerOf('database.css', selector)).toEqual([derive('surface', '1')]);
  });

  it.each([
    '[data-blok-database-tab-overflow-item]',
    '[data-blok-database-tab-overflow-new]',
    '[data-blok-database-property-type-option]',
    '[data-blok-database-view-option]',
  ])('%s is a menu row that nests in its card', (selector) => {
    expect(radiusOf('database.css', selector)).toEqual([inner('control')]);
  });
});

describe('database list and drawer', () => {
  it('rows and row-like buttons are controls', () => {
    expect(radiusOf('database.css', '[data-blok-database-list-row]')).toEqual([role('control')]);
    expect(radiusOf('database.css', '[data-blok-database-list-group-header]')).toEqual([role('control')]);
    expect(radiusOf('database.css', '[data-blok-database-drawer-add-prop]')).toEqual([role('control')]);
    expect(radiusOf(
      'database.css',
      '[data-blok-database-list] > [data-blok-database-add-row], [data-blok-database-list-rows] ~ [data-blok-database-add-row]'
    )).toEqual([role('control')]);
  });

  it('small row buttons and tags are small controls; the chevron tip is a notch', () => {
    expect(radiusOf('database.css', '[data-blok-database-list-row-property]')).toEqual([role('control-sm')]);
    expect(radiusOf('database.css', '[data-blok-database-list-row-open]')).toEqual([role('control-sm')]);
    expect(radiusOf('database.css', '[data-blok-database-list-row-properties] [data-blok-database-delete-row]'))
      .toEqual([role('control-sm')]);
    expect(radiusOf('database.css', '[data-blok-database-drawer-close]')).toEqual([role('control-sm')]);
    expect(radiusOf('database.css', '[data-blok-database-list-row-open]::after')).toEqual([role('notch')]);
  });

  it('drops the drawer status pill rules, which nothing renders', () => {
    expect(read('database.css')).not.toContain('data-blok-database-drawer-status');
  });
});

describe('columns and checklist', () => {
  it('the column resizer bar is a pill', () => {
    expect(radiusOf('columns.css', '[data-blok-column-resizer]::before')).toEqual([role('pill')]);
  });

  it('the 20px checklist checkbox is a small control', () => {
    expect(radiusOf('checklist.css', '[data-blok-interface] [data-list-style="checklist"] input[type="checkbox"]'))
      .toEqual([role('control-sm')]);
  });
});

describe('radius in database and table TS', () => {
  const TOOLS = resolve(__dirname, '../../../src/tools');
  const sources = (dir: string): Array<[string, string]> => readdirSync(resolve(TOOLS, dir))
    .filter(name => name.endsWith('.ts'))
    // Imported only by its own unit tests: to be deleted, not migrated.
    .filter(name => name !== 'database-view.ts')
    .map(name => [`${dir}/${name}`, readFileSync(resolve(TOOLS, dir, name), 'utf8')]);

  const files = [...sources('database'), ...sources('table')];

  it('has files to check', () => {
    expect(files.length).toBeGreaterThan(10);
  });

  it.each(files)('%s uses no off-scale Tailwind radius class', (_name, source) => {
    const classes = Array.from(source.matchAll(/['"`\s](rounded(?:-(?:xs|sm|md|lg|xl|2xl|3xl|\[[^\]]*\]))?)(?=['"`\s])/g))
      .map(match => match[1]);

    expect(classes).toEqual([]);
  });

  it.each(files)('%s writes no literal inline radius', (_name, source) => {
    const literals = Array.from(source.matchAll(/borderRadius\s*=\s*['"`]([^'"`]*)['"`]/g))
      .map(match => match[1])
      .filter(value => !/^var\(--blok-radius-[a-z-]+\)$/.test(value));

    expect(literals).toEqual([]);
  });
});
