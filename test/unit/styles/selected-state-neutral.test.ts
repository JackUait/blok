import { describe, it, expect } from 'vitest';
import { readMainCss } from './helpers/read-main-css';

/**
 * Selected states are gray, never blue (CLAUDE.md "No blue selected states").
 * These tokens paint every selected popover item, active inline tool button
 * and the find bar's options button, so their defaults decide the whole editor.
 */

const css = readMainCss();

/** The keyboard cursor fill counts as selected too: Notion paints it gray. */
const SELECTED_FILLS = ['--blok-icon-active-bg', '--blok-popover-icon-active-bg', '--blok-item-focus-bg', '--blok-item-focus-shadow', '--blok-database-card-border-active'];

const declarations = (token: string): string[] =>
  [...css.matchAll(new RegExp(`${token}:\\s*([^;]+);`, 'g'))].map(match => match[1].trim());

describe('selected-state tokens are neutral', () => {
  it.each(SELECTED_FILLS)('%s is a gray fill in every theme', (token) => {
    const values = declarations(token);

    expect(values.length).toBeGreaterThanOrEqual(3);
    values.forEach(value => {
      const channels = value.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);

      expect(channels, `${token}: ${value}`).not.toBeNull();
      const [r, g, b] = (channels ?? []).slice(1).map(Number);

      // Gray: the channels differ by a warm tint at most, never a blue hue.
      expect(Math.max(r, g, b) - Math.min(r, g, b), `${token}: ${value}`).toBeLessThanOrEqual(10);
    });
  });

  it('--blok-icon-active-text is the primary ink in every theme', () => {
    const values = declarations('--blok-icon-active-text');

    expect(values.length).toBeGreaterThanOrEqual(3);
    values.forEach(value => expect(value).toBe('var(--blok-text-primary)'));
  });

  it('the public settingsButtonActive class paints primary ink on a gray fill', () => {
    const rule = css.match(/@utility blok-settings-button--active\s*\{([^}]*)\}/);

    expect(rule?.[1]).toContain('text-icon-active-text');
    expect(rule?.[1]).toContain('bg-icon-active-bg');
    expect(rule?.[1]).not.toContain('active-icon;');
  });

  it('the find options button marks an active option with the gray tokens', () => {
    const rule = css.match(/\[data-blok-find-options\]\[data-blok-find-options-active\][^{]*\{([^}]*)\}/);

    expect(rule?.[1]).toContain('background: var(--blok-popover-icon-active-bg)');
    expect(rule?.[1]).toContain('color: var(--blok-icon-active-text)');
  });
});
