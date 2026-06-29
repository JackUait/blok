// test/unit/react/useBlocks.insertMarkdown-edge.test.tsx
//
// Edge-case coverage for insertMarkdown that needs control over the (lazy,
// dynamically-imported) markdown converter: config forwarding, converter
// rejection handling, and re-validation of parentId across the await boundary.
// The converter is mocked so we can assert its arguments, reject it on demand,
// and mutate the tree DURING the await window.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';

const { markdownToBlocksMock } = vi.hoisted(() => ({ markdownToBlocksMock: vi.fn() }));

vi.mock('../../../src/markdown/index', () => ({
  markdownToBlocks: markdownToBlocksMock,
}));

import { useBlocks } from '../../../src/react/useBlocks';
import type { Blok } from '../../../types';

interface Row { id: string; name: string; parentId: string | null }

/** Minimal list-backed editor exposing only what insertMarkdown consumes. */
const makeEditor = (seed: Array<{ id: string; name?: string; parentId?: string | null }>) => {
  let list: Row[] = seed.map((r) => ({ id: r.id, name: r.name ?? 'paragraph', parentId: r.parentId ?? null }));
  const listeners = new Set<() => void>();
  let createSeq = 0;

  const insertManySpy = vi.fn(
    (blocks: ReadonlyArray<{ id?: string; type?: string; parent?: string | null }>, index?: number) => {
      const start = index ?? list.length;
      const created: Row[] = blocks.map((b) => {
        createSeq += 1;

        return { id: b.id ?? `md-${createSeq}`, name: b.type ?? 'paragraph', parentId: b.parent ?? null };
      });

      list.splice(start, 0, ...created);
      listeners.forEach((cb) => cb());

      return created.map((c) => ({ id: c.id }));
    }
  );

  const editor = {
    blocks: {
      getBlocksCount: (): number => list.length,
      getBlockByIndex: (i: number): Row | undefined => list[i],
      getBlockIndex: (id: string): number | undefined => {
        const idx = list.findIndex((b) => b.id === id);

        return idx === -1 ? undefined : idx;
      },
      insertMany: insertManySpy,
      transact: vi.fn((fn: () => void) => fn()),
    },
    on: (_n: string, cb: () => void): void => void listeners.add(cb),
    off: (_n: string, cb: () => void): void => void listeners.delete(cb),
  };

  return {
    editor: editor as unknown as Blok,
    insertManySpy,
    /** Simulate a concurrent removal of a block while a promise is in flight. */
    removeBlock: (id: string): void => {
      list = list.filter((b) => b.id !== id);
    },
  };
};

describe('useBlocks insertMarkdown — converter edge cases', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.restoreAllMocks());

  it('forwards a MarkdownImportConfig to the converter', async () => {
    markdownToBlocksMock.mockResolvedValue([{ type: 'paragraph', data: {} }]);
    const { editor } = makeEditor([{ id: 'a' }]);
    const { result } = renderHook(() => useBlocks(editor));
    const config = { gfm: false };

    await act(async () => {
      await result.current.insertMarkdown('# A', { config });
    });

    expect(markdownToBlocksMock).toHaveBeenCalledWith('# A', config);
  });

  it('swallows a converter rejection and returns [] instead of an unhandled rejection', async () => {
    markdownToBlocksMock.mockRejectedValue(new Error('parse boom'));
    const { editor, insertManySpy } = makeEditor([{ id: 'a' }]);
    const { result } = renderHook(() => useBlocks(editor));
    let created: Awaited<ReturnType<typeof result.current.insertMarkdown>> = [
      { id: 'sentinel', type: 'x', parentId: null, contentIds: [] },
    ];
    let threw = false;

    await act(async () => {
      try {
        created = await result.current.insertMarkdown('# A');
      } catch {
        threw = true;
      }
    });

    expect(threw).toBe(false);
    expect(created).toEqual([]);
    expect(insertManySpy).not.toHaveBeenCalled();
  });

  it('re-validates parentId after the await and returns [] if the parent vanished mid-flight', async () => {
    const { editor, insertManySpy, removeBlock } = makeEditor([{ id: 'container', name: 'toggle' }]);
    const { result } = renderHook(() => useBlocks(editor));

    // The converter resolves AFTER the parent is concurrently removed — the
    // pre-await existence check has gone stale, so the post-await re-check must
    // catch it and no-op rather than stamping a dangling parent.
    markdownToBlocksMock.mockImplementation(async () => {
      removeBlock('container');

      return [{ type: 'paragraph', data: {} }];
    });

    let created: Awaited<ReturnType<typeof result.current.insertMarkdown>> = [
      { id: 'sentinel', type: 'x', parentId: null, contentIds: [] },
    ];

    await act(async () => {
      created = await result.current.insertMarkdown('# A', { parentId: 'container' });
    });

    expect(created).toEqual([]);
    expect(insertManySpy).not.toHaveBeenCalled();
  });
});
