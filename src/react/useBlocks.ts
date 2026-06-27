// src/react/useBlocks.ts
import { useCallback, useMemo, useRef, useSyncExternalStore } from 'react';
import type { Blok } from '../../types';
import {
  snapshotNodes,
  type BlockNode,
  type IndexReader,
  type UseBlocksApi,
} from './blocks-snapshot';

const BLOCK_CHANGED_EVENT = 'block changed';

/** Adapt the live editor to the IndexReader the snapshot helpers expect. */
const readerFor = (editor: Blok): IndexReader => {
  const blocks = editor.blocks;

  return {
    getBlocksCount: () => blocks.getBlocksCount(),
    getBlockByIndex: (i: number) => {
      const b = blocks.getBlockByIndex(i);

      return b === undefined ? undefined : { id: b.id, name: b.name, parentId: b.parentId };
    },
    getBlockIndex: (id: string) => blocks.getBlockIndex(id),
  };
};

const EMPTY_API: UseBlocksApi = {
  getById: () => null,
  getChildren: () => [],
  insert: () => null,
  move: () => undefined,
  nest: () => undefined,
  unnest: () => undefined,
  remove: () => undefined,
  transact: (fn: () => void) => fn(),
};

/**
 * React hook exposing an id/parentId-relative, reactive view of the block tree.
 * Re-renders whenever the editor emits 'block changed'.
 * @param editor - the Blok instance from useBlok, or null before it is ready
 */
export function useBlocks(editor: Blok | null): UseBlocksApi {
  // Monotonic version bumped on every 'block changed'; drives useSyncExternalStore.
  const versionRef = useRef(0);

  const subscribe = useCallback(
    (onStoreChange: () => void): (() => void) => {
      if (editor === null) {
        return () => undefined;
      }

      const handler = (): void => {
        versionRef.current += 1;
        onStoreChange();
      };

      editor.events.on(BLOCK_CHANGED_EVENT, handler);

      return () => editor.events.off(BLOCK_CHANGED_EVENT, handler);
    },
    [editor]
  );

  const getSnapshot = useCallback((): number => versionRef.current, []);

  useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  return useMemo<UseBlocksApi>(() => {
    if (editor === null) {
      return EMPTY_API;
    }

    const reader = readerFor(editor);

    const getById = (id: string): BlockNode | null => {
      const nodes = snapshotNodes(reader);

      return nodes.find((n) => n.id === id) ?? null;
    };

    const getChildren = (parentId: string | null): BlockNode[] =>
      snapshotNodes(reader).filter((n) => n.parentId === parentId);

    return {
      ...EMPTY_API,
      getById,
      getChildren,
    };
  }, [editor]);
}
