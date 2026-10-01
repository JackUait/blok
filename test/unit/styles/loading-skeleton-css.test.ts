import { describe, expect, it } from 'vitest';
import { readMainCss } from './helpers/read-main-css';

const css = readMainCss();
const declarations = (token: string): string[] =>
  [...css.matchAll(new RegExp(`${token}:\\s*([^;]+);`, 'g'))].map(match => match[1].trim());

describe('loading skeleton styles', () => {
  it.each(['--blok-skeleton-bar', '--blok-skeleton-sheen'])('%s is gray in light, media-dark and attr-dark', (token) => {
    const values = declarations(token);

    expect(values.length).toBeGreaterThanOrEqual(3);
    values.forEach((value) => {
      const channels = value.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);

      expect(channels, `${token}: ${value}`).not.toBeNull();
      const [r, g, b] = (channels ?? []).slice(1).map(Number);

      expect(Math.max(r, g, b) - Math.min(r, g, b), `${token}: ${value}`).toBeLessThanOrEqual(10);
    });
  });

  it('defines the sweep and breathe keyframes', () => {
    expect(css).toMatch(/@keyframes blok-skeleton-sweep\b/);
    expect(css).toMatch(/@keyframes blok-skeleton-breathe\b/);
  });

  it('stops all skeleton motion under reduced motion', () => {
    const reduced = css.match(/@media \(prefers-reduced-motion: reduce\)\s*\{[^@]*\[data-blok-skeleton-bar\][^}]*animation:\s*none/);

    expect(reduced).not.toBeNull();
  });

  it('keeps the overlay out of pointer input', () => {
    expect(css).toMatch(/\[data-blok-loading-skeleton\]\s*\{[^}]*pointer-events:\s*none/);
  });
});
