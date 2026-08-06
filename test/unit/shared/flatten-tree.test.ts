import { describe, it, expect } from 'vitest';
import type { LooseOutputBlockData } from '../../../types/data-formats/output-data';
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

/**
 * ROOT CAUSE these fix: `BlockTreeSpec` could only express a TREE, so a caller
 * holding an ALREADY-FLAT saved document (a legacy migration splicing a stored
 * Blok document into a new page, say) had no way to put it in a spec. The two
 * available workarounds both corrupt: un-flattening to tree shape reorders any
 * document not already in DFS pre-order and changes which blocks get generated
 * ids, and passing the flat blocks as tree nodes silently DROPS their
 * `parent`/`content` links (the fields are not part of a spec node).
 *
 * Core already had the semantic — `useBlocks.insertMarkdown` re-parents the
 * top-level blocks of a converted run and leaves internally-nested ones alone —
 * but only over a live editor. A run node is that semantic, pure.
 */
describe('flattenTree — pre-flat runs', () => {
  const seq = (): (() => string) => {
    let n = 0;

    return () => `gen-${++n}`;
  };

  /** A saved two-block run: one root paragraph and a nested child under it. */
  const savedRun = (): LooseOutputBlockData[] => [
    { id: 'r1', type: 'paragraph', data: { text: 'root' }, content: ['r2'] },
    { id: 'r2', type: 'paragraph', data: { text: 'nested' }, parent: 'r1' },
  ];

  it('splices a run verbatim, re-parenting only its un-parented top-level blocks', () => {
    const flat = flattenTree({ blocks: savedRun() }, { parentId: 'host', generateId: seq() });

    expect(flat.map((b) => b.id)).toEqual(['r1', 'r2']);
    // Top-level block of the run takes the splice target as its parent…
    expect(flat[0].parent).toBe('host');
    // …while a block the run already nested keeps the parent it came with.
    expect(flat[1].parent).toBe('r1');
    // Existing links are carried through untouched.
    expect(flat[0].content).toEqual(['r2']);
    expect(flat[0].data).toEqual({ text: 'root' });
  });

  it('leaves an un-parented run un-parented when no parentId is given', () => {
    const flat = flattenTree({ blocks: savedRun() }, { generateId: seq() });

    expect(flat[0]).not.toHaveProperty('parent');
    expect(flat[1].parent).toBe('r1');
  });

  it('joins a parent node content with the run roots only, in run order', () => {
    const flat = flattenTree(
      {
        id: 'col',
        type: 'column',
        children: [{ blocks: [
          { id: 'a', type: 'paragraph' },
          { id: 'a1', type: 'paragraph', parent: 'a' },
          { id: 'b', type: 'paragraph' },
        ] }],
      },
      { generateId: seq() }
    );

    expect(flat.map((b) => b.id)).toEqual(['col', 'a', 'a1', 'b']);
    // Only the run's ROOTS become children of the enclosing node.
    expect(flat[0].content).toEqual(['a', 'b']);
    expect(flat.find((b) => b.id === 'a')?.parent).toBe('col');
    expect(flat.find((b) => b.id === 'a1')?.parent).toBe('a');
    expect(flat.find((b) => b.id === 'b')?.parent).toBe('col');
  });

  it('keeps document order when runs and tree nodes are mixed as children', () => {
    const flat = flattenTree(
      {
        id: 'col',
        type: 'column',
        children: [
          { id: 'one', type: 'paragraph' },
          { blocks: [{ id: 'two', type: 'paragraph' }] },
          { id: 'three', type: 'header', children: [{ id: 'three-kid', type: 'paragraph' }] },
        ],
      },
      { generateId: seq() }
    );

    expect(flat.map((b) => b.id)).toEqual(['col', 'one', 'two', 'three', 'three-kid']);
    expect(flat[0].content).toEqual(['one', 'two', 'three']);
  });

  it('generates ids for run blocks that omit one', () => {
    const flat = flattenTree({ blocks: [{ type: 'paragraph' }] }, { parentId: 'host', generateId: seq() });

    expect(flat[0].id).toBe('gen-1');
    expect(flat[0].parent).toBe('host');
  });

  it('throws when a run reuses an id already used elsewhere in the spec', () => {
    expect(() =>
      flattenTree(
        {
          id: 'dup',
          type: 'column',
          children: [{ blocks: [{ id: 'dup', type: 'paragraph' }] }],
        },
        { generateId: seq() }
      )
    ).toThrow(/duplicate/i);
  });

  it('throws when pre-flat blocks are passed as tree nodes (links would be dropped silently)', () => {
    expect(() =>
      flattenTree(
        [{ id: 'a', type: 'paragraph', content: ['b'] }, { id: 'b', type: 'paragraph', parent: 'a' }] as never,
        { generateId: seq() }
      )
    ).toThrow(/\{ blocks/);
  });

  it('carries tunes and omits absent optional fields for run blocks', () => {
    const flat = flattenTree(
      { blocks: [{ id: 'x', type: 'paragraph', tunes: { align: { alignment: 'center' } } }] },
      { generateId: seq() }
    );

    expect(flat[0].tunes).toEqual({ align: { alignment: 'center' } });
    expect(flat[0]).not.toHaveProperty('content');
    expect(flat[0]).not.toHaveProperty('parent');
  });
});
