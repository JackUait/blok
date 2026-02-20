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

    it('should convert paragraph boundaries to line breaks', () => {
      const html = '<table><tr><td><p>line one</p><p>line two</p></td></tr></table>';
      const result = parseGenericHtmlTable(html);

      expect(result?.cells[0][0].blocks[0].data.text).toBe('line one<br>line two');
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
  });
});
