import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { cellText, gridToClipboard, parseClipboard, valueFromText } from '../../../../src/tools/database/database-table-clipboard';
import type { PropertyDefinition } from '../../../../src/tools/database/types';

const select: PropertyDefinition = {
  id: 's', name: 'Stage', type: 'select', position: 'a0',
  config: { options: [{ id: 'o1', label: 'Idea', position: 'a0' }, { id: 'o2', label: 'Build', position: 'a1' }] },
};
const multi: PropertyDefinition = { ...select, id: 'm', type: 'multiSelect' };
const number: PropertyDefinition = { id: 'n', name: 'Amount', type: 'number', position: 'a1' };
const checkbox: PropertyDefinition = { id: 'c', name: 'Done', type: 'checkbox', position: 'a2' };
const text: PropertyDefinition = { id: 't', name: 'Notes', type: 'text', position: 'a3' };
const date: PropertyDefinition = { id: 'd', name: 'Due', type: 'date', position: 'a4' };

describe('table clipboard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('copies labels, lists, Yes/No and numbers as clipboard text', () => {
    expect(cellText(select, 'o2')).toBe('Build');
    expect(cellText(multi, ['o1', 'o2'])).toBe('"Idea", Build');
    expect(valueFromText(multi, cellText(multi, ['o1', 'o2']))).toEqual(['o1', 'o2']);
    expect(cellText(checkbox, true)).toBe('Yes');
    expect(cellText(number, 35.5)).toBe('35.5');
    expect(cellText(text, null)).toBe('');
  });

  it('writes TSV and an HTML table, quoting and escaping what needs it', () => {
    const { text: tsv, html } = gridToClipboard([['a\tb', 'say "hi"'], ['<b>x</b>', 'two\nlines']]);

    expect(tsv).toBe('"a\tb"\t"say ""hi"""\n<b>x</b>\t"two\nlines"');
    expect(html).toBe('<table><tr><td>a\tb</td><td>say &quot;hi&quot;</td></tr><tr><td>&lt;b&gt;x&lt;/b&gt;</td><td>two\nlines</td></tr></table>');
  });

  it('reads TSV back to the same grid', () => {
    const grid = [['a\tb', 'say "hi"'], ['plain', 'two\nlines']];

    expect(parseClipboard({ text: gridToClipboard(grid).text })).toEqual(grid);
    expect(parseClipboard({ text: 'x\ty\n' })).toEqual([['x', 'y']]);
  });

  it('prefers an HTML table to the text, reading only cell text out of it', () => {
    const html = '<meta charset="utf-8"><table><tr><th>Name</th><td><b>Bold</b> <img src="x" onerror="window.__fired = true"></td></tr></table>';

    expect(parseClipboard({ html, text: 'ignored' })).toEqual([['Name', 'Bold ']]);
    expect((window as unknown as { __fired?: boolean }).__fired).toBeUndefined();
  });

  it('preserves HTML line breaks and significant spaces in table cells', () => {
    const html = '<table><tr><td>  first<br><b>second</b>  </td><td>  </td></tr></table>';

    expect(parseClipboard({ html })).toEqual([['  first\nsecond  ', '  ']]);
  });

  it('preserves a whitespace-only text cell instead of clearing it', () => {
    expect(valueFromText(text, '  ')).toBe('  ');
  });

  it('keeps comma-bearing multi-select labels when copying and pasting', () => {
    const tags: PropertyDefinition = { ...multi, config: { options: [
      { id: 'o-design', label: 'Research, "design"', position: 'a0' },
      { id: 'o-build', label: 'Build', position: 'a1' },
    ] } };

    expect(valueFromText(tags, cellText(tags, ['o-design', 'o-build'])))
      .toEqual(['o-design', 'o-build']);
  });

  it('matches a pasted comma-bearing multi-select label as one option', () => {
    const tags: PropertyDefinition = { ...multi, config: { options: [
      { id: 'o-design', label: 'Research, design', position: 'a0' },
      { id: 'o-build', label: 'Build', position: 'a1' },
    ] } };

    expect(valueFromText(tags, 'Research, design')).toEqual(['o-design']);
  });

  it('falls back to the text when the HTML has no table', () => {
    expect(parseClipboard({ html: '<p>one</p>', text: 'one' })).toEqual([['one']]);
  });

  it('turns pasted text into a value the property can hold, or nothing', () => {
    expect(valueFromText(select, 'build')).toBe('o2');
    expect(valueFromText(select, 'Unknown')).toBeUndefined();
    expect(valueFromText(multi, 'Idea, Build')).toEqual(['o1', 'o2']);
    expect(valueFromText(number, '1,200')).toBe(1200);
    expect(valueFromText(number, 'abc')).toBeUndefined();
    expect(valueFromText(checkbox, 'Yes')).toBe(true);
    expect(valueFromText(checkbox, 'No')).toBe(false);
    expect(valueFromText(date, '2026-10-09')).toBe('2026-10-09');
    expect(valueFromText(date, 'soon')).toBeUndefined();
    expect(valueFromText(text, '')).toBeNull();
  });

  // notion-spec-2 §19.7: in Percent a typed number is read as percent points; a paste reads the same way.
  describe('percent cells', () => {
    const percent: PropertyDefinition = { ...number, number: { format: 'percent' } };
    const rounded: PropertyDefinition = { ...number, number: { format: 'percent', decimals: 0 } };

    it.each([['50', 0.5], ['50%', 0.5], ['7.5', 0.075]])('a pasted "%s" stores %s, as typing it does', (pasted, stored) => {
      expect(valueFromText(percent, pasted, { locale: 'en-US' })).toBe(stored);
    });

    it('a paste that is not a number is skipped, not cleared', () => {
      expect(valueFromText(percent, 'abc', { locale: 'en-US' })).toBeUndefined();
    });

    it.each(['en-US', 'de-DE'])('copy and paste keep the stored value in %s', (locale) => {
      [0.5, 0.075, -0.25, 0.123456].forEach((value) => {
        [percent, rounded].forEach((property) => {
          expect(valueFromText(property, cellText(property, value, { locale }), { locale })).toBeCloseTo(value, 12);
        });
      });
    });

    it('a percent cell copies as percent points', () => {
      expect(cellText(percent, 0.5, { locale: 'en-US' })).toBe('50%');
    });
  });
});
