/**
 * Static analysis of src/styles/main.css for the slash search pill: a tight
 * pill painted 2px around the text line, without touching the editable's own
 * box, so the text and the block do not move when the search opens.
 */
import { describe, expect, it } from 'vitest';

import { readMainCss } from './helpers/read-main-css';

const css = readMainCss();

const findRuleBody = (source: string, selector: string): string | null => {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(`(?:^|,\\s*|\\s)${escaped}\\s*\\{([^}]*)\\}`, 'm');
  const match = source.match(pattern);

  return match === null ? null : match[1];
};

describe('Slash search input styling (src/styles/main.css)', () => {
  it('paints the pill 2px above and below the text line', () => {
    const base = findRuleBody(css, '[data-blok-slash-search]:focus-visible');
    const pill = findRuleBody(css, '[data-blok-slash-search][contenteditable]::before');

    expect(base).toMatch(/--_blok-slash-search-pad:\s*2px/);
    expect(pill).toMatch(/height:\s*calc\(1lh \+ 2 \* var\(--_blok-slash-search-pad\)\)/);
    expect(pill).toMatch(/margin-top:\s*calc\(-1 \* var\(--_blok-slash-search-pad\)\)/);
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

  it('does not change the editable\'s vertical box, so the text and the block do not move', () => {
    const body = findRuleBody(css, '[data-blok-slash-search]:focus-visible');

    expect(body).not.toBeNull();
    expect(body).not.toMatch(/\b(?:m|my|mt|mb|p|py|pt|pb)-/);
    expect(body).not.toMatch(/(?:^|[\s;])(?:margin|padding)(?:-top|-bottom|-block)?\s*:/);
    expect(body).not.toMatch(/(?:^|[\s;])display\s*:/);
    expect(body).not.toMatch(/(?:^|[\s;])vertical-align\s*:|\balign-/);
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
    const body = findRuleBody(css, '[data-blok-slash-search][contenteditable]::before');

    expect(body).not.toBeNull();
    expect(body).not.toMatch(/rounded-\[10px\]/);

    const match = body?.match(/rounded-\[(\d+)px\]/);

    expect(match).not.toBeNull();

    const radius = match !== null && match !== undefined ? parseInt(match[1], 10) : Number.POSITIVE_INFINITY;

    expect(radius).toBeLessThanOrEqual(6);
  });
});
