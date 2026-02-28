import { describe, it, expect } from 'vitest';
import type { ClipboardBlockData, TableCellsClipboard } from '../../../../src/tools/table/types';
import {
  serializeCellsToClipboard,
  buildClipboardHtml,
  buildClipboardPlainText,
  parseClipboardHtml,
  parseGenericHtmlTable,
} from '../../../../src/tools/table/table-cell-clipboard';

describe('table-cell-clipboard', () => {
  // ---------------------------------------------------------------------------
  // serializeCellsToClipboard
  // ---------------------------------------------------------------------------
  describe('serializeCellsToClipboard', () => {
    it('should produce a 2D grid from flat cell-block pairs', () => {
      const entries = [
        { row: 0, col: 0, blocks: [{ tool: 'paragraph', data: { text: 'A' } }] },
        { row: 0, col: 1, blocks: [{ tool: 'paragraph', data: { text: 'B' } }] },
        { row: 1, col: 0, blocks: [{ tool: 'paragraph', data: { text: 'C' } }] },
        { row: 1, col: 1, blocks: [{ tool: 'paragraph', data: { text: 'D' } }] },
      ];

      const result = serializeCellsToClipboard(entries);

      expect(result.rows).toBe(2);
      expect(result.cols).toBe(2);
      expect(result.cells).toEqual([
        [
          { blocks: [{ tool: 'paragraph', data: { text: 'A' } }] },
          { blocks: [{ tool: 'paragraph', data: { text: 'B' } }] },
        ],
        [
          { blocks: [{ tool: 'paragraph', data: { text: 'C' } }] },
          { blocks: [{ tool: 'paragraph', data: { text: 'D' } }] },
        ],
      ]);
    });

    it('should normalize row/col offsets to start at 0', () => {
      const entries = [
        { row: 2, col: 3, blocks: [{ tool: 'paragraph', data: { text: 'X' } }] },
        { row: 2, col: 4, blocks: [{ tool: 'paragraph', data: { text: 'Y' } }] },
        { row: 3, col: 3, blocks: [{ tool: 'paragraph', data: { text: 'Z' } }] },
        { row: 3, col: 4, blocks: [{ tool: 'paragraph', data: { text: 'W' } }] },
      ];

      const result = serializeCellsToClipboard(entries);

      expect(result.rows).toBe(2);
      expect(result.cols).toBe(2);
      expect(result.cells[0][0].blocks[0].data.text).toBe('X');
      expect(result.cells[0][1].blocks[0].data.text).toBe('Y');
      expect(result.cells[1][0].blocks[0].data.text).toBe('Z');
      expect(result.cells[1][1].blocks[0].data.text).toBe('W');
    });

    it('should handle cells with multiple blocks', () => {
      const entries = [
        {
          row: 0,
          col: 0,
          blocks: [
            { tool: 'paragraph', data: { text: 'First' } },
            { tool: 'header', data: { text: 'Second', level: 2 } },
          ],
        },
      ];

      const result = serializeCellsToClipboard(entries);

      expect(result.rows).toBe(1);
      expect(result.cols).toBe(1);
      expect(result.cells[0][0].blocks).toHaveLength(2);
      expect(result.cells[0][0].blocks[0].tool).toBe('paragraph');
      expect(result.cells[0][0].blocks[1].tool).toBe('header');
    });

    it('should handle empty cells (blocks: [])', () => {
      const entries = [
        { row: 0, col: 0, blocks: [] as ClipboardBlockData[] },
        { row: 0, col: 1, blocks: [{ tool: 'paragraph', data: { text: 'Hello' } }] },
      ];

      const result = serializeCellsToClipboard(entries);

      expect(result.cells[0][0].blocks).toEqual([]);
      expect(result.cells[0][1].blocks).toHaveLength(1);
    });

    it('should return empty payload for empty input', () => {
      const result = serializeCellsToClipboard([]);

      expect(result.rows).toBe(0);
      expect(result.cols).toBe(0);
      expect(result.cells).toEqual([]);
    });

    it('should preserve color and textColor from entries', () => {
      const entries = [
        { row: 0, col: 0, blocks: [{ tool: 'paragraph', data: { text: 'A' } }], color: '#ff0000', textColor: '#ffffff' },
        { row: 0, col: 1, blocks: [{ tool: 'paragraph', data: { text: 'B' } }], color: '#00ff00' },
        { row: 1, col: 0, blocks: [{ tool: 'paragraph', data: { text: 'C' } }], textColor: '#0000ff' },
        { row: 1, col: 1, blocks: [{ tool: 'paragraph', data: { text: 'D' } }] },
      ];

      const result = serializeCellsToClipboard(entries);

      expect(result.cells[0][0]).toEqual({
        blocks: [{ tool: 'paragraph', data: { text: 'A' } }],
        color: '#ff0000',
        textColor: '#ffffff',
      });
      expect(result.cells[0][1]).toEqual({
        blocks: [{ tool: 'paragraph', data: { text: 'B' } }],
        color: '#00ff00',
      });
      expect(result.cells[1][0]).toEqual({
        blocks: [{ tool: 'paragraph', data: { text: 'C' } }],
        textColor: '#0000ff',
      });
      // No color or textColor — should not have the keys
      expect(result.cells[1][1]).toEqual({
        blocks: [{ tool: 'paragraph', data: { text: 'D' } }],
      });
    });

    it('should not include color/textColor keys when they are undefined', () => {
      const entries = [
        { row: 0, col: 0, blocks: [{ tool: 'paragraph', data: { text: 'X' } }], color: undefined, textColor: undefined },
      ];

      const result = serializeCellsToClipboard(entries);

      expect(result.cells[0][0]).toEqual({
        blocks: [{ tool: 'paragraph', data: { text: 'X' } }],
      });
      expect('color' in result.cells[0][0]).toBe(false);
      expect('textColor' in result.cells[0][0]).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  // buildClipboardHtml
  // ---------------------------------------------------------------------------
  describe('buildClipboardHtml', () => {
    it('should produce a <table> with data-blok-table-cells attribute', () => {
      const payload: TableCellsClipboard = {
        rows: 1,
        cols: 1,
        cells: [[{ blocks: [{ tool: 'paragraph', data: { text: 'Hello' } }] }]],
      };

      const html = buildClipboardHtml(payload);

      expect(html).toContain('<table');
      expect(html).toContain('data-blok-table-cells');
    });

    it('should embed valid JSON in the data attribute', () => {
      const payload: TableCellsClipboard = {
        rows: 1,
        cols: 1,
        cells: [[{ blocks: [{ tool: 'paragraph', data: { text: 'Test' } }] }]],
      };

      const html = buildClipboardHtml(payload);

      // Extract the single-quoted attribute value using regex
      const match = html.match(/data-blok-table-cells='([^']*)'/);

      expect(match).not.toBeNull();

      // Unescape HTML entities before parsing
      const jsonStr = match?.[1]?.replace(/&#39;/g, "'") ?? '';
      const parsed = JSON.parse(jsonStr);

      expect(parsed).toEqual(payload);
    });

    it('should have <td> cells with text content', () => {
      const payload: TableCellsClipboard = {
        rows: 1,
        cols: 2,
        cells: [
          [
            { blocks: [{ tool: 'paragraph', data: { text: 'Cell A' } }] },
            { blocks: [{ tool: 'paragraph', data: { text: 'Cell B' } }] },
          ],
        ],
      };

      const html = buildClipboardHtml(payload);

      expect(html).toContain('<td>Cell A</td>');
      expect(html).toContain('<td>Cell B</td>');
    });

    it('should handle cells with empty blocks (empty <td>)', () => {
      const payload: TableCellsClipboard = {
        rows: 1,
        cols: 1,
        cells: [[{ blocks: [] }]],
      };

      const html = buildClipboardHtml(payload);

      expect(html).toContain('<td></td>');
    });
  });

  // ---------------------------------------------------------------------------
  // buildClipboardPlainText
  // ---------------------------------------------------------------------------
  describe('buildClipboardPlainText', () => {
    it('should produce tab-separated rows with newline separators', () => {
      const payload: TableCellsClipboard = {
        rows: 2,
        cols: 2,
        cells: [
          [
            { blocks: [{ tool: 'paragraph', data: { text: 'A' } }] },
            { blocks: [{ tool: 'paragraph', data: { text: 'B' } }] },
          ],
          [
            { blocks: [{ tool: 'paragraph', data: { text: 'C' } }] },
            { blocks: [{ tool: 'paragraph', data: { text: 'D' } }] },
          ],
        ],
      };

      const text = buildClipboardPlainText(payload);

      expect(text).toBe('A\tB\nC\tD');
    });

    it('should join multiple blocks in a cell with spaces', () => {
      const payload: TableCellsClipboard = {
        rows: 1,
        cols: 1,
        cells: [
          [
            {
              blocks: [
                { tool: 'paragraph', data: { text: 'First' } },
                { tool: 'paragraph', data: { text: 'Second' } },
              ],
            },
          ],
        ],
      };

      const text = buildClipboardPlainText(payload);

      expect(text).toBe('First Second');
    });

    it('should handle empty cells as empty strings', () => {
      const payload: TableCellsClipboard = {
        rows: 1,
        cols: 2,
        cells: [
          [
            { blocks: [] },
            { blocks: [{ tool: 'paragraph', data: { text: 'Hello' } }] },
          ],
        ],
      };

      const text = buildClipboardPlainText(payload);

      expect(text).toBe('\tHello');
    });
  });

  // ---------------------------------------------------------------------------
  // parseClipboardHtml
  // ---------------------------------------------------------------------------
  describe('parseClipboardHtml', () => {
    it('should extract TableCellsClipboard from HTML with data attribute', () => {
      const payload: TableCellsClipboard = {
        rows: 1,
        cols: 1,
        cells: [[{ blocks: [{ tool: 'paragraph', data: { text: 'Test' } }] }]],
      };

      const html = buildClipboardHtml(payload);
      const result = parseClipboardHtml(html);

      expect(result).toEqual(payload);
    });

    it('should roundtrip: buildClipboardHtml -> parseClipboardHtml returns same data', () => {
      const payload: TableCellsClipboard = {
        rows: 2,
        cols: 3,
        cells: [
          [
            { blocks: [{ tool: 'paragraph', data: { text: 'A' } }] },
            { blocks: [{ tool: 'header', data: { text: 'B', level: 2 } }] },
            { blocks: [] },
          ],
          [
            {
              blocks: [
                { tool: 'paragraph', data: { text: 'D' } },
                { tool: 'paragraph', data: { text: 'E' } },
              ],
            },
            { blocks: [{ tool: 'paragraph', data: { text: 'F' } }] },
            { blocks: [{ tool: 'list', data: { items: ['x', 'y'] } }] },
          ],
        ],
      };

      const html = buildClipboardHtml(payload);
      const result = parseClipboardHtml(html);

      expect(result).toEqual(payload);
    });

    it('should roundtrip color and textColor through HTML clipboard', () => {
      const payload: TableCellsClipboard = {
        rows: 2,
        cols: 2,
        cells: [
          [
            { blocks: [{ tool: 'paragraph', data: { text: 'A' } }], color: '#ff0000', textColor: '#ffffff' },
            { blocks: [{ tool: 'paragraph', data: { text: 'B' } }], color: '#00ff00' },
          ],
          [
            { blocks: [{ tool: 'paragraph', data: { text: 'C' } }], textColor: '#0000ff' },
            { blocks: [{ tool: 'paragraph', data: { text: 'D' } }] },
          ],
        ],
      };

      const html = buildClipboardHtml(payload);
      const result = parseClipboardHtml(html);

      expect(result).toEqual(payload);
    });

    it('should return null for HTML without the data attribute', () => {
      const html = '<table><tr><td>Hello</td></tr></table>';
      const result = parseClipboardHtml(html);

      expect(result).toBeNull();
    });

    it('should return null for non-table HTML', () => {
      const html = '<div><p>Not a table</p></div>';
      const result = parseClipboardHtml(html);

      expect(result).toBeNull();
    });

    it('should return null for invalid JSON in data attribute', () => {
      const html = '<table data-blok-table-cells="not-valid-json"><tr><td>X</td></tr></table>';
      const result = parseClipboardHtml(html);

      expect(result).toBeNull();
    });
  });

  // ---------------------------------------------------------------------------
  // parseGenericHtmlTable
  // ---------------------------------------------------------------------------
  describe('parseGenericHtmlTable', () => {
    it('should parse a simple HTML table into a TableCellsClipboard', () => {
      const html = '<table><tr><td>A</td><td>B</td></tr><tr><td>C</td><td>D</td></tr></table>';
      const result = parseGenericHtmlTable(html);

      expect(result).not.toBeNull();
      expect(result?.rows).toBe(2);
      expect(result?.cols).toBe(2);
      expect(result?.cells[0][0].blocks[0].data.text).toBe('A');
      expect(result?.cells[0][1].blocks[0].data.text).toBe('B');
      expect(result?.cells[1][0].blocks[0].data.text).toBe('C');
      expect(result?.cells[1][1].blocks[0].data.text).toBe('D');
    });

    it('should handle Google Docs wrapper HTML', () => {
      const html = `
        <meta charset="utf-8">
        <b id="docs-internal-guid-abc123" style="font-weight:normal;">
          <div dir="ltr">
            <table style="border:none;">
              <tbody>
                <tr>
                  <td style="padding:5pt;"><p dir="ltr"><span>Hello</span></p></td>
                  <td style="padding:5pt;"><p dir="ltr"><span>World</span></p></td>
                </tr>
              </tbody>
            </table>
          </div>
        </b>`;
      const result = parseGenericHtmlTable(html);

      expect(result).not.toBeNull();
      expect(result?.rows).toBe(1);
      expect(result?.cols).toBe(2);
      expect(result?.cells[0][0].blocks[0].data.text).toBe('Hello');
      expect(result?.cells[0][1].blocks[0].data.text).toBe('World');
    });

    it('should handle th elements as cells', () => {
      const html = '<table><tr><th>Header 1</th><th>Header 2</th></tr><tr><td>Data 1</td><td>Data 2</td></tr></table>';
      const result = parseGenericHtmlTable(html);

      expect(result).not.toBeNull();
      expect(result?.rows).toBe(2);
      expect(result?.cols).toBe(2);
      expect(result?.cells[0][0].blocks[0].data.text).toBe('Header 1');
    });

    it('should normalize uneven column counts', () => {
      const html = '<table><tr><td>A</td><td>B</td><td>C</td></tr><tr><td>D</td></tr></table>';
      const result = parseGenericHtmlTable(html);

      expect(result).not.toBeNull();
      expect(result?.rows).toBe(2);
      expect(result?.cols).toBe(3);
      // Second row should be padded with empty paragraph blocks
      expect(result?.cells[1][1].blocks[0].data.text).toBe('');
      expect(result?.cells[1][2].blocks[0].data.text).toBe('');
    });

    it('should return null for HTML without a table', () => {
      const html = '<div><p>Not a table</p></div>';
      const result = parseGenericHtmlTable(html);

      expect(result).toBeNull();
    });

    it('should return null for empty string', () => {
      const result = parseGenericHtmlTable('');

      expect(result).toBeNull();
    });

    it('should return null for a table with no rows', () => {
      const html = '<table></table>';
      const result = parseGenericHtmlTable(html);

      expect(result).toBeNull();
    });

    it('should skip HTML that contains our custom data attribute', () => {
      const html = '<table data-blok-table-cells=\'{"rows":1,"cols":1,"cells":[[{"blocks":[]}]]}\'><tr><td>X</td></tr></table>';
      const result = parseGenericHtmlTable(html);

      expect(result).toBeNull();
    });

    it('should trim whitespace from cell text', () => {
      const html = '<table><tr><td>  spaced  </td></tr></table>';
      const result = parseGenericHtmlTable(html);

      expect(result?.cells[0][0].blocks[0].data.text).toBe('spaced');
    });

    it('should create paragraph blocks with tool set to paragraph', () => {
      const html = '<table><tr><td>Test</td></tr></table>';
      const result = parseGenericHtmlTable(html);

      expect(result?.cells[0][0].blocks[0].tool).toBe('paragraph');
    });

    it('should preserve bold formatting from Google Docs style spans', () => {
      const html = '<table><tr><td><span style="font-weight:700">bold text</span></td></tr></table>';
      const result = parseGenericHtmlTable(html);

      expect(result?.cells[0][0].blocks[0].data.text).toBe('<b>bold text</b>');
    });

    it('should preserve italic formatting from Google Docs style spans', () => {
      const html = '<table><tr><td><span style="font-style:italic">italic text</span></td></tr></table>';
      const result = parseGenericHtmlTable(html);

      expect(result?.cells[0][0].blocks[0].data.text).toBe('<i>italic text</i>');
    });

    it('should split paragraph boundaries into separate blocks', () => {
      const html = '<table><tr><td><p>line one</p><p>line two</p></td></tr></table>';
      const result = parseGenericHtmlTable(html);

      expect(result?.cells[0][0].blocks).toHaveLength(2);
      expect(result?.cells[0][0].blocks[0].data.text).toBe('line one');
      expect(result?.cells[0][0].blocks[1].data.text).toBe('line two');
    });

    it('should produce one block for single-paragraph cells', () => {
      const html = '<table><tr><td><p>only line</p></td></tr></table>';
      const result = parseGenericHtmlTable(html);

      expect(result?.cells[0][0].blocks).toHaveLength(1);
      expect(result?.cells[0][0].blocks[0].data.text).toBe('only line');
    });

    it('should preserve links with href', () => {
      const html = '<table><tr><td><a href="https://example.com">click here</a></td></tr></table>';
      const result = parseGenericHtmlTable(html);

      expect(result?.cells[0][0].blocks[0].data.text).toBe('<a href="https://example.com">click here</a>');
    });

    it('should handle nested bold and italic in same span', () => {
      const html = '<table><tr><td><span style="font-weight:700;font-style:italic">bold italic</span></td></tr></table>';
      const result = parseGenericHtmlTable(html);

      expect(result?.cells[0][0].blocks[0].data.text).toBe('<b><i>bold italic</i></b>');
    });

    it('should handle Google Docs table with mixed formatting', () => {
      const html = `<table><tr>
        <td><p><span style="font-weight:700">Name</span></p></td>
        <td><p><span>plain</span></p></td>
      </tr></table>`;
      const result = parseGenericHtmlTable(html);

      expect(result?.cells[0][0].blocks[0].data.text).toBe('<b>Name</b>');
      expect(result?.cells[0][1].blocks[0].data.text).toBe('plain');
    });

    it('should not leave trailing br tags', () => {
      const html = '<table><tr><td><p>only line</p></td></tr></table>';
      const result = parseGenericHtmlTable(html);

      expect(result?.cells[0][0].blocks[0].data.text).not.toMatch(/<br>$/);
    });

    it('should handle font-weight bold keyword', () => {
      const html = '<table><tr><td><span style="font-weight:bold">bold text</span></td></tr></table>';
      const result = parseGenericHtmlTable(html);

      expect(result?.cells[0][0].blocks[0].data.text).toBe('<b>bold text</b>');
    });

    it('should strip disallowed tags but keep their text', () => {
      const html = '<table><tr><td><div><u>underlined</u></div></td></tr></table>';
      const result = parseGenericHtmlTable(html);

      expect(result?.cells[0][0].blocks[0].data.text).toBe('underlined');
    });

    it('should still return plain text for cells without formatting', () => {
      const html = '<table><tr><td>plain text</td></tr></table>';
      const result = parseGenericHtmlTable(html);

      expect(result?.cells[0][0].blocks[0].data.text).toBe('plain text');
    });

    // -------------------------------------------------------------------------
    // Google Docs color import — inline text colors
    // -------------------------------------------------------------------------

    it('should convert color span to <mark> with color style in cell content', () => {
      const html = '<table><tr><td><span style="color: rgb(255, 0, 0)">red text</span></td></tr></table>';
      const result = parseGenericHtmlTable(html);

      expect(result?.cells[0][0].blocks[0].data.text).toBe('<mark style="color: #d44c47; background-color: transparent;">red text</mark>');
    });

    it('should convert background-color span to <mark> with background-color style in cell content', () => {
      const html = '<table><tr><td><span style="background-color: rgb(255, 255, 0)">highlighted</span></td></tr></table>';
      const result = parseGenericHtmlTable(html);

      expect(result?.cells[0][0].blocks[0].data.text).toBe('<mark style="background-color: #fbf3db;">highlighted</mark>');
    });

    it('should convert bold+color span to nested <b><mark> in cell content', () => {
      const html = '<table><tr><td><span style="font-weight:700; color: rgb(255, 0, 0)">bold red</span></td></tr></table>';
      const result = parseGenericHtmlTable(html);

      expect(result?.cells[0][0].blocks[0].data.text).toBe('<b><mark style="color: #d44c47; background-color: transparent;">bold red</mark></b>');
    });

    it('should not create <mark> for default black text color in cell content', () => {
      const html = '<table><tr><td><span style="color: rgb(0, 0, 0)">normal text</span></td></tr></table>';
      const result = parseGenericHtmlTable(html);

      expect(result?.cells[0][0].blocks[0].data.text).not.toContain('<mark');
    });

    it('should convert span with both color and background-color to <mark> with both styles', () => {
      const html = '<table><tr><td><span style="color: rgb(255, 0, 0); background-color: rgb(255, 255, 0)">colored highlighted</span></td></tr></table>';
      const result = parseGenericHtmlTable(html);

      expect(result?.cells[0][0].blocks[0].data.text).toBe(
        '<mark style="color: #d44c47; background-color: #fbf3db;">colored highlighted</mark>'
      );
    });

    it('should convert italic+color span to nested <i><mark> in cell content', () => {
      const html = '<table><tr><td><span style="font-style:italic; color: rgb(0, 0, 255)">italic blue</span></td></tr></table>';
      const result = parseGenericHtmlTable(html);

      expect(result?.cells[0][0].blocks[0].data.text).toBe('<i><mark style="color: #337ea9; background-color: transparent;">italic blue</mark></i>');
    });

    // -------------------------------------------------------------------------
    // Google Docs color import — cell-level background color
    // -------------------------------------------------------------------------

    it('should extract cell background-color from td style as cell color', () => {
      const html = '<table><tr><td style="background-color: rgb(255, 0, 0)">red cell</td></tr></table>';
      const result = parseGenericHtmlTable(html);

      expect(result?.cells[0][0].color).toBe('#fdebec');
      expect(result?.cells[0][0].blocks[0].data.text).toBe('red cell');
    });

    it('should not set color property when td has no background-color', () => {
      const html = '<table><tr><td>plain cell</td></tr></table>';
      const result = parseGenericHtmlTable(html);

      expect(result?.cells[0][0].color).toBeUndefined();
    });

    it('should extract cell background-color from th style as cell color', () => {
      const html = '<table><tr><th style="background-color: rgb(0, 128, 255)">blue header</th></tr></table>';
      const result = parseGenericHtmlTable(html);

      expect(result?.cells[0][0].color).toBe('#e7f3f8');
    });

    it('should handle both cell background-color and inline text color together', () => {
      const html = '<table><tr><td style="background-color: rgb(255, 255, 0)"><span style="color: rgb(255, 0, 0)">red on yellow</span></td></tr></table>';
      const result = parseGenericHtmlTable(html);

      expect(result?.cells[0][0].color).toBe('#fbf3db');
      expect(result?.cells[0][0].blocks[0].data.text).toBe('<mark style="color: #d44c47; background-color: transparent;">red on yellow</mark>');
    });

    it('should extract cell background-color from realistic Google Docs table HTML', () => {
      const html = `
        <table style="border:none;border-collapse:collapse;">
          <tbody>
            <tr>
              <td style="border:solid #000 0.5pt;padding:5pt;background-color:#ff0000;">
                <p dir="ltr"><span style="color: rgb(255, 255, 255); font-weight:700">White bold on red</span></p>
              </td>
              <td style="border:solid #000 0.5pt;padding:5pt;">
                <p dir="ltr"><span>Normal cell</span></p>
              </td>
            </tr>
          </tbody>
        </table>`;
      const result = parseGenericHtmlTable(html);

      expect(result?.cells[0][0].color).toBe('#fdebec');
      expect(result?.cells[0][0].blocks[0].data.text).toContain('<b>');
      expect(result?.cells[0][0].blocks[0].data.text).toContain('<mark');
      expect(result?.cells[0][1].color).toBeUndefined();
    });

    it('does not create <mark> for transparent background-color in cell spans (realistic Google Docs)', () => {
      const html = `<table><tbody>
        <tr><td><p><span style="font-size:11pt;font-family:Arial,sans-serif;color:#000000;background-color:transparent;font-weight:400;">plain text</span></p></td></tr>
      </tbody></table>`;
      const result = parseGenericHtmlTable(html);

      expect(result?.cells[0][0].blocks[0].data.text).toBe('plain text');
      expect(result?.cells[0][0].blocks[0].data.text).not.toContain('<mark');
    });

    it('does not create <mark> for hex default black in cell spans (realistic Google Docs)', () => {
      const html = `<table><tbody>
        <tr><td><p><span style="font-size:11pt;color:#000000;background-color:transparent;font-weight:700;">bold only</span></p></td></tr>
      </tbody></table>`;
      const result = parseGenericHtmlTable(html);

      expect(result?.cells[0][0].blocks[0].data.text).toBe('<b>bold only</b>');
      expect(result?.cells[0][0].blocks[0].data.text).not.toContain('<mark');
    });

    it('creates <mark> for actual highlight in cell spans (realistic Google Docs)', () => {
      const html = `<table><tbody>
        <tr><td><p><span style="font-size:11pt;color:#000000;background-color:#ffff00;font-weight:400;">highlighted</span></p></td></tr>
      </tbody></table>`;
      const result = parseGenericHtmlTable(html);

      expect(result?.cells[0][0].blocks[0].data.text).toContain('<mark');
      expect(result?.cells[0][0].blocks[0].data.text).toContain('background-color');
      expect(result?.cells[0][0].blocks[0].data.text).not.toMatch(/[^-]color:\s*#000000/);
    });

    it('adds background-color:transparent for text-color-only mark in cell to prevent browser default yellow', () => {
      const html = `<table><tbody>
        <tr><td><p><span style="font-size:11pt;color:#666666;background-color:transparent;font-weight:400;">gray text</span></p></td></tr>
      </tbody></table>`;
      const result = parseGenericHtmlTable(html);

      const text = result?.cells[0][0].blocks[0].data.text ?? '';

      expect(text).toContain('<mark');
      expect(text).toContain('color: #787774');
      expect(text).toContain('background-color: transparent');
    });

    // -------------------------------------------------------------------------
    // Google Docs color mapping — maps arbitrary colors to Blok presets
    // -------------------------------------------------------------------------

    it('maps span text color to Blok preset in sanitizeCellHtml', () => {
      const html = '<table><tr><td><span style="color:#ff0000">red</span></td></tr></table>';
      const result = parseGenericHtmlTable(html);

      expect(result).not.toBeNull();
      expect(result?.cells[0][0].blocks[0].data.text).toContain(
        '<mark style="color: #d44c47; background-color: transparent;">red</mark>'
      );
    });

    it('maps span background color to Blok preset in sanitizeCellHtml', () => {
      const html = '<table><tr><td><span style="background-color:#ffff00">yellow</span></td></tr></table>';
      const result = parseGenericHtmlTable(html);

      expect(result).not.toBeNull();
      expect(result?.cells[0][0].blocks[0].data.text).toContain(
        '<mark style="background-color: #fbf3db;">yellow</mark>'
      );
    });

    it('maps cell-level background color to Blok preset', () => {
      const html = '<table><tr><td style="background-color:#ff0000">red cell</td></tr></table>';
      const result = parseGenericHtmlTable(html);

      expect(result).not.toBeNull();
      expect(result?.cells[0][0].color).toBe('#fdebec');
    });

    it('maps cell-level rgb() background color to Blok preset', () => {
      const html = '<table><tr><td style="background-color:rgb(255, 255, 0)">yellow cell</td></tr></table>';
      const result = parseGenericHtmlTable(html);

      expect(result).not.toBeNull();
      expect(result?.cells[0][0].color).toBe('#fbf3db');
    });

    it('preserves background-color on <a> tag inside table cell', () => {
      const html = '<table><tr><td><a href="https://example.com" style="background-color:#fce5cd;">Link text</a></td></tr></table>';
      const result = parseGenericHtmlTable(html);

      expect(result).not.toBeNull();
      const text = result?.cells[0][0].blocks[0].data.text ?? '';

      expect(text).toContain('<mark');
      expect(text).toContain('background-color:');
      expect(text).toContain('Link text');
    });

    it('does not create inner mark for anchor with only color:inherit in table cell', () => {
      const html = '<table><tr><td><span style="color:#1155cc;background-color:#a64d79;"><a href="https://example.com" style="color:inherit;">Link text</a></span></td></tr></table>';
      const result = parseGenericHtmlTable(html);

      expect(result).not.toBeNull();
      const rawText = result?.cells[0][0].blocks[0].data.text;
      const text = typeof rawText === 'string' ? rawText : '';
      const markCount = (text.match(/<mark/g) || []).length;

      expect(markCount).toBe(1);
    });

    // -------------------------------------------------------------------------
    // Bug #7: parseGenericHtmlTable ignores <td> text color
    // -------------------------------------------------------------------------

    it('should extract cell text color from td style as cell textColor', () => {
      const html = '<table><tr><td style="color: rgb(255, 0, 0)">red text cell</td></tr></table>';
      const result = parseGenericHtmlTable(html);

      expect(result).not.toBeNull();
      expect(result?.cells[0][0].textColor).toBe('#d44c47');
      expect(result?.cells[0][0].blocks[0].data.text).toBe('red text cell');
    });

    it('should extract both color and background-color from td style', () => {
      const html = '<table><tr><td style="color: rgb(255, 0, 0); background-color: rgb(255, 255, 0)">red on yellow</td></tr></table>';
      const result = parseGenericHtmlTable(html);

      expect(result).not.toBeNull();
      expect(result?.cells[0][0].textColor).toBe('#d44c47');
      expect(result?.cells[0][0].color).toBe('#fbf3db');
    });

    it('should not set textColor when td has no color style', () => {
      const html = '<table><tr><td>plain cell</td></tr></table>';
      const result = parseGenericHtmlTable(html);

      expect(result?.cells[0][0].textColor).toBeUndefined();
    });

    it('should extract text color from th style as cell textColor', () => {
      const html = '<table><tr><th style="color: rgb(0, 0, 255)">blue header</th></tr></table>';
      const result = parseGenericHtmlTable(html);

      expect(result?.cells[0][0].textColor).toBe('#337ea9');
    });

    // -------------------------------------------------------------------------
    // Bug #3: default black text color on <td> should be ignored
    // -------------------------------------------------------------------------

    it('should not set textColor when td has default black rgb(0, 0, 0)', () => {
      const html = '<table><tr><td style="color: rgb(0, 0, 0)">normal text</td></tr></table>';
      const result = parseGenericHtmlTable(html);

      expect(result?.cells[0][0].textColor).toBeUndefined();
    });

    it('should not set textColor when td has default black #000000', () => {
      const html = '<table><tr><td style="color: #000000">normal text</td></tr></table>';
      const result = parseGenericHtmlTable(html);

      expect(result?.cells[0][0].textColor).toBeUndefined();
    });

    it('should not set textColor when td has black with extra spaces rgb(0,0,0)', () => {
      const html = '<table><tr><td style="color: rgb(0,0,0)">normal text</td></tr></table>';
      const result = parseGenericHtmlTable(html);

      expect(result?.cells[0][0].textColor).toBeUndefined();
    });

    it('should still extract non-black text color from td alongside default-black filtering', () => {
      const html = `<table><tr>
        <td style="color: rgb(0, 0, 0)">black text</td>
        <td style="color: rgb(255, 0, 0)">red text</td>
      </tr></table>`;
      const result = parseGenericHtmlTable(html);

      expect(result?.cells[0][0].textColor).toBeUndefined();
      expect(result?.cells[0][1].textColor).toBe('#d44c47');
    });
  });

  // ---------------------------------------------------------------------------
  // Bug #13: buildClipboardHtml omits colors from <td> elements
  // ---------------------------------------------------------------------------
  describe('buildClipboardHtml — cell color styles', () => {
    it('should include background-color style on td when cell has color', () => {
      const payload: TableCellsClipboard = {
        rows: 1,
        cols: 1,
        cells: [[{ blocks: [{ tool: 'paragraph', data: { text: 'colored' } }], color: '#fbecdd' }]],
      };

      const html = buildClipboardHtml(payload);

      expect(html).toContain('<td style="');
      expect(html).toContain('background-color: #fbecdd');
    });

    it('should include color style on td when cell has textColor', () => {
      const payload: TableCellsClipboard = {
        rows: 1,
        cols: 1,
        cells: [[{ blocks: [{ tool: 'paragraph', data: { text: 'colored' } }], textColor: '#d44c47' }]],
      };

      const html = buildClipboardHtml(payload);

      expect(html).toContain('<td style="');
      expect(html).toContain('color: #d44c47');
    });

    it('should include both color and background-color on td when both are present', () => {
      const payload: TableCellsClipboard = {
        rows: 1,
        cols: 1,
        cells: [[{
          blocks: [{ tool: 'paragraph', data: { text: 'both' } }],
          color: '#fbf3db',
          textColor: '#d44c47',
        }]],
      };

      const html = buildClipboardHtml(payload);

      expect(html).toContain('background-color: #fbf3db');
      expect(html).toContain('color: #d44c47');
    });

    it('should not add style attribute on td when cell has no colors', () => {
      const payload: TableCellsClipboard = {
        rows: 1,
        cols: 1,
        cells: [[{ blocks: [{ tool: 'paragraph', data: { text: 'plain' } }] }]],
      };

      const html = buildClipboardHtml(payload);

      expect(html).toContain('<td>plain</td>');
    });
  });
});
