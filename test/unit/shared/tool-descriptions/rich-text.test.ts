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

  it('keeps the shared constants', () => {
    expect(ALIGNMENT).toEqual(['left', 'center', 'right']);
    expect(Object.keys(RICH_TEXT_MARKS.properties)).toContain('link');
  });
});
