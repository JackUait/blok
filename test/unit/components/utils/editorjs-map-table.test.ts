import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  analyzeDataFormat,
  expandToHierarchical,
  shouldExpandToHierarchical,
} from '../../../../src/components/utils/data-model-transform';
import type { OutputBlockData } from '../../../../types';
import type { CellContent } from '../../../../src/tools/table/types';

/**
 * Editor.js -> Blok migration verification for the @editorjs/table block type.
 *
 * These tests run the EXACT runtime migration pipeline (the same calls made on
 * data load with dataModel 'auto'):
 *
 *   const analysis = analyzeDataFormat(blocks)
 *   const out = shouldExpandToHierarchical('auto', analysis.format)
 *     ? expandToHierarchical(blocks)
 *     : blocks
 *
 * Nothing is mocked except silencing console.warn. The transform functions are
 * the real ones.
 *
 * THE DIVERGENCE
 * --------------
 * Editor.js @editorjs/table save() shape:
 *   { withHeadings: boolean, content: string[][] }   (+ `stretched` in newer
 *   versions). `content` is a 2D array where each cell is an HTML STRING, e.g.
 *   [["Name","Age"],["Alice","30"]].
 *
 * Blok's Table does NOT store cell text as HTML strings. Per the project's
 * "everything is a block" law, every table cell references CHILD BLOCKS by id:
 *   data.content[row][col] = { blocks: ["<blockId>", ...] }
 * and the cell's text lives in a separate child paragraph block whose
 * `parent === tableId`. See src/tools/table/types.ts (CellContent,
 * isCellWithBlocks). TableModel.normalizeCell turns any NON-block-ref cell into
 * `{ blocks: [] }` at the model layer — i.e. string text is dropped on the
 * first save/snapshot round-trip if it is not converted up front.
 *
 * The migration therefore MUST rewrite each string cell into a
 * { blocks: [childId] } cell-block-ref and mint a child paragraph block (with
 * `parent === tableId`) carrying the cell text. These tests assert that
 * conformant shape.
 */

/**
 * The set of Blok-renderable block types (keys of defaultBlockTools in
 * src/tools/index.ts plus the `delimiter` alias). A block whose `.type` is not
 * in this set renders as a stub.
 */
const RENDERABLE_TYPES = new Set([
  'paragraph',
  'header',
  'list',
  'table',
  'toggle',
  'callout',
  'database',
  'database-row',
  'divider',
  'quote',
  'code',
  'image',
  'column_list',
  'column',
  'embed',
  'bookmark',
  'delimiter',
]);

/**
 * Mirror the runtime load path exactly.
 *
 * @param blocks - editor.js output blocks to migrate
 * @returns blocks after the auto data-model transform
 */
const runMigration = (blocks: OutputBlockData[]): OutputBlockData[] => {
  const analysis = analyzeDataFormat(blocks);

  return shouldExpandToHierarchical('auto', analysis.format)
    ? expandToHierarchical(blocks)
    : blocks;
};

const isCellBlockRef = (cell: unknown): cell is CellContent =>
  typeof cell === 'object' &&
  cell !== null &&
  Array.isArray((cell as { blocks?: unknown }).blocks);

/**
 * A realistic @editorjs/table export: 2 columns, header row, plain-string cells.
 */
const editorjsTable: OutputBlockData = {
  id: 'table-1',
  type: 'table',
  data: {
    withHeadings: true,
    content: [
      ['Name', 'Age'],
      ['Alice', '30'],
    ],
  },
};

describe('editorjs map: table (@editorjs/table)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('classifies an editor.js string-cell table as legacy -> transform runs', () => {
    const blocks = [{ ...editorjsTable }];
    const analysis = analyzeDataFormat(blocks);

    // A table whose cells are plain strings is NOT Blok-native; it must be
    // detected as legacy so the expand step rewrites it.
    expect(analysis.format).toBe('legacy');
    expect(shouldExpandToHierarchical('auto', analysis.format)).toBe(true);
  });

  it('keeps the table block renderable and preserves withHeadings + dimensions', () => {
    const out = runMigration([{ ...editorjsTable }]);
    const table = out.find(b => b.type === 'table');

    expect(table).toBeDefined();
    expect(table?.id).toBe('table-1');
    expect(RENDERABLE_TYPES.has(table?.type ?? '')).toBe(true);

    const data = table?.data as Record<string, unknown>;

    expect(data.withHeadings).toBe(true);

    const content = data.content as unknown[][];

    expect(content).toHaveLength(2);
    expect(content[0]).toHaveLength(2);
  });

  it('rewrites every non-empty string cell into a Blok { blocks: [childId] } cell-block-ref', () => {
    const out = runMigration([{ ...editorjsTable }]);
    const table = out.find(b => b.type === 'table');
    const content = (table?.data as Record<string, unknown>).content as unknown[][];

    for (const row of content) {
      for (const cell of row) {
        expect(isCellBlockRef(cell)).toBe(true);
        // every cell in this fixture is non-empty -> exactly one child ref
        expect((cell as CellContent).blocks).toHaveLength(1);
      }
    }
  });

  it('mints one child paragraph per non-empty cell, parented to the table, holding the cell text', () => {
    const out = runMigration([{ ...editorjsTable }]);
    const children = out.filter(b => b.type === 'paragraph' && b.parent === 'table-1');

    expect(children).toHaveLength(4);

    const texts = children.map(b => (b.data as { text: string }).text).sort();

    expect(texts).toEqual(['30', 'Age', 'Alice', 'Name']);

    // Every minted child must be referenced by exactly one table cell.
    const table = out.find(b => b.type === 'table');
    const content = (table?.data as Record<string, unknown>).content as CellContent[][];
    const referenced = content.flat().flatMap(cell => cell.blocks);

    for (const child of children) {
      expect(referenced).toContain(child.id);
    }
  });

  it('emits empty cells as { blocks: [] } with no child paragraph', () => {
    const tableWithEmpty: OutputBlockData = {
      id: 'table-2',
      type: 'table',
      data: {
        withHeadings: false,
        content: [
          ['A', ''],
          ['', 'D'],
        ],
      },
    };

    const out = runMigration([tableWithEmpty]);
    const table = out.find(b => b.type === 'table');
    const content = (table?.data as Record<string, unknown>).content as CellContent[][];

    expect(content[0][1].blocks).toEqual([]);
    expect(content[1][0].blocks).toEqual([]);

    const children = out.filter(b => b.type === 'paragraph' && b.parent === 'table-2');

    // Only the two non-empty cells (A, D) get child paragraphs.
    expect(children).toHaveLength(2);
    expect(children.map(b => (b.data as { text: string }).text).sort()).toEqual(['A', 'D']);
  });

  it('leaves an already-Blok-native table (cell-block-ref cells) untouched', () => {
    const native: OutputBlockData = {
      id: 'table-3',
      type: 'table',
      data: {
        withHeadings: false,
        content: [[{ blocks: ['x'] }, { blocks: [] }]],
      },
    };

    // No string cells -> not a legacy table -> classified flat -> no transform.
    const analysis = analyzeDataFormat([native]);

    expect(analysis.format).toBe('flat');
    expect(shouldExpandToHierarchical('auto', analysis.format)).toBe(false);
  });

  it('every emitted block has a non-empty id', () => {
    const out = runMigration([{ ...editorjsTable }]);

    for (const block of out) {
      expect(typeof block.id).toBe('string');
      expect((block.id ?? '').length).toBeGreaterThan(0);
    }
  });
});
