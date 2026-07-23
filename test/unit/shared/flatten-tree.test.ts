import { describe, it, expect } from 'vitest';
import { flattenTree } from '../../../src/shared/flatten-tree';

/**
 * ROOT CAUSE this fixes (#11): the DFS flattener that wires a nested spec into
 * flat `parent`/`content` arrays lived welded inside `insertTree`, over a LIVE
 * editor. Seeding nested content (columns, tables) therefore forced callers to
 * hand-author every `parent`/`content` id array. `flattenTree` is that logic
 * extracted as a pure transform.
 *
 * A deterministic id generator is passed so the output is assertable.
 */
describe('flattenTree', () => {
  const seq = (): (() => string) => {
    let n = 0;

    return () => `gen-${++n}`;
  };

  it('flattens a leaf node to a single root block with no parent/content noise', () => {
    const flat = flattenTree({ type: 'paragraph', data: { text: 'hi' } }, { generateId: seq() });

    expect(flat).toEqual([
      { id: 'gen-1', type: 'paragraph', data: { text: 'hi' } },
    ]);
  });

  it('generates ids for nodes that omit them and preserves explicit ids', () => {
    const flat = flattenTree({ id: 'keep', type: 'paragraph' }, { generateId: seq() });

    expect(flat[0].id).toBe('keep');
  });

  it('wires parent/content links in DFS pre-order for a nested column tree', () => {
    const flat = flattenTree(
      {
        id: 'cl',
        type: 'column_list',
        children: [
          { id: 'c1', type: 'column', children: [{ id: 'p1', type: 'paragraph', data: { text: 'L' } }] },
          { id: 'c2', type: 'column', children: [{ id: 'p2', type: 'paragraph', data: { text: 'R' } }] },
        ],
      },
      { generateId: seq() }
    );

    // DFS pre-order: cl, c1, p1, c2, p2
    expect(flat.map((b) => b.id)).toEqual(['cl', 'c1', 'p1', 'c2', 'p2']);
    // Parent links point up the tree; the root has none.
    expect(flat.find((b) => b.id === 'cl')).not.toHaveProperty('parent');
    expect(flat.find((b) => b.id === 'c1')?.parent).toBe('cl');
    expect(flat.find((b) => b.id === 'p1')?.parent).toBe('c1');
    expect(flat.find((b) => b.id === 'p2')?.parent).toBe('c2');
    // Content links point down to child ids.
    expect(flat.find((b) => b.id === 'cl')?.content).toEqual(['c1', 'c2']);
    expect(flat.find((b) => b.id === 'c1')?.content).toEqual(['p1']);
    // Leaves omit the empty content array (documented OutputBlockData shape).
    expect(flat.find((b) => b.id === 'p1')).not.toHaveProperty('content');
  });

  it('accepts an array of roots and flattens them all in order', () => {
    const flat = flattenTree(
      [
        { id: 'a', type: 'paragraph' },
        { id: 'b', type: 'header', children: [{ id: 'b1', type: 'paragraph' }] },
      ],
      { generateId: seq() }
    );

    expect(flat.map((b) => b.id)).toEqual(['a', 'b', 'b1']);
    expect(flat.find((b) => b.id === 'a')).not.toHaveProperty('parent');
    expect(flat.find((b) => b.id === 'b')).not.toHaveProperty('parent');
    expect(flat.find((b) => b.id === 'b1')?.parent).toBe('b');
  });

  it('applies options.parentId to root nodes only', () => {
    const flat = flattenTree(
      { id: 'root', type: 'paragraph', children: [{ id: 'kid', type: 'paragraph' }] },
      { parentId: 'host', generateId: seq() }
    );

    expect(flat.find((b) => b.id === 'root')?.parent).toBe('host');
    expect(flat.find((b) => b.id === 'kid')?.parent).toBe('root');
  });

  it('preserves tunes when present', () => {
    const flat = flattenTree(
      { id: 'x', type: 'paragraph', tunes: { align: { alignment: 'center' } } },
      { generateId: seq() }
    );

    expect(flat[0].tunes).toEqual({ align: { alignment: 'center' } });
  });

  it('throws on a duplicate explicit id within the spec (would corrupt id lookups)', () => {
    expect(() =>
      flattenTree(
        { id: 'dup', type: 'column_list', children: [{ id: 'dup', type: 'column' }] },
        { generateId: seq() }
      )
    ).toThrow(/duplicate/i);
  });

  it('defaults to omitting type so core resolves the default block', () => {
    const flat = flattenTree({ data: { text: 'x' } }, { generateId: seq() });

    expect(flat[0]).not.toHaveProperty('type');
    expect(flat[0].data).toEqual({ text: 'x' });
  });
});
