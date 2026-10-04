import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const css = readFileSync(resolve(__dirname, '../../../src/styles/colors.css'), 'utf-8');
const TOKENS = ['--blok-image-frame-ring', '--blok-image-frame-ring-strong', '--blok-image-readout-bg', '--blok-image-readout-fg', '--blok-image-handle-shadow'];

describe('image chrome tokens', () => {
  it.each(TOKENS)('%s is defined for light, system-dark and forced-dark', (token) => {
    expect(css.split(`${token}:`).length - 1).toBe(3);
  });

  it('the selection ring is not blue', () => {
    const values = css.match(/--blok-image-frame-ring(?:-strong)?:\s*[^;]+;/g) ?? [];

    expect(values).toHaveLength(6);
    for (const v of values) expect(v).not.toMatch(/accent|#2383e2|blue/i);
  });
});

const imageCss = readFileSync(resolve(__dirname, '../../../src/styles/image.css'), 'utf-8');
const TONE_PARTS = ['surface', 'ring', 'fg', 'fg-strong', 'fg-hover', 'divider', 'handle'];

describe('paper and graphite tones', () => {
  it.each(['paper', 'graphite'])('every %s token is defined once: the picture picks it, not the theme', (tone) => {
    for (const part of TONE_PARTS) {
      expect(css.split(`--blok-image-${tone}-${part}:`).length - 1).toBe(1);
    }
  });

  it('the cards are #fff and #252525, matching pickTone in tone.ts', () => {
    expect(css).toMatch(/--blok-image-paper-surface:\s*#ffffff;/);
    expect(css).toMatch(/--blok-image-graphite-surface:\s*#252525;/);
  });

  it('handle ink follows the theme when no tone is known', () => {
    expect(css.split('--blok-image-handle-ink:').length - 1).toBe(3);
  });

  it('no tone value is blue', () => {
    const values = css.match(/--blok-image-(?:paper|graphite)-[a-z-]+:\s*[^;]+;/g) ?? [];

    expect(values).toHaveLength(TONE_PARTS.length * 2);
    for (const v of values) expect(v).not.toMatch(/accent|#2383e2|blue/i);
  });

  it.each(['paper', 'graphite'])('data-tone="%s" repaints the overlay tokens', (tone) => {
    const rule = imageCss.match(new RegExp(`\\[data-tone="${tone}"\\] \\{([^}]*)\\}`));

    expect(rule).not.toBeNull();
    for (const token of ['surface', 'ring', 'fg', 'fg-strong', 'fg-hover', 'divider']) {
      expect(rule?.[1]).toContain(`--blok-overlay-${token}: var(--blok-image-${tone}-${token})`);
    }
    expect(rule?.[1]).toContain(`--blok-image-handle-ink: var(--blok-image-${tone}-handle)`);
  });
});
