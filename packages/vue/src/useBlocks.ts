// src/vue/useBlocks.ts
import {
  shallowRef,
  watch,
  toValue,
  toRaw,
  onScopeDispose,
  type MaybeRefOrGetter,
} from 'vue';

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
   * invalidates on every keystroke anywhere in the document, and a page of N
   * containers turns one keystroke into N re-renders.
   *
   * Accepted as a value, ref or getter (like `editor`) and read at EMIT time, so
   * changing it takes effect immediately with no re-subscription.
   *
   * A change whose block cannot be placed in the tree (a removal that emits
   * after the block is gone) counts as in-scope: skipping it would leave a
   * container rendering a child that no longer exists.
   */
  within?: MaybeRefOrGetter<string | null>;
}

/**
 * Vue composable exposing an id/parentId-relative, reactive view of the block
 * tree. Reads refresh whenever the editor emits `block changed`; mutators route
 * through the editor-level `blocks` API (core's chokepoints), so undo/redo and
 * Yjs sync are inherited rather than re-implemented.
 *
 * The block-tree logic itself is framework-agnostic and lives in the shared
 * {@link createBlocksApiForEditor} core — the SAME implementation behind React's
 * `useBlocks`, so the two adapters expose the identical 28-method surface and
 * cannot drift. This composable supplies only Vue's reactivity wrapper:
 *
 * - A private `version` ref is bumped on every `block changed`. The shared API
 *   is built with an `onRead` seam (`() => { void version.value }`) that every
 *   read method calls, so reading `getChildren`/`getById`/… inside a `computed`
 *   or template tracks `version` and re-runs on each structural mutation
 *   (including programmatic nest/unnest, which core surfaces as a change).
 * - The bound API is rebuilt when the editor IDENTITY changes (held in a
 *   `shallowRef`), and the returned facade is stable across that swap.
 *
 * The editor is accepted as a value, ref, or getter (so the `shallowRef` that
 * `useBlok` returns can be passed directly) and is `toRaw`-unwrapped before any
 * read or core handoff, never letting a Vue reactive proxy reach core (Risk R0).
 *
 * Pre-ready: while the editor is null the bound API is the shared
 * {@link EMPTY_API} — every mutator a no-op, reads empty/null — except
 * `transact`/`transactWithoutCapture`, which still run their callback.
 *
 * @param editor - the Blok instance (or ref/getter of it), or null pre-ready
 * @param options - reactivity options; see {@link UseBlocksOptions.within} to
 *   scope invalidation to one block's subtree
 */
export function useBlocks(
  editor: MaybeRefOrGetter<Blok | null>,
  options: UseBlocksOptions = {}
): UseBlocksApi {
  // Bumped on every `block changed`; the shared API's read methods touch it
  // (via the onRead seam below) so template/computed reads stay reactive.
  const version = shallowRef(0);

  const resolve = (): Blok | null => {
    const ed = toValue(editor);

    return ed === null ? null : toRaw(ed);
  };

  // The reactivity seam handed to the shared core: every read method calls it,
  // so a read inside a Vue effect tracks `version` and re-runs on mutation.
  const touch = (): void => {
    void version.value;
  };

  // The API bound to the CURRENT editor. Rebuilt by the watch below when the
  // editor identity changes; EMPTY_API while null. A shallowRef so swapping the
  // bound API (on editor change) is itself a tracked reactive read.
  const bound = shallowRef<UseBlocksApi>(EMPTY_API);

  // Manage the `block changed` subscription, re-binding when the editor changes.
  // Held in one object (no `let` reassignment) — the same pattern useBlok uses.
  const sub: { editor: Blok | null; handler: ((payload?: unknown) => void) | null } = { editor: null, handler: null };

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

      if (ed === null) {
        bound.value = EMPTY_API;

        return;
      }

      const handler = (payload?: unknown): void => {
        // Resolved per emission, so a reactive `within` needs no re-subscription.
        const within = toValue(options.within) ?? null;

        if (within !== null && !changeTouchesSubtree(ed, payload, within)) {
          return;
        }

        version.value += 1;
      };

      ed.on(BLOCK_CHANGED_EVENT, handler);
      sub.editor = ed;
      sub.handler = handler;
      bound.value = createBlocksApiForEditor(ed, touch);
    },
    { immediate: true }
  );

  onScopeDispose(unsubscribe);

  // A stable facade whose methods delegate to the currently-bound API. Reading
  // `bound.value` tracks the editor-identity swap; the shared reads track
  // `version` via the onRead seam — so both kinds of change re-run a consumer's
  // computed/template. Every key is listed EXPLICITLY (no spread) so a forgotten
  // delegation is a COMPILE error against the UseBlocksApi return type rather
  // than a silently-missing method.
  return {
    getById: (id) => bound.value.getById(id),
    getChildren: (parentId) => bound.value.getChildren(parentId),
    insert: (spec) => bound.value.insert(spec),
    insertMany: (specs) => bound.value.insertMany(specs),
    insertTree: (spec) => bound.value.insertTree(spec),
    insertMarkdown: (markdown, options) => bound.value.insertMarkdown(markdown, options),
    exportMarkdown: () => bound.value.exportMarkdown(),
    move: (id, target) => bound.value.move(id, target),
    nest: (id, parentId) => bound.value.nest(id, parentId),
    unnest: (id) => bound.value.unnest(id),
    remove: (id) => bound.value.remove(id),
    update: (id, data, tunes) => bound.value.update(id, data, tunes),
    convert: (id, newType, dataOverrides, options) => bound.value.convert(id, newType, dataOverrides, options),
    transact: (fn) => bound.value.transact(fn),
    transactWithoutCapture: (fn) => bound.value.transactWithoutCapture(fn),
    getBlocksCount: () => bound.value.getBlocksCount(),
    getCurrentBlockIndex: () => bound.value.getCurrentBlockIndex(),
    getBlockByIndex: (index) => bound.value.getBlockByIndex(index),
    getBlockByElement: (element) => bound.value.getBlockByElement(element),
    getBlockData: (id) => bound.value.getBlockData(id),
    getBlockIndex: (id) => bound.value.getBlockIndex(id),
    composeBlockData: (toolName) => bound.value.composeBlockData(toolName),
    renderFromHTML: (html) => bound.value.renderFromHTML(html),
    insertOutputData: (blocks, options) => bound.value.insertOutputData(blocks, options),
    splitBlock: (currentBlockId, currentBlockData, newBlockType, newBlockData, insertIndex) =>
      bound.value.splitBlock(currentBlockId, currentBlockData, newBlockType, newBlockData, insertIndex),
    insertInsideParent: (parentId, insertIndex, childData) =>
      bound.value.insertInsideParent(parentId, insertIndex, childData),
    render: (data) => bound.value.render(data),
    clear: () => bound.value.clear(),
    isSyncingFromYjs: () => bound.value.isSyncingFromYjs(),
  };
}
