/**
 * Drag drop-indicator look (BUG 4).
 *
 * Notion's drop line is a thin, saturated blue rule — not a pale wash with a
 * separate gray lead-in segment. These tests lock in that the indicator tokens
 * reuse the existing saturated accent (`--blok-link`, #2383e2) rather than the
 * old pale `#d4e3fc` / gray `#dcdcda` literals, and that the rule reads as thin.
 */

import { describe, it, expect } from 'vitest';
import { readMainCss } from './helpers/read-main-css';

const css = readMainCss();

/** The value assigned to a custom property across ALL of its declarations. */
const declaredValues = (prop: string): string[] => {
  const matches = css.matchAll(new RegExp(`${prop}\\s*:\\s*([^;]+);`, 'g'));

  return [...matches].map((m) => m[1].trim());
};

describe('drag drop-indicator look (BUG 4)', () => {
  it('paints the drop line with the saturated accent token, never the old pale wash', () => {
    const values = declaredValues('--blok-dnd-drop-indicator-bg');

    expect(values.length).toBeGreaterThan(0);
    // Reuses the existing saturated blue token — no pale #d4e3fc literal anywhere.
    expect(values.every((v) => v === 'var(--blok-link)')).toBe(true);
    expect(css).not.toContain('#d4e3fc');
  });

  it('drops the gray lead-in: the lead segment shares the saturated accent so the line reads as one blue rule', () => {
    const values = declaredValues('--blok-dnd-drop-indicator-lead-bg');

    expect(values.length).toBeGreaterThan(0);
    expect(values.every((v) => v === 'var(--blok-link)')).toBe(true);
    // The old gray lead literals are gone.
    expect(css).not.toContain('#dcdcda');
    expect(css).not.toContain('#3a3d42');
  });

  it('renders a thin rule (<= 3px), not the old 6px band', () => {
    const [thickness] = declaredValues('--blok-dnd-drop-indicator-thickness');

    expect(thickness).toBeDefined();

    const px = parseInt(thickness.replace('px', ''), 10);

    expect(px).toBeLessThanOrEqual(3);
  });
});
