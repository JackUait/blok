/**
 * Static analysis of src/styles/main.css to guarantee that the slash search
 * input styling stays compact: 2px vertical padding and smaller-than-base
 * text so the transformed paragraph reads as a tight search pill rather than
 * a normal body-copy paragraph.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const css = readFileSync(resolve(__dirname, '../../../src/styles/main.css'), 'utf-8');

const findRuleBody = (source: string, selector: string): string | null => {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(`(?:^|,\\s*|\\s)${escaped}\\s*\\{([^}]*)\\}`, 'm');
  const match = source.match(pattern);

  return match === null ? null : match[1];
};

describe('Slash search input styling (src/styles/main.css)', () => {
  it('applies 2px vertical padding via py-[2px] on the slash search pill', () => {
    const body = findRuleBody(css, '[data-blok-slash-search]:focus-visible');

    expect(body).not.toBeNull();
    expect(body).toMatch(/py-\[2px\]/);
  });

  it('does NOT force a font-size on the pill so it inherits from the host block (paragraph, h1, h2, ...)', () => {
    const body = findRuleBody(css, '[data-blok-slash-search]:focus-visible');

    expect(body).not.toBeNull();
    expect(body).not.toMatch(/\btext-(xs|sm|base|lg|xl|2xl|3xl|4xl|5xl)\b/);
    expect(body).not.toMatch(/font-size\s*:/);
  });

  it('does NOT force a font-size on the ::after placeholder so it inherits from the host block', () => {
    const body = findRuleBody(css, '[data-blok-slash-search]::after');

    expect(body).not.toBeNull();
    expect(body).not.toMatch(/\btext-(xs|sm|base|lg|xl|2xl|3xl|4xl|5xl)\b/);
    expect(body).not.toMatch(/font-size\s*:/);
  });

  it('applies a non-zero margin-top so the pill sits below the block boundary', () => {
    const body = findRuleBody(css, '[data-blok-slash-search]:focus-visible');

    expect(body).not.toBeNull();
    expect(body).toMatch(/mt-\d|mt-\[\d+px\]/);
  });

  it('prevents the placeholder from wrapping onto a second line in large-font blocks (h1, h2)', () => {
    const body = findRuleBody(css, '[data-blok-slash-search]:focus-visible');

    expect(body).not.toBeNull();
    expect(body).toMatch(/\bwhitespace-nowrap\b/);
  });

  it('drops the 240px max-width cap so the pill sizes to its content and does not force a wrap', () => {
    const body = findRuleBody(css, '[data-blok-slash-search]:focus-visible');

    expect(body).not.toBeNull();
    expect(body).not.toMatch(/max-w-\[240px\]/);
  });

  it('uses a smaller corner radius (<= 6px) so the pill feels like a tight search input', () => {
    const body = findRuleBody(css, '[data-blok-slash-search]:focus-visible');

    expect(body).not.toBeNull();
    expect(body).not.toMatch(/rounded-\[10px\]/);

    const match = body?.match(/rounded-\[(\d+)px\]/);

    expect(match).not.toBeNull();

    const radius = match !== null && match !== undefined ? parseInt(match[1], 10) : Number.POSITIVE_INFINITY;

    expect(radius).toBeLessThanOrEqual(6);
  });
});
