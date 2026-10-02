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

  it('exposes only bar, sheen and radius as host tokens; helpers live on the overlay and bars', () => {
    const publicTokens = ['--blok-skeleton-bar', '--blok-skeleton-sheen', '--blok-skeleton-radius'];
    const hostRules = [...css.matchAll(/(?:^|\n)([^{}\n]*\[data-blok-interface\][^{}\n]*)\{([^}]*)\}/g)];
    const hostSkeletonTokens = hostRules.flatMap(([, , body]) => [...body.matchAll(/(--blok-skeleton-[\w-]+)\s*:/g)].map(match => match[1]));
    const overlay = css.match(/\n\[data-blok-loading-skeleton\]\s*\{([^}]*)\}/)?.[1] ?? '';
    const bar = css.match(/\n\[data-blok-skeleton-bar\]\s*\{([^}]*)\}/)?.[1] ?? '';

    expect(hostSkeletonTokens.length).toBeGreaterThan(0);
    hostSkeletonTokens.forEach(token => expect(publicTokens, token).toContain(token));
    expect(overlay).toMatch(/--blok-skeleton-inset:/);
    expect(overlay).toMatch(/--blok-skeleton-indent:/);
    expect(overlay).toMatch(/--blok-skeleton-edge:\s*left/);
    expect(bar).toMatch(/--blok-skeleton-width:/);
    expect(bar).toMatch(/--blok-skeleton-index:/);
    expect(bar).toMatch(/--blok-skeleton-shift:/);
  });

  // The overlay declares the LTR edge itself, so an RTL value only reaches the bars from a rule on the overlay.
  it('flips the sheen edge on the overlay in RTL', () => {
    expect(css).toMatch(/\[data-blok-rtl="true"\] \[data-blok-loading-skeleton\]\s*\{[^}]*--blok-skeleton-edge:\s*right/);
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
    expect(sweep).not.toMatch(/\d%/);
    expect(bar).not.toMatch(/background-attachment\s*:/);
    expect(css).toMatch(/\[data-blok-skeleton-bar="list"\]\s*\{[^}]*--blok-skeleton-shift:\s*var\(--blok-skeleton-indent\)/);
  });

  it('the band starts and ends just off the overlay, so it is on the bars for most of each cycle', () => {
    const sweep = css.match(/@keyframes blok-skeleton-sweep\s*\{([^}]*\}[^}]*\})/)?.[1] ?? '';
    const [from, to] = [...sweep.matchAll(/--blok-skeleton-sweep:\s*(-?\d+(?:\.\d+)?)cqw/g)].map(match => Number(match[1]));
    // The gradient is 300cqw wide with its band at 40%..60%, so the band covers the overlay while the start sits in (-180cqw, -20cqw).
    const bandEntersAt = -180;
    const bandLeavesAt = -20;

    expect(from).toBeLessThanOrEqual(bandEntersAt);
    expect(to).toBeGreaterThanOrEqual(bandLeavesAt);
    expect(to - from).toBeLessThanOrEqual(1.6 * (bandLeavesAt - bandEntersAt));
  });
});
