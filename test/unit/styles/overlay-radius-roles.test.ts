/**
 * Overlay radii follow the radius design system
 * (docs/plans/2026-09-30-radius-design-system.md): each radius is a role token,
 * and a child near a rounded corner reads the --blok-radius-inner its
 * container publishes. jsdom has no CSS, so these read the authored source.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const read = (file: string): string => readFileSync(resolve(__dirname, '../../../src/styles', file), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/\s+/g, ' ');

const escape = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** The winning value of `name` across every rule whose selector list is exactly `selector` (later rules win). */
const prop = (source: string, selector: string, name: string): string | null => {
  const rules = [ ...source.matchAll(new RegExp(`(?:^|[}\\s])${escape(selector)} ?\\{([^}]*)\\}`, 'g')) ];

  if (rules.length === 0) {
    throw new Error(`no rule for ${selector}`);
  }

  const values = rules
    .map((rule) => rule[1].match(new RegExp(`(?:^|[;\\s])${escape(name)} ?: ?([^;]+);`)))
    .filter((match) => match !== null)
    .map((match) => match[1].trim());

  return values.at(-1) ?? null;
};

const radius = (source: string, selector: string): string | null => prop(source, selector, 'border-radius');

const inner = (fallback: string): string => `var(--blok-radius-inner, var(--blok-radius-${fallback}))`;

describe('toast card', () => {
  const css = read('notifier-card.css');
  const card = "[data-blok-interface='notifier'] [data-blok-toast='card']";

  it('is a surface, and its parts use roles (card border + padding clear the corner)', () => {
    expect(radius(css, card)).toBe('var(--blok-radius-surface)');
    expect(radius(css, "[data-blok-toast='card'] [data-blok-toast-part='thumb']")).toBe('var(--blok-radius-control-lg)');
    expect(radius(css, "[data-blok-toast='card'] [data-blok-toast-part='check']")).toBe('var(--blok-radius-control-lg)');
    expect(radius(css, "[data-blok-toast='card'] [data-blok-toast-part='count']")).toBe('var(--blok-radius-pill)');
    expect(radius(css, "[data-blok-toast='card'] [data-blok-toast-part='action']")).toBe('var(--blok-radius-pill)');
  });

  it('declares no per-component radius tokens', () => {
    expect(css).not.toMatch(/--blok-toast-[a-z-]*radius/);
  });
});

describe('emoji picker', () => {
  const css = read('emoji-picker.css');
  const scope = '[data-blok-emoji-picker]';

  it('card is a surface; its padding clears the corner, so it publishes no inner radius', () => {
    expect(radius(css, `${scope}[data-blok-popover]`)).toBe('var(--blok-radius-surface)');
    expect(prop(css, `${scope}[data-blok-popover]`, '--blok-radius-inner')).toBeNull();
  });

  it('header controls use control roles by height', () => {
    expect(radius(css, `${scope} [data-emoji-picker-clear]`)).toBe('var(--blok-radius-control)');
    expect(radius(css, `${scope} :is([data-emoji-picker-skin-toggle], [data-emoji-picker-random], [data-emoji-picker-remove])`))
      .toBe('var(--blok-radius-control)');
    expect(radius(css, `${scope} [data-emoji-picker-empty] button`)).toBe('var(--blok-radius-control)');
    expect(radius(css, `${scope} [data-emoji-native]`)).toBe('var(--blok-radius-control-lg)');
    expect(radius(css, '[data-emoji-picker-body]::-webkit-scrollbar-thumb')).toBe('var(--blok-radius-control-sm)');
  });

  it('skin tray is a surface and nests its 36px tones inside its 1px border + 5px padding', () => {
    const tray = `${scope} [data-emoji-picker-skin-tone]`;

    expect(radius(css, tray)).toBe('var(--blok-radius-surface)');
    expect(prop(css, tray, '--blok-radius-inner'))
      .toBe('max(var(--blok-radius-floor), calc(var(--blok-radius-surface) - 1px - var(--blok-space-1-25)))');
    expect(radius(css, `${tray} button`)).toBe(inner('control-lg'));
    expect(radius(css, `${scope} [data-emoji-skin-indicator]`)).toBe(inner('control-lg'));
  });

  it('category nav nests inside the card border + its 4px block padding', () => {
    const nav = `${scope} [data-emoji-picker-nav]`;

    expect(prop(css, nav, '--blok-radius-inner'))
      .toBe('max(var(--blok-radius-floor), calc(var(--blok-radius-surface) - 1px - var(--blok-space-1)))');
    expect(radius(css, `${scope} [data-emoji-nav]`)).toBe(inner('control-lg'));
    expect(radius(css, `${scope} [data-emoji-nav-indicator]`)).toBe(inner('control-lg'));
  });

  it('empty-state art cards are surfaces', () => {
    expect(radius(css, `${scope} [data-emoji-picker-empty-art] > span`)).toBe('var(--blok-radius-surface)');
    expect(radius(css, `${scope} [data-emoji-picker-empty-art] > span:nth-child(2)`)).toBe('var(--blok-radius-surface)');
  });
});

describe('find', () => {
  const css = read('find.css');
  const bar = '[data-blok-find-bar]';

  it('bar is a surface and nests its buttons inside its 6px padding', () => {
    expect(radius(css, bar)).toBe('var(--blok-radius-surface)');
    expect(prop(css, bar, '--blok-radius-inner'))
      .toBe('max(var(--blok-radius-floor), calc(var(--blok-radius-surface) - var(--blok-space-1-5)))');
    expect(radius(css, '[data-blok-find-icon-button]')).toBe(inner('control'));
    expect(radius(css, '[data-blok-find-text-button]')).toBe(inner('control'));
  });

  it('micro shapes use the notch; the tick is a pill', () => {
    expect(radius(css, "[data-blok-find-toggle='find-whole-word'] > span::after"))
      .toBe('0 0 var(--blok-radius-notch) var(--blok-radius-notch)');
    expect(radius(css, '[data-blok-find-lens-box]')).toBe('var(--blok-radius-notch)');
    expect(radius(css, '[data-blok-find-tick]')).toBe('var(--blok-radius-pill)');
  });
});

describe('presence', () => {
  const css = read('presence.css');

  it('caret label is a small control; faces stay circles', () => {
    expect(radius(css, '[data-blok-presence-caret-label]')).toBe('var(--blok-radius-control-sm)');
    expect(radius(css, '[data-blok-presence-face], [data-blok-presence-face-overflow]')).toBe('50%');
  });

  it('keeps the published caret token, which hosts may override', () => {
    expect(prop(css, '[data-blok-interface]', '--blok-presence-caret-radius')).toBe('var(--blok-radius-pill)');
    expect(radius(css, '[data-blok-presence-caret]')).toBe('var(--blok-presence-caret-radius, var(--blok-radius-pill))');
  });
});
