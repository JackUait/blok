import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import '../helpers/domShims';
import { renderTable } from '../../../../../../src/tools/file/pptx/renderer/TableRenderer';
import type { TableNodeData } from '../../../../../../src/tools/file/pptx/model/nodes/TableNode';
import { SafeXmlNode } from '../../../../../../src/tools/file/pptx/parser/XmlParser';
import { createMockRenderContext } from '../helpers/mockContext';

const grid = (rows: number, cols: number): TableNodeData => ({
  id: '5',
  name: 'Table',
  nodeType: 'table',
  position: { x: 10, y: 20 },
  size: { w: 600, h: 400 },
  rotation: 30,
  flipH: false,
  flipV: false,
  source: new SafeXmlNode(null),
  columns: Array.from({ length: cols }, () => 10),
  rows: Array.from({ length: rows }, () => ({
    height: 5,
    cells: Array.from({ length: cols }, () => ({ gridSpan: 1, rowSpan: 1, hMerge: false, vMerge: false })),
  })),
});

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

  it('still draws every cell of a table at the limit', () => {
    const el = renderTable(grid(2000, 5), createMockRenderContext());

    expect(el.querySelectorAll('td')).toHaveLength(10_000);
  });
});
