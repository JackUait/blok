/**
 * The database confirm dialog uses the measured Notion values (research/08,
 * "Would you like to remove sorting?"). jsdom has no CSS, so these read the source.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const read = (file: string): string => readFileSync(resolve(__dirname, '../../../src/styles', file), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/\s+/g, ' ');

const database = read('database.css');
const keyframes = read('keyframes.css');

const ruleBody = (css: string, selector: string): string => {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = css.match(new RegExp(`(?:^|\\})\\s*${escaped}\\s*\\{([^{}]*)\\}`));

  return match?.[1] ?? '';
};

const tokenValues = (name: string): string[] =>
  [ ...database.matchAll(new RegExp(`${name}: ([^;]+);`, 'g')) ].map((m) => m[1].trim());

describe('database confirm dialog css', () => {
  it('dims the page behind with the measured backdrop', () => {
    expect(ruleBody(database, '[data-blok-database-confirm]')).toContain('background-color: var(--blok-database-confirm-backdrop)');
    expect(tokenValues('--blok-database-confirm-backdrop')[0]).toBe('rgba(15, 15, 15, 0.6)');
  });

  it('draws a 324px panel with 20px padding, the dialog radius and the three-layer shadow', () => {
    const body = ruleBody(database, '[data-blok-database-confirm-dialog]');

    expect(body).toContain('width: 324px');
    expect(body).toContain('padding: 20px');
    expect(body).toContain('border-radius: var(--blok-radius-dialog)');
    expect(body).toContain('box-shadow: var(--blok-database-confirm-shadow)');
    expect(tokenValues('--blok-database-confirm-shadow')[0])
      .toBe('rgba(25, 25, 25, 0.24) 0 24px 48px, rgba(25, 25, 25, 0.14) 0 4px 12px, rgba(42, 28, 0, 0.07) 0 0 0 1px');
  });

  it('enters with scale .97 to 1 and opacity over 200ms ease', () => {
    expect(ruleBody(database, '[data-blok-database-confirm-dialog]')).toContain('animation: blok-database-confirm-in 200ms ease both');
    expect(keyframes).toMatch(/@keyframes blok-database-confirm-in \{ from \{ opacity: 0; transform: scale\(0\.97\); \} to \{ opacity: 1; transform: none; \} \}/);
  });

  it('centres a 16px/24px semibold title', () => {
    const body = ruleBody(database, '[data-blok-database-confirm-title]');

    expect(body).toContain('font-size: 16px');
    expect(body).toContain('line-height: 24px');
    expect(body).toContain('font-weight: 600');
    expect(body).toContain('text-align: center');
  });

  it('stacks full-width 32px buttons with the control radius', () => {
    const body = ruleBody(database, '[data-blok-database-confirm-action]');

    expect(body).toContain('width: 100%');
    expect(body).toContain('height: 32px');
    expect(body).toContain('margin-top: 8px');
    expect(body).toContain('border-radius: var(--blok-radius-control)');
    expect(body).toContain('font-size: 14px');
    expect(body).toContain('font-weight: 500');
  });

  it('paints the destructive button with red text and a red hairline', () => {
    const body = ruleBody(database, '[data-blok-database-confirm-action][data-destructive]');

    expect(body).toContain('color: var(--blok-database-confirm-destructive-text)');
    expect(body).toContain('border-color: var(--blok-database-confirm-destructive-border)');
    expect(tokenValues('--blok-database-confirm-destructive-text')[0]).toBe('rgb(229, 100, 88)');
    expect(tokenValues('--blok-database-confirm-destructive-border')[0]).toBe('rgba(206, 24, 0, 0.165)');
  });

  it('defines every confirm token in light and both dark blocks', () => {
    for (const name of ['backdrop', 'bg', 'shadow', 'destructive-text', 'destructive-border']) {
      expect(tokenValues(`--blok-database-confirm-${name}`), name).toHaveLength(3);
    }
  });

  it('drops the entrance under reduced motion', () => {
    expect(database).toMatch(/@media \(prefers-reduced-motion: reduce\) \{[^@]*\[data-blok-database-confirm-dialog\][^{]*\{ animation: none; \}/);
  });
});
