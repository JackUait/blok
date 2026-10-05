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
const toneRule = (tone: string): string | undefined =>
  imageCss.match(new RegExp(`\\.blok-image-inner \\[data-tone="${tone}"\\] \\{([^}]*)\\}`))?.[1];

describe('paper and graphite tones', () => {
  it('add no root tokens: view.css keeps every root token, and a view has no chrome', () => {
    expect(css).not.toMatch(/--blok-image-(?:paper|graphite)-/);
    expect(css).not.toContain('--blok-image-handle-ink');
  });

  it('are keyed under a class, so the view stylesheet prunes them', () => {
    expect(imageCss).not.toMatch(/(^|[\s,])\[data-blok-tool="image"\] \[data-tone=/m);
    expect(toneRule('paper')).toBeDefined();
    expect(toneRule('graphite')).toBeDefined();
  });

  it('the cards are #ffffff and #252525, matching PAPER and GRAPHITE in tone.ts', () => {
    expect(toneRule('paper')).toContain('--blok-overlay-surface: #ffffff');
    expect(toneRule('graphite')).toContain('--blok-overlay-surface: #252525');
  });

  it.each(['paper', 'graphite'])('data-tone="%s" repaints every overlay token, none of them blue', (tone) => {
    const rule = toneRule(tone) ?? '';

    for (const token of ['surface', 'ring', 'fg', 'fg-strong', 'fg-hover', 'divider']) {
      expect(rule).toMatch(new RegExp(`--blok-overlay-${token}:`));
    }
    expect(rule).not.toMatch(/accent|#2383e2|blue/i);
  });
});
