/**
 * Cell formatting that lives outside the cell's spans: Google Sheets puts
 * bold/italic/underline/strike on the <td> style, LibreOffice uses <font color>.
 * No real capture is in the repo: fixtures follow the documented shapes.
 */
import { describe, expect, it } from 'vitest';

import { preprocessTableCellFormatting } from '../../../../../src/components/modules/paste/table-cell-format-preprocessor';
import { parseUntrustedHtml } from '../../../../../src/components/utils/inert-html';
import { preprocessGoogleDocsHtml } from '../../../../../src/components/modules/paste/google-docs-preprocessor';
import { parseGenericHtmlTable } from '../../../../../src/tools/table/table-cell-clipboard';

const run = (html: string): HTMLElement => parseUntrustedHtml(preprocessTableCellFormatting(html));

const firstCell = (root: HTMLElement): HTMLElement => {
  const cell = root.querySelector<HTMLElement>('td, th');

  if (cell === null) {
    throw new Error('no cell');
  }

  return cell;
};

const table = (cell: string): string => `<table><tr>${cell}</tr></table>`;

describe('preprocessTableCellFormatting', () => {
  describe('cell-level marks (Google Sheets)', () => {
    it('wraps the text of a cell styled bold in <b>', () => {
      expect(firstCell(run(table('<td style="padding:2px;font-weight:bold;">Bold</td>'))).innerHTML).toBe('<b>Bold</b>');
    });

    it('wraps italic, underline and line-through', () => {
      expect(firstCell(run(table('<td style="font-style:italic">a</td>'))).innerHTML).toBe('<i>a</i>');
      expect(firstCell(run(table('<td style="text-decoration:underline">a</td>'))).innerHTML).toBe('<u>a</u>');
      expect(firstCell(run(table('<td style="text-decoration:line-through">a</td>'))).innerHTML).toBe('<s>a</s>');
    });

    it('wraps each line on its own so a later line split keeps the mark', () => {
      expect(firstCell(run(table('<td style="font-weight:700">one<br>two</td>'))).innerHTML).toBe('<b>one</b><br><b>two</b>');
    });

    it('removes the mark declarations it applied, so a second run does not wrap twice', () => {
      const once = preprocessTableCellFormatting(table('<td style="color:#ff0000;font-weight:bold">Bold</td>'));
      const cell = firstCell(parseUntrustedHtml(preprocessTableCellFormatting(once)));

      expect(cell.innerHTML).toBe('<b>Bold</b>');
      expect(cell.style.fontWeight).toBe('');
      expect(cell.style.color).not.toBe('');
    });

    it('does not bold a header cell, which already renders bold', () => {
      expect(firstCell(run(table('<th style="font-weight:bold;font-style:italic">H</th>'))).innerHTML).toBe('<i>H</i>');
    });

    it('leaves normal weight and no decoration alone', () => {
      const html = table('<td style="font-weight:normal;text-decoration:none">a</td>');

      expect(firstCell(run(html)).innerHTML).toBe('a');
    });

    it('does not wrap a cell holding a nested table', () => {
      const html = table('<td style="font-weight:bold">x<table><tr><td>inner</td></tr></table></td>');

      expect(run(html).querySelector('b')).toBeNull();
    });
  });

  describe('<font color> runs (LibreOffice Calc / Writer)', () => {
    it('becomes a span with that colour', () => {
      const span = run(table('<td><font color="#FF0000">Red</font></td>')).querySelector<HTMLElement>('td span');

      expect(span?.textContent).toBe('Red');
      expect(span?.style.color).toBe('rgb(255, 0, 0)');
      expect(run(table('<td><font color="#FF0000">Red</font></td>')).querySelector('font')).toBeNull();
    });

    it('keeps the font tag\'s other inline style', () => {
      const span = run(table('<td><font color="red" style="font-weight:bold">a</font></td>')).querySelector<HTMLElement>('td span');

      expect(span?.style.color).toBe('red');
      expect(span?.style.fontWeight).toBe('bold');
    });

    it.each(['inherit', 'currentcolor', 'transparent', 'ff0000', 'var(--x)', 'red;background:url(x)'])(
      'ignores colour %s',
      (color) => {
        expect(run(table(`<td><font color="${color}">a</font></td>`)).querySelector('span')).toBeNull();
      }
    );

    it('leaves a <font color> outside a table cell alone', () => {
      expect(run('<p><font color="#ff0000">a</font></p>').querySelector('span')).toBeNull();
    });
  });

  describe('the default-colour filters still apply downstream', () => {
    const newTableRoute = (html: string): string => preprocessGoogleDocsHtml(preprocessTableCellFormatting(html));
    const intoCellsRoute = (html: string): string =>
      JSON.stringify(parseGenericHtmlTable(preprocessTableCellFormatting(html))?.cells[0]?.[0]?.blocks);

    it('a default-black <font color> gives no mark on either route', () => {
      const html = table('<td><font color="#000000">a</font></td>');

      expect(newTableRoute(html)).not.toContain('<mark');
      expect(intoCellsRoute(html)).not.toContain('<mark');
    });

    it('a red <font color> gives a coloured mark on both routes', () => {
      const html = table('<td><font color="#ff0000">a</font></td>');

      expect(newTableRoute(html)).toMatch(/<mark style="color:/);
      expect(intoCellsRoute(html)).toMatch(/<mark style=\\"color:/);
    });

    // Existing span rule: only the new-table route drops near-white text.
    it('a light <font color> is dropped on the new-table route and kept on the into-cells route', () => {
      const html = table('<td><font color="#eeeeee">a</font></td>');

      expect(newTableRoute(html)).not.toContain('<mark');
      expect(intoCellsRoute(html)).toMatch(/<mark style=\\"color:/);
    });

    it('a white background shorthand on a span gives no mark on either route', () => {
      const html = table('<td><span style="background: white">a</span></td>');

      expect(newTableRoute(html)).not.toContain('<mark');
      expect(intoCellsRoute(html)).not.toContain('<mark');
    });
  });

  it('returns HTML without a table unchanged', () => {
    const html = '<p><b>x</b></p>';

    expect(preprocessTableCellFormatting(html)).toBe(html);
  });
});
