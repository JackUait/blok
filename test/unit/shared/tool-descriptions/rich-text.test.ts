// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { validateAgainst } from '../../../../src/shared/schema/validate';
import { ALIGNMENT, RICH_TEXT_MARKS, richText } from '../../../../src/shared/tool-descriptions/rich-text';

describe('richText', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('accepts segments and inline HTML, and nothing else', () => {
    const schema = richText('Body.');

    expect(schema.description).toBe('Body.');
    expect(validateAgainst(schema, [{ text: 'a', marks: { bold: true } }, { embed: { page: { id: 'p' } } }])).toEqual([]);
    expect(validateAgainst(schema, '<b>a</b>')).toEqual([]);
    expect(validateAgainst(schema, [{ text: 'a', marks: { blink: 'x' } }])).toEqual([]);
    expect(validateAgainst(schema, [{ markdown: '**a**' }]).length).toBeGreaterThan(0);
  });

  it('describes marks the way the agent write path stores them', () => {
    const { highlight, color, background, sup, link } = RICH_TEXT_MARKS.properties;

    expect(highlight.description).toContain('background "yellow"');
    for (const name of ['gray', 'brown', 'orange', 'yellow', 'green', 'blue', 'purple', 'pink', 'red']) {
      expect(color.description).toContain(`"${name}"`);
    }
    expect(background.description).toContain('color');
    expect(color.description).toContain('nearest');
    expect(color.description).toContain('var()');
    expect(color.description).toContain('other syntaxes drop');
    expect(highlight.description).toContain('unless background is set');
    expect(sup.description).toContain('sub');
    expect(link.description).toContain('"_blank"/"nofollow", "_self" for #anchors');
  });

  it('says a plain string is plain text, not HTML', () => {
    const text = JSON.stringify(richText('Body.'));

    expect(text).not.toContain('Accepted on input');
    expect(text).toContain('An agent command stores a string as plain text');
  });

  it('refuses extra fields inside an equation or page embed, as the runtime does', () => {
    const schema = richText('Body.');

    expect(validateAgainst(schema, [{ embed: { equation: { expression: 'x', size: 2 } } }]).length).toBeGreaterThan(0);
    expect(validateAgainst(schema, [{ embed: { page: { id: 'p', title: 'T' } } }]).length).toBeGreaterThan(0);
  });

  it('keeps the shared constants', () => {
    expect(ALIGNMENT).toEqual(['left', 'center', 'right']);
    expect(Object.keys(RICH_TEXT_MARKS.properties)).toContain('link');
  });
});
