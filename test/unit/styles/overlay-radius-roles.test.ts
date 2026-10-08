/**
 * Overlay radii follow the radius design system
 * (docs/plans/2026-09-30-radius-design-system.md): each radius is a role token,
 * and a child near a rounded corner reads the --blok-radius-inner its
 * container publishes. jsdom has no CSS, so these read the authored source.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { list } from 'postcss';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const read = (file: string): string => readFileSync(resolve(__dirname, '../../../src/styles', file), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/\s+/g, ' ');

const escape = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const prop = (source: string, selector: string, name: string): string | null => {
  const rules = [ ...source.matchAll(/([^{}]+)\{([^{}]*)\}/g) ]
    .filter((rule) => rule[1].trim() === selector || list.comma(rule[1]).includes(selector));

  if (rules.length === 0) {
    throw new Error(`no rule for ${selector}`);
  }

  const values = rules
    .map((rule) => rule[2].match(new RegExp(`(?:^|[;\\s])${escape(name)} ?: ?([^;]+);`)))
    .filter((match) => match !== null)
    .map((match) => match[1].trim());

  return values.at(-1) ?? null;
};

const radius = (source: string, selector: string): string | null => prop(source, selector, 'border-radius');

const inner = (fallback: string): string => `var(--blok-radius-inner, var(--blok-radius-${fallback}))`;

describe('selector lookup', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('matches exact group members without splitting functional or quoted commas', () => {
    const group = '[data-first], :is([data-second], [data-third]), [data-label="one,two"]';
    const css = `${group} { border-radius: var(--blok-radius-control-sm); }`;

    expect(radius(css, '[data-first]')).toBe('var(--blok-radius-control-sm)');
    expect(radius(css, ':is([data-second], [data-third])')).toBe('var(--blok-radius-control-sm)');
    expect(radius(css, '[data-label="one,two"]')).toBe('var(--blok-radius-control-sm)');
    expect(radius(css, group)).toBe('var(--blok-radius-control-sm)');
    expect(() => radius(css, '[data-second]')).toThrow('no rule for [data-second]');
    expect(() => radius(css, '[data-first-extra]')).toThrow('no rule for [data-first-extra]');
  });

  it('keeps the last matching value when a later rule omits the property', () => {
    const css = '[data-label], [data-other] { border-radius: 50%; } [data-label] { border-radius: var(--blok-radius-control-sm); } [data-label] { color: inherit; }';

    expect(radius(css, '[data-label]')).toBe('var(--blok-radius-control-sm)');
    expect(prop(css, '[data-label]', '--blok-radius-inner')).toBeNull();
  });
});

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
      .toBe('max(var(--blok-radius-floor), calc(var(--blok-radius-surface) - var(--blok-border-width-hairline) - var(--blok-space-1-25)))');
    expect(radius(css, `${tray} button`)).toBe(inner('control-lg'));
    expect(radius(css, `${scope} [data-emoji-skin-indicator]`)).toBe(inner('control-lg'));
  });

  it('category nav nests inside the card border + its 4px block padding', () => {
    const nav = `${scope} [data-emoji-picker-nav]`;

    expect(prop(css, nav, '--blok-radius-inner'))
      .toBe('max(var(--blok-radius-floor), calc(var(--blok-radius-surface) - var(--blok-border-width-hairline) - var(--blok-space-1)))');
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

  it('micro shapes use the notch', () => {
    expect(radius(css, '[data-blok-find-lens-box]')).toBe('var(--blok-radius-notch)');
  });

  it('paints the bar from a skin on the dock, so the bloom can grow it without moving layout', () => {
    const skin = '[data-blok-find]::before';

    expect(radius(css, skin)).toBe('var(--blok-radius-surface)');
    expect(prop(css, skin, 'background')).toBe('var(--blok-popover-bg)');
    expect(prop(css, skin, 'box-shadow')).toBe('var(--blok-popover-box-shadow)');
    expect(prop(css, bar, 'background')).toBeNull();
    expect(prop(css, bar, 'box-shadow')).toBeNull();
  });
});

describe('presence', () => {
  const css = read('presence.css');

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('caret label is a small control; faces stay circles', () => {
    expect(radius(css, '[data-blok-presence-caret-label]')).toBe('var(--blok-radius-control-sm)');
    expect(radius(css, '[data-blok-presence-face], [data-blok-presence-face-overflow]')).toBe('50%');
  });

  it('pins agent label, outline and face roles separately from human circles', () => {
    expect(radius(css, '[data-blok-agent-marker-label]')).toBe('var(--blok-radius-control-sm)');
    expect(radius(css, '[data-blok-agent-marker]')).toBe('var(--blok-radius-control)');
    expect(radius(css, '[data-blok-presence-face][data-blok-presence-agent]')).toBe('var(--blok-radius-control-sm)');
    expect(radius(css, '[data-blok-presence-face]')).toBe('50%');
    expect(radius(css, '[data-blok-presence-face-overflow]')).toBe('50%');
  });

  it('keeps the published caret token, which hosts may override', () => {
    expect(prop(css, '[data-blok-interface]', '--blok-presence-caret-radius')).toBe('var(--blok-radius-pill)');
    expect(radius(css, '[data-blok-presence-caret]')).toBe('var(--blok-presence-caret-radius, var(--blok-radius-pill))');
  });
});
