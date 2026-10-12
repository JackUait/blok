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

  // research/09 §9: full page, a 385px column at the window's right edge, full height, 1px left border.
  it('docks the details panel to the window edge on a full page', () => {
    const panel = ruleBody('[data-blok-database-drawer][data-peek-mode="full"] [data-blok-database-drawer-details]');

    expect(panel).toContain('position: fixed');
    expect(panel).toContain('inset-block: 0');
    expect(panel).toContain('inset-inline-end: 0');
    expect(panel).toContain('inline-size: 385px');
    expect(panel).toContain('border-inline-start: 1px solid');
    expect(panel).toContain('border-radius: 0');
  });

  // research/09 §9: center peek, a 280px column inside the modal; the page narrows beside it.
  it('docks the details panel inside the center peek modal', () => {
    const panel = ruleBody('[data-blok-database-drawer][data-peek-mode="center"] [data-blok-database-drawer-details]');

    expect(panel).toContain('position: absolute');
    expect(panel).toContain('inset-inline-end: 0');
    expect(panel).toContain('inset-block-end: 0');
    expect(panel).toContain('inline-size: 280px');
    expect(panel).toContain('border-inline-start: 1px solid');
    expect(ruleBody('[data-blok-database-drawer][data-peek-mode="center"][data-details-open] [data-blok-database-drawer-content]'))
      .toContain('padding-inline-end: calc(280px + 60px)');
  });

  it('puts a 16px icon in the label column, which keeps the label width', () => {
    const head = ruleBody('[data-blok-database-drawer-prop-head]');

    expect(head).toContain('display: flex');
    expect(head).toContain('min-width: 100px');
    expect(ruleBody('[data-blok-database-drawer-prop-icon]')).toContain('inline-size: 16px');
    expect(ruleBody('[data-blok-database-drawer-prop-label]')).not.toContain('min-width');
  });

  it('lets the pins scroller shrink in its row, and flips the arrows in RTL', () => {
    expect(ruleBody('[data-blok-database-drawer-pins-row]')).toContain('display: flex');
    expect(ruleBody('[data-blok-database-drawer-pins-row] > [data-blok-database-drawer-pins]')).toContain('min-inline-size: 0');
    expect(ruleBody('[dir="rtl"] [data-blok-database-drawer-pins-back] svg, [dir="rtl"] [data-blok-database-drawer-pins-forward] svg')).toContain('transform: scaleX(-1)');
  });

  // research/09 §4: 32x32, radius 6px, no fill, 20px chevron, 0.1s ease-in fade, shown per side.
  it('draws the pin arrows as Notion measured them', () => {
    const arrow = ruleBody('[data-blok-database-drawer-pins-back], [data-blok-database-drawer-pins-forward]');

    expect(arrow).toContain('position: absolute');
    expect(arrow).toContain('inline-size: 32px');
    expect(arrow).toContain('block-size: 32px');
    expect(arrow).toContain('border-radius: var(--blok-radius-control)');
    expect(arrow).toContain('background: none');
    expect(arrow).toContain('opacity: 0');
    expect(arrow).toContain('visibility: hidden');
    expect(arrow).toContain('transition: opacity 0.1s ease-in, visibility 0.1s ease-in');
    expect(ruleBody('[data-blok-database-drawer-pins-back]')).toContain('inset-inline-start: -4px');
    expect(ruleBody('[data-blok-database-drawer-pins-forward]')).toContain('inset-inline-end: -4px');
    expect(ruleBody('[data-blok-database-drawer-pins-back] svg, [data-blok-database-drawer-pins-forward] svg')).toContain('inline-size: 20px');
    const shown = ruleBody('[data-blok-database-drawer-pins-row][data-scroll-back] > [data-blok-database-drawer-pins-back], [data-blok-database-drawer-pins-row][data-scroll-forward] > [data-blok-database-drawer-pins-forward]');

    expect(shown).toContain('opacity: 1');
    expect(shown).toContain('visibility: visible');
    expect(database).not.toMatch(/\[data-blok-database-drawer-pins-(?:back|forward)\]:hover[^{]*\{[^}]*background/);
    expect(database).toMatch(/@media \(prefers-reduced-motion: reduce\) \{[^@]*\[data-blok-database-drawer-pins-back\], \[data-blok-database-drawer-pins-forward\] \{ transition: none; \}/);
  });

  it('fades 100px at each pins edge that still hides content', () => {
    expect(ruleBody('[data-blok-database-drawer-pins-row][data-scroll-back] > [data-blok-database-drawer-pins]')).toContain('--_blok-pins-fade-start: 100px');
    expect(ruleBody('[data-blok-database-drawer-pins-row][data-scroll-forward] > [data-blok-database-drawer-pins]')).toContain('--_blok-pins-fade-end: 100px');
    expect(ruleBody('[data-blok-database-drawer-pins]')).toMatch(/mask-image: linear-gradient\(to right, transparent, #000 var\(--_blok-pins-fade-start, 0px\), #000 calc\(100% - var\(--_blok-pins-fade-end, 0px\)\), transparent\)/);
    expect(ruleBody('[dir="rtl"] [data-blok-database-drawer-pins]')).toContain('to left');
  });

  it('uses logical properties and radius role tokens only', () => {
    const rules = layoutRules();

    expect(rules.length).toBeGreaterThan(0);
    expect(rules).not.toMatch(/(?:margin|padding|border)-(?:left|right)\b|\b(?:left|right):/);
    // 0 is allowed, as the radius law allows it.
    expect(rules).not.toMatch(/border-radius: (?!0;)\d/);
    expect(rules).not.toMatch(/:focus(?![-\w])/);
  });
});
