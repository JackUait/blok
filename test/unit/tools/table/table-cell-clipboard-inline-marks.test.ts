/**
 * Cell paste must keep every inline mark a cell's text can hold. The cell
 * sanitizer stripped <u>, <s>, <code>, <del> and equation spans, so a
 * Blok-to-Blok cell copy lost them.
 */
import { describe, expect, it } from 'vitest';

import {
  buildClipboardHtml,
  parseClipboardHtml,
  parseGenericHtmlTable,
  serializeCellsToClipboard,
} from '../../../../src/tools/table/table-cell-clipboard';

const MARKED = 'a <strong>b</strong> <em>i</em> <u>u</u> <s>s</s> <del>d</del> <code>c</code> ' +
  '<a href="https://x.com">l</a> <mark style="color: red;">m</mark>';

const cellText = (payload: ReturnType<typeof parseClipboardHtml>): unknown =>
  payload?.cells[0][0].blocks[0].data.text;

describe('table cell clipboard keeps inline marks', () => {
  it('round-trips every inline mark through a Blok-to-Blok cell copy', () => {
    const html = buildClipboardHtml(serializeCellsToClipboard([
      { row: 0, col: 0, blocks: [{ tool: 'paragraph', data: { text: MARKED } }] },
    ]));

    expect(cellText(parseClipboardHtml(html))).toBe(MARKED);
  });

  it('keeps inline marks in a generic html table cell', () => {
    const payload = parseGenericHtmlTable(
      '<table><tr><td><u>u</u> <s>s</s> <code>c</code> <strong>b</strong></td></tr></table>'
    );

    expect(cellText(payload)).toBe('<u>u</u> <s>s</s> <code>c</code> <strong>b</strong>');
  });

  it('still drops a script and an unsafe attribute', () => {
    const html = buildClipboardHtml(serializeCellsToClipboard([
      { row: 0, col: 0, blocks: [{ tool: 'paragraph', data: { text: 'x<img src=x onerror=alert(1)><u onclick="y">u</u>' } }] },
    ]));

    expect(cellText(parseClipboardHtml(html))).toBe('x<u>u</u>');
  });
});

describe('table cell copy resolves Blok color tokens for other apps', () => {
  const payload = serializeCellsToClipboard([{
    row: 0,
    col: 0,
    color: 'var(--blok-color-red-bg)',
    textColor: 'var(--blok-color-blue-text)',
    blocks: [{ tool: 'paragraph', data: { text: '<mark style="color: var(--blok-color-green-text);">m</mark>' } }],
  }]);

  const visibleCell = (html: string): HTMLTableCellElement | null =>
    new DOMParser().parseFromString(html, 'text/html').querySelector('td');

  it('writes the light preset literal into the visible cell html', () => {
    const cell = visibleCell(buildClipboardHtml(payload));

    expect(cell?.getAttribute('style')).toContain('background-color: #fdebec');
    expect(cell?.getAttribute('style')).toContain('color: #337ea9');
    expect(cell?.querySelector('mark')?.getAttribute('style')).toContain('#448361');
    expect(cell?.outerHTML).not.toContain('var(--blok-color-');
  });

  it('keeps the tokens in the Blok payload', () => {
    const parsed = parseClipboardHtml(buildClipboardHtml(payload));

    expect(parsed?.cells[0][0].color).toBe('var(--blok-color-red-bg)');
    expect(parsed?.cells[0][0].textColor).toBe('var(--blok-color-blue-text)');
  });
});
