import { describe, it, expect, beforeEach } from 'vitest';
import * as Y from 'yjs';
import { YBlockSerializer, isBoundaryCharacter, BOUNDARY_CHARACTERS } from '../../../../../src/components/modules/yjs/serializer';

describe('YBlockSerializer', () => {
  let ydoc: Y.Doc;
  let serializer: YBlockSerializer;

  beforeEach(() => {
    ydoc = new Y.Doc();
    serializer = new YBlockSerializer();
  });

  describe('outputDataToYBlock and yBlockToOutputData round-trip', () => {
    it('maintains data integrity through conversion cycle when using Y.Doc', () => {
      const yblocks = ydoc.getArray('test');

      const original = {
        id: 'b1',
        type: 'paragraph',
        data: { text: 'Hello world', bold: true },
        tunes: { alignment: 'center' },
      };

      const yblock = serializer.outputDataToYBlock(original);
      yblocks.push([yblock]);

      const converted = serializer.yBlockToOutputData(yblocks.get(0) as Y.Map<unknown>);

      expect(converted).toEqual(original);
    });

    it('handles nested data structures', () => {
      const yblocks = ydoc.getArray('test');

      const original = {
        id: 'b1',
        type: 'paragraph',
        data: {
          text: 'Hello',
          nested: { a: 1, b: { c: 2 } },
        },
      };

      const yblock = serializer.outputDataToYBlock(original);
      yblocks.push([yblock]);

      const converted = serializer.yBlockToOutputData(yblocks.get(0) as Y.Map<unknown>);

      expect(converted.data).toEqual(original.data);
    });

    it('includes tunes when present', () => {
      const yblocks = ydoc.getArray('test');

      const yblock = serializer.outputDataToYBlock({
        id: 'b1',
        type: 'paragraph',
        data: { text: 'Hello' },
        tunes: { alignment: 'center' },
      });

      yblocks.push([yblock]);
      const data = serializer.yBlockToOutputData(yblocks.get(0) as Y.Map<unknown>);

      expect(data.tunes).toEqual({ alignment: 'center' });
    });

    it('includes parentId when present', () => {
      const yblocks = ydoc.getArray('test');

      const yblock = serializer.outputDataToYBlock({
        id: 'b1',
        type: 'paragraph',
        data: { text: 'Hello' },
        parent: 'b0',
      });

      yblocks.push([yblock]);
      const data = serializer.yBlockToOutputData(yblocks.get(0) as Y.Map<unknown>);

      expect(data.parent).toBe('b0');
    });

    it('includes content when present', () => {
      const yblocks = ydoc.getArray('test');

      const yblock = serializer.outputDataToYBlock({
        id: 'b1',
        type: 'list',
        data: { style: 'ordered' },
        content: ['b2', 'b3'],
      });

      yblocks.push([yblock]);
      const data = serializer.yBlockToOutputData(yblocks.get(0) as Y.Map<unknown>);

      expect(data.content).toEqual(['b2', 'b3']);
    });

    it('normalizes empty paragraph data to { text: "" }', () => {
      const yblocks = ydoc.getArray('test');

      const yblock = serializer.outputDataToYBlock({
        id: 'b1',
        type: 'paragraph',
        data: {},
      });

      yblocks.push([yblock]);
      const data = serializer.yBlockToOutputData(yblocks.get(0) as Y.Map<unknown>);

      expect(data.data).toEqual({ text: '' });
    });

    it('does not normalize non-paragraph blocks with empty data', () => {
      const yblocks = ydoc.getArray('test');

      const yblock = serializer.outputDataToYBlock({
        id: 'b1',
        type: 'header',
        data: {},
      });

      yblocks.push([yblock]);
      const data = serializer.yBlockToOutputData(yblocks.get(0) as Y.Map<unknown>);

      expect(data.data).toEqual({});
    });

    it('throws when id is not a string', () => {
      const yblocks = ydoc.getArray('test');

      const yblock = serializer.outputDataToYBlock({
        id: 'b1',
        type: 'paragraph',
        data: { text: 'Hello' },
      });

      yblock.set('id', 123 as unknown as string);
      yblocks.push([yblock]);

      expect(() =>
        serializer.yBlockToOutputData(yblocks.get(0) as Y.Map<unknown>)
      ).toThrow('Block id must be a string');
    });

    it('throws when type is not a string', () => {
      const yblocks = ydoc.getArray('test');

      const yblock = serializer.outputDataToYBlock({
        id: 'b1',
        type: 'paragraph',
        data: { text: 'Hello' },
      });

      yblock.set('type', 123 as unknown as string);
      yblocks.push([yblock]);

      expect(() =>
        serializer.yBlockToOutputData(yblocks.get(0) as Y.Map<unknown>)
      ).toThrow('Block type must be a string');
    });

    it('throws when data is not a Y.Map', () => {
      const yblocks = ydoc.getArray('test');

      const yblock = serializer.outputDataToYBlock({
        id: 'b1',
        type: 'paragraph',
        data: { text: 'Hello' },
      });

      yblock.set('data', 'not a map' as unknown as Y.Map<unknown>);
      yblocks.push([yblock]);

      expect(() =>
        serializer.yBlockToOutputData(yblocks.get(0) as Y.Map<unknown>)
      ).toThrow('Block data must be a Y.Map');
    });
  });

  describe('edit metadata serialization', () => {
    it('should serialize lastEditedAt and lastEditedBy to Y.Map', () => {
      const yblocks = ydoc.getArray('test');

      const blockData = {
        id: 'test-1',
        type: 'paragraph',
        data: { text: 'Hello' },
        lastEditedAt: 1712880000000,
        lastEditedBy: 'Jack Uait',
      };

      const yblock = serializer.outputDataToYBlock(blockData);
      yblocks.push([yblock]);

      const stored = yblocks.get(0) as Y.Map<unknown>;

      expect(stored.get('lastEditedAt')).toBe(1712880000000);
      expect(stored.get('lastEditedBy')).toBe('Jack Uait');
    });

    it('should omit metadata fields from Y.Map when not present', () => {
      const blockData = {
        id: 'test-2',
        type: 'paragraph',
        data: { text: 'Hello' },
      };

      const yblock = serializer.outputDataToYBlock(blockData);

      expect(yblock.has('lastEditedAt')).toBe(false);
      expect(yblock.has('lastEditedBy')).toBe(false);
    });

    it('should deserialize lastEditedAt and lastEditedBy from Y.Map', () => {
      const yblocks = ydoc.getArray('test');

      const blockData = {
        id: 'test-3',
        type: 'paragraph',
        data: { text: 'Hello' },
        lastEditedAt: 1712880000000,
        lastEditedBy: 'Jack Uait',
      };

      const yblock = serializer.outputDataToYBlock(blockData);
      yblocks.push([yblock]);

      const output = serializer.yBlockToOutputData(yblocks.get(0) as Y.Map<unknown>);

      expect(output.lastEditedAt).toBe(1712880000000);
      expect(output.lastEditedBy).toBe('Jack Uait');
    });

    it('should return output without metadata for legacy blocks', () => {
      const yblocks = ydoc.getArray('test');

      const blockData = {
        id: 'test-4',
        type: 'paragraph',
        data: { text: 'Hello' },
      };

      const yblock = serializer.outputDataToYBlock(blockData);
      yblocks.push([yblock]);

      const output = serializer.yBlockToOutputData(yblocks.get(0) as Y.Map<unknown>);

      expect(output.lastEditedAt).toBeUndefined();
      expect(output.lastEditedBy).toBeUndefined();
    });
  });

  describe('array conversion rule', () => {
    const getData = (data: Record<string, unknown>): Y.Map<unknown> => {
      const yblocks = ydoc.getArray('test');
      const yblock = serializer.outputDataToYBlock({ id: 'b1', type: 'table', data });

      yblocks.push([yblock]);

      return (yblocks.get(0) as Y.Map<unknown>).get('data') as Y.Map<unknown>;
    };

    it('converts a non-empty array of plain objects to a Y.Array of Y.Maps', () => {
      const ydata = getData({ rows: [{ a: 1 }, { b: 2 }] });
      const rows = ydata.get('rows');

      expect(rows instanceof Y.Array).toBe(true);
      expect((rows as Y.Array<unknown>).get(0) instanceof Y.Map).toBe(true);
      expect((rows as Y.Array<unknown>).get(1) instanceof Y.Map).toBe(true);
    });

    it('converts a table-shaped grid to keyed rows → Y.Array(cells) → Y.Map(cell fields) with plain blocks arrays', () => {
      const ydata = getData({
        content: [
          [{ blocks: ['p1'] }, { blocks: ['p2'] }],
          [{ blocks: ['p3'] }, { blocks: [] }],
        ],
      });
      const content = ydata.get('content');

      // Rows are keyed, not positional: Y.Array has no move, so a positional
      // rows array cannot express a reorder without recreating a row.
      expect(serializer.isGridMap(content)).toBe(true);

      const grid = content as Y.Map<unknown>;
      const keys = serializer.gridRowKeys(grid);

      expect(keys).toHaveLength(2);
      expect(new Set(keys).size).toBe(2);

      const row0 = (grid.get('__rows') as Y.Map<unknown>).get(keys[0]) as Y.Array<unknown>;

      expect(row0 instanceof Y.Array).toBe(true);

      const cell0 = row0.get(0) as Y.Map<unknown>;

      expect(cell0 instanceof Y.Map).toBe(true);

      // cell.blocks is a primitive string array — stays a plain atomic leaf
      const blocks = cell0.get('blocks');

      expect(Array.isArray(blocks)).toBe(true);
      expect(blocks).toEqual(['p1']);
    });

    it('keeps primitive arrays atomic (plain arrays, not Y.Arrays)', () => {
      const ydata = getData({ colWidths: [100, 200, 150], tags: ['a', 'b'] });

      expect(Array.isArray(ydata.get('colWidths'))).toBe(true);
      expect(Array.isArray(ydata.get('tags'))).toBe(true);
    });

    it('keeps empty arrays atomic (representation-flip hole stays closed)', () => {
      const ydata = getData({ content: [] });

      expect(Array.isArray(ydata.get('content'))).toBe(true);
      expect(ydata.get('content')).toEqual([]);
    });

    it('keeps mixed object/primitive arrays atomic', () => {
      const ydata = getData({ mixed: [{ a: 1 }, 'str'] });

      expect(Array.isArray(ydata.get('mixed'))).toBe(true);
    });

    it('keeps arrays containing null atomic', () => {
      const ydata = getData({ withNull: [null] });

      expect(Array.isArray(ydata.get('withNull'))).toBe(true);
    });

    it('keeps an empty-row element plain inside a converted grid', () => {
      const ydata = getData({ content: [[{ blocks: ['p1'] }], []] });
      const content = ydata.get('content') as Y.Map<unknown>;

      expect(serializer.isGridMap(content)).toBe(true);

      // An empty row is still a KEYED row — its cells are a plain atomic leaf,
      // so deleting the last column never flips the grid representation.
      const keys = serializer.gridRowKeys(content);
      const rows = content.get('__rows') as Y.Map<unknown>;

      expect(rows.get(keys[0]) instanceof Y.Array).toBe(true);
      expect(Array.isArray(rows.get(keys[1]))).toBe(true);
    });

    it('round-trips table-shaped content byte-equal', () => {
      const yblocks = ydoc.getArray('test');
      const original = {
        id: 't1',
        type: 'table',
        data: {
          withHeadings: true,
          colWidths: [120, 240],
          content: [
            [{ blocks: ['p1', 'p2'], colspan: 2 }, { blocks: [], mergedInto: [0, 0] }],
            [{ blocks: ['p3'], color: 'red' }, { blocks: ['p4'] }],
            [{ blocks: [] }, { blocks: ['p5'] }],
          ],
        },
      };

      yblocks.push([serializer.outputDataToYBlock(original)]);

      const converted = serializer.yBlockToOutputData(yblocks.get(0) as Y.Map<unknown>);

      expect(converted).toEqual(original);
    });

    it('round-trips database schema and views byte-equal', () => {
      const yblocks = ydoc.getArray('test');
      const original = {
        id: 'db1',
        type: 'database',
        data: {
          schema: [
            { id: 'p-title', name: 'Name', type: 'title', position: 'a0' },
            {
              id: 'p-status',
              name: 'Status',
              type: 'select',
              position: 'a1',
              config: { options: [{ id: 'o1', label: 'Todo', color: 'gray' }] },
            },
          ],
          views: [
            { id: 'v1', name: 'All', type: 'table', position: 'a0', sorts: [], filters: [], visibleProperties: ['p-title'] },
            {
              id: 'v2',
              name: 'Board',
              type: 'board',
              position: 'a1',
              groupBy: 'p-status',
              sorts: [{ propertyId: 'p-status', direction: 'asc' }],
              filters: [],
              visibleProperties: [],
            },
          ],
          activeViewId: 'v1',
        },
      };

      yblocks.push([serializer.outputDataToYBlock(original)]);

      const converted = serializer.yBlockToOutputData(yblocks.get(0) as Y.Map<unknown>);

      expect(converted).toEqual(original);
    });

    it('round-trips deep nesting of arrays inside objects inside arrays', () => {
      const yblocks = ydoc.getArray('test');
      const original = {
        id: 'deep1',
        type: 'custom',
        data: {
          groups: [
            { name: 'g1', items: [{ v: 1 }, { v: 2 }], empty: [], prims: [1, 2, 3] },
            { name: 'g2', items: [{ v: 3, sub: { deep: [{ x: 'y' }] } }] },
          ],
        },
      };

      yblocks.push([serializer.outputDataToYBlock(original)]);

      const converted = serializer.yBlockToOutputData(yblocks.get(0) as Y.Map<unknown>);

      expect(converted).toEqual(original);
    });
  });

  describe('isBoundaryCharacter', () => {
    it('returns true for boundary characters', () => {
      expect(isBoundaryCharacter(' ')).toBe(true);
      expect(isBoundaryCharacter('\t')).toBe(true);
      expect(isBoundaryCharacter('.')).toBe(true);
      expect(isBoundaryCharacter('?')).toBe(true);
      expect(isBoundaryCharacter('!')).toBe(true);
      expect(isBoundaryCharacter(',')).toBe(true);
      expect(isBoundaryCharacter(';')).toBe(true);
      expect(isBoundaryCharacter(':')).toBe(true);
    });

    it('returns false for non-boundary characters', () => {
      expect(isBoundaryCharacter('a')).toBe(false);
      expect(isBoundaryCharacter('Z')).toBe(false);
      expect(isBoundaryCharacter('1')).toBe(false);
      expect(isBoundaryCharacter('-')).toBe(false);
      expect(isBoundaryCharacter('@')).toBe(false);
    });
  });

  describe('BOUNDARY_CHARACTERS constant', () => {
    it('contains all expected boundary characters', () => {
      expect(BOUNDARY_CHARACTERS.size).toBe(8);
      expect(BOUNDARY_CHARACTERS.has(' ')).toBe(true);
      expect(BOUNDARY_CHARACTERS.has('\t')).toBe(true);
      expect(BOUNDARY_CHARACTERS.has('.')).toBe(true);
      expect(BOUNDARY_CHARACTERS.has('?')).toBe(true);
      expect(BOUNDARY_CHARACTERS.has('!')).toBe(true);
      expect(BOUNDARY_CHARACTERS.has(',')).toBe(true);
      expect(BOUNDARY_CHARACTERS.has(';')).toBe(true);
      expect(BOUNDARY_CHARACTERS.has(':')).toBe(true);
    });
  });
});
