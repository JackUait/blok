/**
 * Phase 6 structure look: the "New" split button (measured, research/08),
 * the button cell, the template banner, sub-item nesting, dependency
 * arrows and the linked-view states. jsdom has no CSS, so these read the
 * authored source.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const css = readFileSync(resolve(__dirname, '../../../src/styles/database.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
const colors = readFileSync(resolve(__dirname, '../../../src/styles/colors.css'), 'utf8');

const ruleBody = (selector: string): string =>
  Array.from(css.matchAll(/([^{}]+)\{([^{}]*)\}/g))
    .filter((match) => (match[1] ?? '').split(',').map((part) => part.trim()).includes(selector))
    .map((match) => match[2] ?? '')
    .join(';');

const TOKENS = [
  '--blok-database-new-bg',
  '--blok-database-new-hover-bg',
  '--blok-database-new-text',
  '--blok-database-new-divider',
  '--blok-database-dependency-line',
  '--blok-database-dependency-conflict',
];

describe('database structure styles', () => {
  it.each(TOKENS)('%s is defined for light, system dark and forced dark, and not in colors.css', (token) => {
    expect(css.match(new RegExp(`${token}:`, 'g'))?.length ?? 0).toBeGreaterThanOrEqual(3);
    expect(colors).not.toContain(`${token}:`);
  });

  it('paints "New" as Notion\'s blue split button, darkened to pass AA for its words', () => {
    expect(css).toContain('--blok-database-new-bg: rgb(30, 110, 195);');
    expect(css).toContain('--blok-database-new-text: rgb(243, 249, 253);');
    expect(ruleBody('[data-blok-database-new] > button')).toMatch(/height:\s*28px/);
    expect(ruleBody('[data-blok-database-new] > button:first-child')).toMatch(/border-start-end-radius:\s*0/);
  });

  it('indents a sub-item by its depth with logical properties', () => {
    const body = ruleBody('[data-blok-database-table-row][data-subitem-depth] [data-type="title"]');

    expect(body).toMatch(/padding-inline-start:\s*calc\(/);
    expect(body).toContain('--blok-database-subitem-depth');
  });

  it('turns the toggle when open, with no motion for reduced-motion users', () => {
    expect(ruleBody('[data-blok-database-subitem-toggle][aria-expanded="true"] svg')).toMatch(/rotate\(90deg\)/);
    const reduced = css.slice(css.lastIndexOf('@media (prefers-reduced-motion: reduce)'));

    expect(reduced).toContain('[data-blok-database-subitem-toggle] svg');
  });

  it('draws each dependency arrow from its parts', () => {
    expect(ruleBody('[data-blok-database-timeline-arrows]')).toMatch(/pointer-events:\s*none/);
    for (const part of ['out', 'cross', 'in', 'head']) {
      expect(ruleBody(`[data-blok-database-timeline-arrow-part="${part}"]`), part).not.toBe('');
    }
    expect(ruleBody('[data-blok-database-timeline-arrow][data-conflict]')).toContain('--blok-database-dependency-conflict');
  });

  it('puts the link handle past the bar end, never over the resize zone', () => {
    expect(ruleBody('[data-blok-database-timeline-link-handle]')).toMatch(/inset-inline-end:\s*-/);
  });

  it('styles the banner\'s "Duplicate every…" button and the list\'s ↻ in neutral ink, never blue', () => {
    expect(ruleBody('[data-blok-database-template-repeat]')).toContain('cursor: pointer');
    expect(ruleBody('[data-blok-database-template-repeat]:hover')).toContain('--blok-item-hover-bg');
    expect(ruleBody('[data-blok-database-template-repeat-icon]')).toContain('--blok-text-secondary');
  });

  it('lays out Edit cadence as measured: 260px, 28px round day chips with 12px text, a chevron on the banner button', () => {
    expect(ruleBody('[data-blok-database-template-cadence]')).toContain('width: 260px');
    const chip = ruleBody('[data-blok-database-template-cadence-days] button');

    expect(chip).toContain('width: 28px');
    expect(chip).toContain('height: 28px');
    expect(chip).toContain('border-radius: 50%');
    expect(chip).toContain('font-size: 12px');
    expect(ruleBody('[data-blok-database-template-repeat-chevron] svg')).toContain('width: 16px');
  });

  it('styles the button cell, template banner and linked-view states', () => {
    for (const selector of ['[data-blok-database-button]', '[data-blok-database-template-banner]', '[data-blok-database-source-missing]', '[data-blok-database-source-picker]', '[data-blok-database-add-subitem] button']) {
      expect(ruleBody(selector), selector).not.toBe('');
    }
  });
});
