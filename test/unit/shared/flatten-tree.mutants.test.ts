import { describe, it, expect } from 'vitest';

import { flattenTree } from '../../../src/shared/flatten-tree';
import type { BlockTreeNode } from '../../../types/data-formats/block-tree';
import type { LooseOutputBlockData } from '../../../types/data-formats/output-data';

/**
 * A tree node carrying flat-block fields, or a saved block carrying a field of
 * the wrong type. Both are shapes the type system forbids and the wire produces
 * anyway — which is exactly what these guards exist for.
 */
const offSpec = (shape: Record<string, unknown>): BlockTreeNode => shape;
const offSpecBlock = (shape: Record<string, unknown>): LooseOutputBlockData =>
  shape as unknown as LooseOutputBlockData;

const ids = (): (() => string) => {
  let next = 0;

  return () => {
    next += 1;

    return `gen-${next}`;
  };
};

const flatten = (spec: BlockTreeNode | BlockTreeNode[]): ReturnType<typeof flattenTree> =>
  flattenTree(spec, { generateId: ids() });

describe('flattenTree mutants', () => {
  describe('reading an id off a saved block', () => {
    it('treats an empty id as absent', () => {
      const flat = flatten({ blocks: [{ id: '', type: 'paragraph' }] });

      expect(flat[0].id).toBe('gen-1');
    });

    // A number is the only value that is neither a string nor nullish, so it is
    // the only one that separates the type test from the emptiness test.
    it('treats an id that is not a string as absent', () => {
      const flat = flatten({ blocks: [offSpecBlock({ id: 42, type: 'paragraph' })] });

      expect(flat[0].id).toBe('gen-1');
    });
  });

  describe('refusing a pre-flat block passed as a tree node', () => {
    it('names the offending block when it carries a parent link', () => {
      expect(() => flatten(offSpec({ id: 'blk-1', type: 'paragraph', parent: 'p1' })))
        .toThrow(/blk-1/);
    });

    it('refuses a node that carries content links', () => {
      expect(() => flatten(offSpec({ id: 'blk-1', type: 'paragraph', content: ['c1'] })))
        .toThrow(/carries/);
    });

    it('calls an id-less node out by name', () => {
      expect(() => flatten(offSpec({ type: 'paragraph', parent: 'p1' })))
        .toThrow(/\(no id\)/);
    });

    // An empty parent and an empty content array are what a saved leaf looks
    // like, so neither may be read as a link.
    it('accepts a node whose parent and content are empty', () => {
      const flat = flatten(offSpec({ id: 'blk-1', type: 'paragraph', parent: '', content: [] }));

      expect(flat).toStrictEqual([{ id: 'blk-1', type: 'paragraph', data: {} }]);
    });
  });

  describe('splicing a run', () => {
    it('omits content for a block whose content array is empty', () => {
      const flat = flatten({ blocks: [{ id: 'a', type: 'paragraph', content: [] }] });

      expect(Object.hasOwn(flat[0], 'content')).toBe(false);
    });

    it('keeps content a block actually declares', () => {
      const flat = flatten({
        blocks: [
          { id: 'a', type: 'paragraph', content: ['b'] },
          { id: 'b', type: 'paragraph', parent: 'a' },
        ],
      });

      expect(flat).toStrictEqual([
        { id: 'a', type: 'paragraph', data: {}, content: ['b'] },
        { id: 'b', type: 'paragraph', data: {}, parent: 'a' },
      ]);
    });
  });
});
