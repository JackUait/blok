import { describe, expect, it } from 'vitest';

import { changeTouchesSubtree } from '../../../../src/components/utils/blocks-api';
import type { Blok } from '../../../../types';

type FakeRecord = { id: string; name: string; parentId: string | null };

/**
 * A flat-list editor exposing only the `blocks.getById` the predicate walks. The
 * walk is deliberately ancestry-only (no full-tree snapshot): the predicate runs
 * on EVERY 'block changed' — i.e. on every keystroke — so it has to cost
 * O(depth), not O(document).
 */
const fakeEditor = (rows: FakeRecord[]): Blok =>
  ({
    blocks: {
      getById: (id: string) => rows.find(r => r.id === id) ?? null,
    },
  } as unknown as Blok);

/** The shape core's dispatcher emits for 'block changed'. */
const changeOf = (id: string): unknown => ({
  event: { detail: { target: { id } } },
});

const TREE: FakeRecord[] = [
  { id: 'card', name: 'card', parentId: null },
  { id: 'step-1', name: 'paragraph', parentId: 'card' },
  { id: 'note', name: 'paragraph', parentId: 'step-1' },
  { id: 'other-root', name: 'paragraph', parentId: null },
  { id: 'other-child', name: 'paragraph', parentId: 'other-root' },
];

describe('changeTouchesSubtree', () => {
  const editor = fakeEditor(TREE);

  it('accepts the scope block itself', () => {
    expect(changeTouchesSubtree(editor, changeOf('card'), 'card')).toBe(true);
  });

  it('accepts a direct child and a deeper descendant', () => {
    expect(changeTouchesSubtree(editor, changeOf('step-1'), 'card')).toBe(true);
    expect(changeTouchesSubtree(editor, changeOf('note'), 'card')).toBe(true);
  });

  it('rejects a block in an unrelated subtree — the whole point of scoping', () => {
    expect(changeTouchesSubtree(editor, changeOf('other-root'), 'card')).toBe(false);
    expect(changeTouchesSubtree(editor, changeOf('other-child'), 'card')).toBe(false);
  });

  it('rejects an ANCESTOR of the scope: a subtree scope looks down, not up', () => {
    expect(changeTouchesSubtree(editor, changeOf('card'), 'step-1')).toBe(false);
  });

  it('accepts a target that has already left the tree', () => {
    // A removal commonly emits with the block gone, so its ancestry is
    // unresolvable. Indeterminate must read as "re-render": a missed removal
    // leaves a container rendering a child that no longer exists, while a
    // needless re-render costs one pass.
    expect(changeTouchesSubtree(editor, changeOf('deleted'), 'card')).toBe(true);
  });

  it('accepts an unreadable payload rather than swallowing the change', () => {
    expect(changeTouchesSubtree(editor, undefined, 'card')).toBe(true);
    expect(changeTouchesSubtree(editor, {}, 'card')).toBe(true);
    expect(changeTouchesSubtree(editor, { event: { detail: {} } }, 'card')).toBe(true);
  });

  it('does not hang on a parentId cycle', () => {
    const cyclic = fakeEditor([
      { id: 'a', name: 'paragraph', parentId: 'b' },
      { id: 'b', name: 'paragraph', parentId: 'a' },
    ]);

    expect(changeTouchesSubtree(cyclic, changeOf('a'), 'elsewhere')).toBe(false);
  });
});
