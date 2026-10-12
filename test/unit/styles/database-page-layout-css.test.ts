/**
 * The row page layout (Notion help/layouts). Notion's layout builder was not
 * measured (research/07 and 08 have no values), so these rules use Blok tokens.
 * jsdom has no CSS, so these read the source.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const database = readFileSync(resolve(__dirname, '../../../src/styles/database.css'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/\s+/g, ' ');

const ruleBody = (selector: string): string => {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = database.match(new RegExp(`(?:^|[{}])\\s*${escaped}\\s*\\{([^{}]*)\\}`));

  return match?.[1] ?? '';
};

const layoutRules = (): string =>
  [...database.matchAll(/([^{}]*\[data-blok-database-(?:drawer-(?:pins[a-z-]*|pin|prop-head|prop-icon|modules|panel-modules|module|section[a-z-]*|details[a-z-]*|columns|main|tabs|tab-panel|customize|layout-bar)|layout-[a-z-]+)\][^{}]*)\{([^{}]*)\}/g)]
    .map((m) => `${m[1]}{${m[2]}}`)
    .join('\n');

describe('database row page layout css', () => {
  it('scrolls pinned properties sideways instead of wrapping', () => {
    const body = ruleBody('[data-blok-database-drawer-pins]');

    expect(body).toContain('display: flex');
    expect(body).toContain('overflow-x: auto');
  });

  it('marks the open tab with primary ink and an underline, never blue', () => {
    const body = ruleBody('[data-blok-database-drawer-tabs] [role="tab"][aria-selected="true"]');

    expect(body).toContain('color: var(--blok-text-primary)');
    expect(body).toContain('box-shadow: inset 0 -2px 0 currentColor');
    expect(body).not.toMatch(/blue|#2383e2|rgb\(35, 131, 226\)/i);
  });

  it('shows Customize layout on page hover, like Add icon', () => {
    expect(ruleBody('[data-blok-database-drawer-customize]')).toContain('opacity: 0');
    expect(database).toMatch(/\[data-blok-database-drawer-content\]:hover \[data-blok-database-drawer-customize\][^{]*\{ opacity: 1; \}/);
  });

  it('turns the section caret and the details panel motion off for reduced motion', () => {
    expect(database).toMatch(/@media \(prefers-reduced-motion: reduce\) \{ \[data-blok-database-drawer-section-toggle\] svg \{ transition: none; \}/);
  });

  it('sets the details panel beside the page column and wraps it below when narrow', () => {
    const columns = ruleBody('[data-blok-database-drawer-columns]');
    const main = ruleBody('[data-blok-database-drawer-columns] > [data-blok-database-drawer-main]');
    const panel = ruleBody('[data-blok-database-drawer-columns] > [data-blok-database-drawer-details]');

    expect(columns).toContain('display: flex');
    expect(columns).toContain('flex-wrap: wrap');
    expect(columns).toContain('align-items: flex-start');
    expect(columns).not.toMatch(/row-reverse/);
    expect(main).toContain('flex: 999 1 240px');
    expect(main).toContain('min-inline-size: 0');
    expect(panel).toContain('flex: 1 1 240px');
  });

  it('puts a 16px icon in the label column, which keeps the label width', () => {
    const head = ruleBody('[data-blok-database-drawer-prop-head]');

    expect(head).toContain('display: flex');
    expect(head).toContain('min-width: 100px');
    expect(ruleBody('[data-blok-database-drawer-prop-icon]')).toContain('inline-size: 16px');
    expect(ruleBody('[data-blok-database-drawer-prop-label]')).not.toContain('min-width');
  });

  it('lets the pins scroller shrink between its arrows, and flips the arrows in RTL', () => {
    expect(ruleBody('[data-blok-database-drawer-pins-row]')).toContain('display: flex');
    expect(ruleBody('[data-blok-database-drawer-pins-row] > [data-blok-database-drawer-pins]')).toContain('min-inline-size: 0');
    expect(ruleBody('[data-blok-database-drawer-pins-back][hidden], [data-blok-database-drawer-pins-forward][hidden]')).toContain('display: none');
    expect(ruleBody('[dir="rtl"] [data-blok-database-drawer-pins-back] svg, [dir="rtl"] [data-blok-database-drawer-pins-forward] svg')).toContain('transform: scaleX(-1)');
  });

  it('uses logical properties and radius role tokens only', () => {
    const rules = layoutRules();

    expect(rules.length).toBeGreaterThan(0);
    expect(rules).not.toMatch(/(?:margin|padding|border)-(?:left|right)\b|\b(?:left|right):/);
    expect(rules).not.toMatch(/border-radius: \d/);
    expect(rules).not.toMatch(/:focus(?![-\w])/);
  });
});
