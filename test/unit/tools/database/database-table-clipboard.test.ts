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

  it('copies values as their display text: labels, Yes/No, numbers', () => {
    expect(cellText(select, 'o2')).toBe('Build');
    expect(cellText(multi, ['o1', 'o2'])).toBe('Idea, Build');
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

    expect(parseClipboard({ html, text: 'ignored' })).toEqual([['Name', 'Bold']]);
    expect((window as unknown as { __fired?: boolean }).__fired).toBeUndefined();
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
});
