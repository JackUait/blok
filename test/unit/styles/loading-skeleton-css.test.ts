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

  it('declares its tokens at zero specificity so a host rule always wins', () => {
    expect(css).toMatch(/:where\(\[data-blok-interface\]\)\s*\{[^}]*--blok-skeleton-radius:/);
    expect(css).not.toMatch(/(^|\n)\[data-blok-interface\]\s*\{[^}]*--blok-skeleton-/);
  });

  it('places the overlay on the content column: gutters, max width and alignment', () => {
    const overlay = css.match(/\n\[data-blok-loading-skeleton\]\s*\{([^}]*)\}/)?.[1] ?? '';

    expect(overlay).toMatch(/inset-inline:\s*var\(--blok-editor-gutter-start, 0px\) var\(--blok-editor-gutter-end, 0px\)/);
    expect(overlay).toMatch(/max-width:\s*var\(--blok-content-max-width, var\(--max-width-content\)\)/);
    expect(css).toMatch(/\[data-blok-width="full"\] \[data-blok-loading-skeleton\]\s*\{[^}]*max-width:\s*var\(--blok-content-max-width, none\)/);
    ['left', 'center', 'right'].forEach((align) => {
      expect(css).toContain(`[data-blok-content-align="${align}"] [data-blok-loading-skeleton]`);
    });
    expect(css).toContain('[data-blok-rtl="true"][data-blok-content-align="left"] [data-blok-loading-skeleton]');
    expect(css).toContain('[data-blok-rtl="true"][data-blok-content-align="right"] [data-blok-loading-skeleton]');
  });

  it('sizes and moves the sheen in overlay units so every bar shares one band', () => {
    const overlay = css.match(/\n\[data-blok-loading-skeleton\]\s*\{([^}]*)\}/)?.[1] ?? '';
    const bar = css.match(/\n\[data-blok-skeleton-bar\]\s*\{([^}]*)\}/)?.[1] ?? '';
    const sweep = css.match(/@keyframes blok-skeleton-sweep\s*\{([^}]*\}[^}]*\})/)?.[1] ?? '';

    expect(overlay).toMatch(/container-type:\s*inline-size/);
    expect(bar).toMatch(/background-size:\s*300cqw 100%/);
    expect(bar).toMatch(/background-position:[^;]*var\(--blok-skeleton-sweep\)\s*-\s*var\(--blok-skeleton-shift\)/);
    expect(sweep).toMatch(/-300cqw/);
    expect(sweep).toMatch(/100cqw/);
    expect(sweep).not.toMatch(/\d%/);
    expect(bar).not.toMatch(/background-attachment\s*:/);
    expect(css).toMatch(/\[data-blok-skeleton-bar="list"\]\s*\{[^}]*--blok-skeleton-shift:\s*var\(--blok-skeleton-indent\)/);
  });
});
