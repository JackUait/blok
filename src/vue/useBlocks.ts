// src/vue/useBlocks.ts
import {
  shallowRef,
  watch,
  toValue,
  toRaw,
  onScopeDispose,
  type MaybeRefOrGetter,
} from 'vue';

import type { Blok } from '../../types';
import {
  snapshotNodes,
  resolveInsertIndex,
  resolveMoveIndex,
  type BlockNode,
  type IndexReader,
  type InsertSpec,
  type MoveTarget,
} from '../components/utils/blocks-tree';

import type { UseBlocksApi } from './blocks-snapshot';

const BLOCK_CHANGED_EVENT = 'block changed';

/** Adapt the live editor to the IndexReader the shared resolvers expect. */
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

/**
 * Vue composable exposing an id/parentId-relative, reactive view of the block
 * tree. Reads refresh whenever the editor emits `block changed`; mutators route
 * through the editor-level `blocks` API (core's chokepoints), so undo/redo and
 * Yjs sync are inherited rather than re-implemented.
 *
 * Reactivity: read methods touch a private version ref that the `block changed`
 * subscription bumps, so calling `getChildren`/`getById` inside a `computed` or
 * template re-runs on every structural mutation — including programmatic
 * nest/unnest, which core surfaces as a structural change.
 *
 * The editor is accepted as a value, ref, or getter (so the `shallowRef` that
 * `useBlok` returns can be passed directly) and is `toRaw`-unwrapped before any
 * read or core handoff, never letting a Vue reactive proxy reach core (Risk R0).
 *
 * @param editor - the Blok instance (or ref/getter of it), or null pre-ready
 */
export function useBlocks(editor: MaybeRefOrGetter<Blok | null>): UseBlocksApi {
  // Bumped on every `block changed`; read methods touch it for reactivity.
  const version = shallowRef(0);

  const resolve = (): Blok | null => {
    const ed = toValue(editor);

    return ed === null ? null : toRaw(ed);
  };

  // Manage the `block changed` subscription, re-binding when the editor changes.
  // Held in one object (no `let` reassignment) — the same pattern useBlok uses.
  const sub: { editor: Blok | null; handler: (() => void) | null } = { editor: null, handler: null };

  const unsubscribe = (): void => {
    if (sub.editor !== null && sub.handler !== null) {
      sub.editor.off(BLOCK_CHANGED_EVENT, sub.handler);
    }
    sub.editor = null;
    sub.handler = null;
  };

  watch(
    () => resolve(),
    (ed) => {
      unsubscribe();
      // A changed editor identity is itself a reason to re-read.
      version.value += 1;

      if (ed !== null) {
        const handler = (): void => {
          version.value += 1;
        };

        ed.on(BLOCK_CHANGED_EVENT, handler);
        sub.editor = ed;
        sub.handler = handler;
      }
    },
    { immediate: true }
  );

  onScopeDispose(unsubscribe);

  /**
   * Run `fn` inside core's transact when available (one undo step), else run it
   * directly. `transact` is optional on the public Blocks type, so it is guarded.
   */
  const runTransact = (ed: Blok, fn: () => void): void => {
    if (typeof ed.blocks.transact === 'function') {
      ed.blocks.transact(fn);
    } else {
      fn();
    }
  };

  /** All nodes of the current tree (silent — does not touch `version`). */
  const allNodes = (ed: Blok): BlockNode[] => snapshotNodes(readerFor(ed));

  const findNode = (ed: Blok, id: string): BlockNode | null =>
    allNodes(ed).find((n) => n.id === id) ?? null;

  const api: UseBlocksApi = {
    getById(id: string): BlockNode | null {
      // Touch the version so reads inside a computed/template are reactive.
      void version.value;
      const ed = resolve();

      return ed === null ? null : findNode(ed, id);
    },

    getChildren(parentId: string | null): BlockNode[] {
      void version.value;
      const ed = resolve();

      return ed === null ? [] : allNodes(ed).filter((n) => n.parentId === parentId);
    },

    getBlocksCount(): number {
      void version.value;
      const ed = resolve();

      return ed === null ? 0 : ed.blocks.getBlocksCount();
    },

    getBlockIndex(id: string): number | null {
      void version.value;
      const ed = resolve();

      if (ed === null) {
        return null;
      }

      const index = ed.blocks.getBlockIndex(id);

      return index === undefined ? null : index;
    },

    insert(spec: InsertSpec = {}): BlockNode | null {
      const ed = resolve();

      if (ed === null) {
        return null;
      }

      const parentId = spec.parentId ?? null;
      const position = spec.position ?? 'end';
      const data = spec.data ?? {};
      const reader = readerFor(ed);

      // Snapshot once for the pre-insert guards (the tree can't change until the
      // insert below runs), mirroring the React adapter's silent probes.
      const preById = new Map(allNodes(ed).map((n) => [n.id, n]));

      // Dangling parentId: honor the null contract instead of letting core throw
      // (dev) or silently misplace at the document end (prod).
      if (parentId !== null && !preById.has(parentId)) {
        return null;
      }

      // Object position naming a missing ref must be a no-op, not a surprise
      // append at the end (resolveInsertIndex's unresolved-ref fallback).
      if (typeof position === 'object') {
        const ref = 'before' in position ? position.before : position.after;

        if (!preById.has(ref)) {
          return null;
        }
      }

      const flatIndex = resolveInsertIndex(reader, parentId, position);

      // ONE transact → a single undo step covering both the insert and the
      // (parented) reparent. insertInsideParent is NOT used: it forces the
      // default block type and would silently drop a requested `type`. Insert at
      // the resolved flat slot, then reparent so `type` is honored.
      const result: { node: BlockNode | null } = { node: null };

      runTransact(ed, () => {
        const created = ed.blocks.insert(
          spec.type,
          data,
          {},
          flatIndex,
          spec.focus ?? false,
          spec.replace ?? false,
          spec.id,
          spec.tunes
        );

        if (parentId !== null && created.parentId !== parentId) {
          ed.blocks.setBlockParent(created.id, parentId);
        }

        result.node = findNode(ed, created.id);
      });

      return result.node;
    },

    move(id: string, target: MoveTarget): void {
      const ed = resolve();

      if (ed === null) {
        return;
      }

      const reader = readerFor(ed);
      const fromIndex = reader.getBlockIndex(id);

      if (fromIndex === undefined) {
        return;
      }

      ed.blocks.move(resolveMoveIndex(reader, target), fromIndex);
    },

    nest(id: string, parentId: string): void {
      resolve()?.blocks.setBlockParent(id, parentId);
    },

    unnest(id: string): void {
      resolve()?.blocks.setBlockParent(id, null);
    },

    remove(id: string): void {
      const ed = resolve();

      if (ed === null) {
        return;
      }

      const index = ed.blocks.getBlockIndex(id);

      if (index === undefined) {
        return;
      }

      void ed.blocks.delete(index);
    },

    transact(fn: () => void): void {
      const ed = resolve();

      if (ed === null) {
        fn();

        return;
      }

      runTransact(ed, fn);
    },
  };

  return api;
}
