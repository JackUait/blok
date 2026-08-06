// packages/react/src/useBlocks.ts
import { useCallback, useMemo, useRef, useSyncExternalStore } from 'react';

import type { Blok } from '@/types';
import { changeTouchesSubtree, createBlocksApiForEditor, EMPTY_API } from '@bloklabs/core/adapters';

import type { UseBlocksApi } from './blocks-snapshot';

const BLOCK_CHANGED_EVENT = 'block changed';

/** Options for {@link useBlocks}. */
export interface UseBlocksOptions {
  /**
   * Re-render only for changes inside the subtree rooted at this block id (the
   * block itself or any descendant). Omit — or pass `null` — for the
   * document-wide default.
   *
   * This bounds REACTIVITY, not reads: the returned API still sees the whole
   * tree, so a scoped consumer can still `getById` anything. Reach for it in a
   * container block that renders only its own children — unscoped, such a block
   * re-renders on every keystroke anywhere in the document, and a page of N
   * containers turns one keystroke into N re-renders.
   *
   * A change whose block cannot be placed in the tree (a removal that emits
   * after the block is gone) counts as in-scope: skipping it would leave a
   * container rendering a child that no longer exists.
   */
  within?: string | null;
}

/**
 * React hook exposing an id/parentId-relative, reactive view of the block tree.
 * Re-renders whenever the editor emits 'block changed' — including programmatic
 * `nest`/`unnest` reparents, which Blok surfaces as a structural mutation.
 *
 * The block-tree logic itself is framework-agnostic and lives in the shared
 * {@link createBlocksApiForEditor} core (one implementation behind both the
 * React and Vue `useBlocks`, so the two adapters cannot drift). This hook only
 * supplies React's reactivity wrapper: `useSyncExternalStore` re-renders the
 * component on 'block changed', and the shared API's reads run live during that
 * render — so React needs no per-read dependency tracking (the default no-op
 * `onRead`).
 *
 * Reactivity contract: reads refresh ONLY in response to the editor's
 * 'block changed' event. A mutation that advances the editor state WITHOUT
 * emitting it (a tool that mutates its own data without a sync, say) would leave
 * these reads frozen on the previous snapshot until the next emission. The
 * built-in mutators here all route through paths that emit, so this only bites
 * out-of-band tool writes.
 *
 * Pre-ready contract: while `editor` is null (before `useBlok` resolves) the
 * returned API is the stable {@link EMPTY_API} — every MUTATOR is a no-op,
 * `insert`/`getById` return `null`, and `getChildren` returns `[]`. The one
 * exception is `transact`, which still invokes its callback even pre-ready.
 * Mutator calls made before the editor is ready are silently dropped, so guard
 * on a non-null editor (or render-gate on it) when an insert must not be lost.
 *
 * Referential stability: the returned API object is stable across renders (it
 * only changes when `editor` does), but each `getById`/`getChildren` call
 * allocates fresh `BlockNode` objects/arrays from a live snapshot. Read them in
 * render and re-read after a change — do NOT put a `getById`/`getChildren`
 * result (or the api handle) in a `useMemo`/`useEffect` dependency array
 * expecting it to change identity per mutation; depend on the node `id`s instead.
 * @param editor - the Blok instance from useBlok, or null before it is ready
 * @param options - reactivity options; see {@link UseBlocksOptions.within} to
 *   scope re-renders to one block's subtree
 */
export function useBlocks(editor: Blok | null, options: UseBlocksOptions = {}): UseBlocksApi {
  const within = options.within ?? null;

  // Monotonic version bumped on every 'block changed'; drives useSyncExternalStore.
  const versionRef = useRef(0);

  // Reset the monotonic version when the editor INSTANCE changes so a fresh
  // editor doesn't inherit a stale version from a previous one. Done in render
  // (idempotent: editorRef is updated in the same pass, so a re-render with the
  // same editor won't reset again) — safe for useSyncExternalStore, which just
  // re-reads getSnapshot and re-renders if the value differs.
  const editorRef = useRef(editor);

  if (editorRef.current !== editor) {
    editorRef.current = editor;
    versionRef.current = 0;
  }

  const subscribe = useCallback(
    (onStoreChange: () => void): (() => void) => {
      if (editor === null) {
        return () => undefined;
      }

      const handler = (payload?: unknown): void => {
        if (within !== null && !changeTouchesSubtree(editor, payload, within)) {
          return;
        }

        versionRef.current += 1;
        onStoreChange();
      };

      editor.on(BLOCK_CHANGED_EVENT, handler);

      return () => editor.off(BLOCK_CHANGED_EVENT, handler);
    },
    [editor, within]
  );

  const getSnapshot = useCallback((): number => versionRef.current, []);

  useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  // React re-renders the whole component on 'block changed' (above), and the
  // shared API's reads run live during that render, so no per-read dependency
  // tracking is needed — the default no-op `onRead` is correct here.
  return useMemo<UseBlocksApi>(
    () => (editor === null ? EMPTY_API : createBlocksApiForEditor(editor)),
    [editor]
  );
}
