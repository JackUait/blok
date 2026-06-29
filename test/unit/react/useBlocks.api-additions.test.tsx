// test/unit/react/useBlocks.api-additions.test.tsx
//
// Covers the block-creation API surface added to close the React parity gaps:
//   - getBlockData(id): read a block's data/tunes through the hook so a
//     client-side duplicate is composable WITHOUT the ref escape hatch.
//   - getBlockIndex(id): absolute flat index, needed for off-caret splitBlock.
//   - renderFromHTML(html): the document-replacing HTML import wrapper.
// Plus a snapshot-efficiency invariant: a single insert must perform a BOUNDED
// number of full-tree enumerations regardless of how many guard probes the spec
// triggers (guards against the O(k·n) re-enumeration regression).
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useBlocks } from '../../../src/react/useBlocks';
import type { BlockNode } from '../../../src/react/blocks-snapshot';
import type { Blok } from '../../../types';

interface Row {
  id: string;
  name?: string;
  parentId?: string | null;
  preservedData?: Record<string, unknown>;
  preservedTunes?: Record<string, unknown>;
}

const makeFakeEditor = (rows: Row[]) => {
  const list = rows.map((r) => ({
    id: r.id,
    name: r.name ?? 'paragraph',
    parentId: r.parentId ?? null,
    preservedData: r.preservedData ?? {},
    preservedTunes: r.preservedTunes ?? {},
  }));
  const listeners = new Set<() => void>();
  // Instrument every read of flat index 0: each full-tree enumeration
  // (snapshotNodes/parentMap/childFlatIndices) reads index 0 exactly once, so
  // this counts the number of whole-tree scans performed during a call.
  let index0Reads = 0;
  const renderFromHTML = vi.fn(() => Promise.resolve());
  const editor = {
    blocks: {
      getBlocksCount: () => list.length,
      getBlockByIndex: (i: number) => {
        if (i === 0) {
          index0Reads += 1;
        }
        return list[i];
      },
      getBlockIndex: (id: string) => {
        const idx = list.findIndex((b) => b.id === id);
        return idx === -1 ? undefined : idx;
      },
      getById: (id: string) => list.find((b) => b.id === id) ?? null,
      insert: vi.fn((type?: string, _data?: unknown, _cfg?: unknown, index?: number) => {
        const id = `new-${list.length}`;
        const row = { id, name: type ?? 'paragraph', parentId: null, preservedData: {}, preservedTunes: {} };
        const at = index ?? list.length;
        list.splice(at, 0, row);
        return { id, name: row.name, parentId: row.parentId };
      }),
      setBlockParent: vi.fn(),
      transact: vi.fn((fn: () => void) => fn()),
      renderFromHTML,
      on: undefined,
    },
    caret: { setToBlock: vi.fn(() => true) },
    on: (_name: string, cb: () => void) => listeners.add(cb),
    off: (_name: string, cb: () => void) => listeners.delete(cb),
  };
  return {
    editor: editor as unknown as Blok,
    renderFromHTML,
    resetIndex0Reads: (): void => {
      index0Reads = 0;
    },
    index0Reads: (): number => index0Reads,
  };
};

describe('useBlocks — block-data reader (duplicate is composable)', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.restoreAllMocks());

  it('getBlockData returns a block data and tunes by id', () => {
    const { editor } = makeFakeEditor([
      { id: 'a', name: 'header', preservedData: { text: 'Title', level: 2 }, preservedTunes: { align: { dir: 'left' } } },
    ]);
    const { result } = renderHook(() => useBlocks(editor));

    expect(result.current.getBlockData('a')).toEqual({
      data: { text: 'Title', level: 2 },
      tunes: { align: { dir: 'left' } },
    });
  });

  it('getBlockData returns null for an unknown id', () => {
    const { editor } = makeFakeEditor([{ id: 'a' }]);
    const { result } = renderHook(() => useBlocks(editor));

    expect(result.current.getBlockData('missing')).toBeNull();
  });

  it('round-trips read -> insert to duplicate a block without the ref', () => {
    const { editor } = makeFakeEditor([
      { id: 'src', name: 'header', preservedData: { text: 'Dup me' } },
    ]);
    const { result } = renderHook(() => useBlocks(editor));

    const captured: { node: BlockNode | null } = { node: null };
    act(() => {
      const src = result.current.getById('src');
      const content = result.current.getBlockData('src');
      captured.node = result.current.insert({
        type: src?.type,
        data: content?.data,
        position: { after: 'src' },
      });
    });

    expect(captured.node).not.toBeNull();
    expect(captured.node?.type).toBe('header');
  });
});

describe('useBlocks — getBlockIndex(id)', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.restoreAllMocks());

  it('returns the absolute flat index of a block, or null when unknown', () => {
    const { editor } = makeFakeEditor([{ id: 'a' }, { id: 'b' }, { id: 'c' }]);
    const { result } = renderHook(() => useBlocks(editor));

    expect(result.current.getBlockIndex('b')).toBe(1);
    expect(result.current.getBlockIndex('missing')).toBeNull();
  });
});

describe('useBlocks — renderFromHTML', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.restoreAllMocks());

  it('delegates to core renderFromHTML and resolves', async () => {
    const { editor, renderFromHTML } = makeFakeEditor([{ id: 'a' }]);
    const { result } = renderHook(() => useBlocks(editor));

    await act(async () => {
      await result.current.renderFromHTML('<p>hello</p>');
    });

    expect(renderFromHTML).toHaveBeenCalledWith('<p>hello</p>');
  });
});

describe('useBlocks — insert snapshot efficiency (no O(k·n) re-enumeration)', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.restoreAllMocks());

  it('performs a bounded number of full-tree scans for one insert regardless of guards', () => {
    // A maximal spec: explicit id (existence probe) + parentId (dangling probe) +
    // object position (missing-ref probe) — each historically triggered its own
    // full snapshot enumeration. They must now share one pre-insert snapshot.
    const { editor, resetIndex0Reads, index0Reads } = makeFakeEditor([
      { id: 'p' },
      { id: 'anchor', parentId: 'p' },
    ]);
    const { result } = renderHook(() => useBlocks(editor));

    resetIndex0Reads();
    act(() => {
      result.current.insert({ id: 'fresh', parentId: 'p', position: { after: 'anchor' } });
    });

    // Pre-fix this was ~6+ scans (one per guard probe + positioning + post-read).
    // The shared pre-insert snapshot + a single post-insert read keeps it small.
    expect(index0Reads()).toBeLessThanOrEqual(4);
  });
});
