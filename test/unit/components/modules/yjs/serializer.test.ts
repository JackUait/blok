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
