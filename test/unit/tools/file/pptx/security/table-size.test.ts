import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import '../helpers/domShims';
import { renderTable } from '../../../../../../src/tools/file/pptx/renderer/TableRenderer';
import { parseTableNode, type TableNodeData } from '../../../../../../src/tools/file/pptx/model/nodes/TableNode';
import { SafeXmlNode } from '../../../../../../src/tools/file/pptx/parser/XmlParser';
import { createMockRenderContext } from '../helpers/mockContext';
import { xmlNode } from '../helpers/xmlNode';

const plainCell = { gridSpan: 1, rowSpan: 1, hMerge: false, vMerge: false };

const table = (columns: number, rowCells: number[]): TableNodeData => ({
  id: '5',
  name: 'Table',
  nodeType: 'table',
  position: { x: 10, y: 20 },
  size: { w: 600, h: 400 },
  rotation: 30,
  flipH: false,
  flipV: false,
  source: new SafeXmlNode(null),
  columns: Array.from({ length: columns }, () => 10),
  rows: rowCells.map((count) => ({ height: 5, cells: Array.from({ length: count }, () => ({ ...plainCell })) })),
});

const grid = (rows: number, cols: number): TableNodeData => table(cols, Array.from({ length: rows }, () => cols));

const frameXml = (gridCols: number, rowCells: number[]): string => {
  // Empty cells keep jsdom's XML parse fast; the count is what matters.
  const rows = rowCells.map((count) => `<tr h="100">${'<tc/>'.repeat(count)}</tr>`).join('');

  return '<graphicFrame><xfrm><off x="0" y="0"/><ext cx="9144000" cy="6858000"/></xfrm>'
    + `<graphic><graphicData><tbl><tblPr/><tblGrid>${'<gridCol w="100"/>'.repeat(gridCols)}</tblGrid>${rows}</tbl></graphicData></graphic></graphicFrame>`;
};

const cellCount = (node: TableNodeData): number => node.rows.reduce((sum, row) => sum + row.cells.length, 0);

describe('a pptx table with more cells than a slide can sensibly show', () => {
  beforeEach(() => { vi.clearAllMocks(); });
  afterEach(() => { vi.restoreAllMocks(); });

  it('keeps an empty frame in place instead of building tens of thousands of cells', () => {
    const el = renderTable(grid(2001, 5), createMockRenderContext());

    expect(el.querySelectorAll('td')).toHaveLength(0);
    expect(el.style.left).toBe('10px');
    expect(el.style.top).toBe('20px');
    expect(el.style.width).toBe('600px');
    expect(el.style.height).toBe('400px');
    expect(el.style.transform).toBe('rotate(30deg)');
  });

  it('keeps the frame empty when rows carry far more cells than the grid declares', () => {
    const el = renderTable(table(1, [10_001]), createMockRenderContext());

    expect(el.querySelectorAll('td')).toHaveLength(0);
  });

  it('does not parse the cells of an oversized table at all', () => {
    const node = parseTableNode(xmlNode(frameXml(5, Array.from({ length: 2001 }, () => 5))));

    expect(cellCount(node)).toBe(0);
    expect(renderTable(node, createMockRenderContext()).querySelectorAll('td')).toHaveLength(0);
  });

  it('does not parse the cells of a one-column grid whose rows hold far more cells', () => {
    // 101 rows of 100 cells: the grid alone claims only 101 cells.
    const node = parseTableNode(xmlNode(frameXml(1, Array.from({ length: 101 }, () => 100))));

    expect(cellCount(node)).toBe(0);
  });

  it('does not build a column for every grid column of a table with no rows', () => {
    const el = renderTable(table(10_001, []), createMockRenderContext());

    expect(el.querySelectorAll('col')).toHaveLength(0);
  });

  it('does not build a row for every empty row of a table', () => {
    const el = renderTable(table(0, Array.from({ length: 10_001 }, () => 0)), createMockRenderContext());

    expect(el.querySelectorAll('tr')).toHaveLength(0);
  });

  it('marks a parsed table with a huge grid and no rows as oversized', () => {
    const node = parseTableNode(xmlNode(frameXml(10_001, [])));

    expect(node.oversized).toBe(true);
  });

  it('marks a parsed table with a huge number of empty rows as oversized', () => {
    const node = parseTableNode(xmlNode(frameXml(0, Array.from({ length: 10_001 }, () => 0))));

    expect(node.oversized).toBe(true);
    expect(node.rows).toHaveLength(0);
  });

  it('still draws a grid or a row count at the limit', () => {
    expect(renderTable(table(10_000, []), createMockRenderContext()).querySelectorAll('col')).toHaveLength(10_000);
    expect(renderTable(table(0, Array.from({ length: 10_000 }, () => 0)), createMockRenderContext()).querySelectorAll('tr')).toHaveLength(10_000);
  });

  it('still draws every cell of a table at the limit', () => {
    const el = renderTable(grid(2000, 5), createMockRenderContext());

    expect(el.querySelectorAll('td')).toHaveLength(10_000);
  });

  it('still parses every cell of a table at the limit', () => {
    const node = parseTableNode(xmlNode(frameXml(5, [5, 5])));

    expect(cellCount(node)).toBe(10);
    expect(node.size).toEqual({ w: expect.any(Number), h: expect.any(Number) });
  });
});

describe('a pptx table cell that claims a huge span', () => {
  beforeEach(() => { vi.clearAllMocks(); });
  afterEach(() => { vi.restoreAllMocks(); });

  it('spans no further than the columns and rows left in the table', () => {
    const node = grid(3, 3);
    node.rows[1].cells[1] = { ...plainCell, gridSpan: 1000, rowSpan: 65_534 };

    const td = renderTable(node, createMockRenderContext()).querySelectorAll('tr')[1].querySelectorAll('td')[1];

    expect(td.colSpan).toBe(2);
    expect(td.rowSpan).toBe(2);
  });

  it('keeps a span when the table has no grid, as long as it fits the widest row', () => {
    // No tblGrid: row 0 holds three cells, row 1 one cell spanning all three.
    const node = table(0, [3, 1]);
    node.rows[1].cells[0] = { ...plainCell, gridSpan: 3 };

    const td = renderTable(node, createMockRenderContext()).querySelectorAll('tr')[1].querySelector('td');

    expect(td?.colSpan).toBe(3);
  });

  it('keeps an honest span as written', () => {
    const node = grid(3, 3);
    node.rows[0].cells[0] = { ...plainCell, gridSpan: 3, rowSpan: 3 };

    const td = renderTable(node, createMockRenderContext()).querySelector('td');

    expect(td?.colSpan).toBe(3);
    expect(td?.rowSpan).toBe(3);
  });
});
