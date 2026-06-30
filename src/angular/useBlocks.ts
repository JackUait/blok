// src/angular/useBlocks.ts
import { DestroyRef, effect, inject, signal, type Signal } from '@angular/core';

import type { Blok } from '../../types';
import { createBlocksApiForEditor, EMPTY_API } from '../components/utils/blocks-api';

import type { UseBlocksApi } from './blocks-snapshot';

const BLOCK_CHANGED_EVENT = 'block changed';

/**
 * Angular factory exposing an id/parentId-relative, reactive view of the block
 * tree. Reads refresh whenever the editor emits `block changed`; mutators route
 * through the editor-level `blocks` API (core's chokepoints), so undo/redo and
 * Yjs sync are inherited rather than re-implemented.
 *
 * The block-tree logic is framework-agnostic and lives in the shared
 * {@link createBlocksApiForEditor} core — the SAME implementation behind React's
 * and Vue's `useBlocks`, so all three adapters expose the identical 28-method
 * surface and cannot drift. This wrapper supplies only Angular's reactivity:
 *
 * - A private `version` signal is bumped on every `block changed`. The shared API
 *   is built with an `onRead` seam (`() => { version() }`) that every read method
 *   calls, so reading inside a `computed`/template tracks `version` and re-runs on
 *   each structural mutation.
 * - The bound API is rebuilt (via `bindToEditor`, called eagerly on first call and
 *   then tracked by an `effect` for subsequent identity changes) when the editor
 *   IDENTITY changes; the returned facade is stable across that swap.
 *
 * Call it in an injection context (component constructor / field initializer),
 * passing the editor signal (e.g. `BlokEditorComponent.instance` /
 * `BlokContentDirective.instance`). Pre-ready (editor null) the bound API is the
 * shared {@link EMPTY_API}: every mutator a no-op, reads empty/null — except
 * `transact`/`transactWithoutCapture`, which still run their callback.
 *
 * Note: Angular 20's `effect()` is scheduled (not eager) — it does not fire
 * synchronously on first call. The initial binding therefore runs synchronously
 * in the `injectBlocks` body itself (mirroring Vue's `{ immediate: true }` watch),
 * and the effect re-binds only on subsequent editor identity changes. When the
 * effect fires for the first time with the same editor already bound, the guard
 * `ed === sub.editor` makes it a no-op, so no double-subscription occurs.
 *
 * @param editor - a signal of the Blok instance, or null pre-ready
 */
export function injectBlocks(editor: Signal<Blok | null>): UseBlocksApi {
  // Bumped on every `block changed`; the shared API's read methods touch it (via
  // the onRead seam) so template/computed reads stay reactive.
  const version = signal(0);
  const touch = (): void => {
    version();
  };

  // The API bound to the CURRENT editor; EMPTY_API while null. A signal so the
  // facade's reads track the editor-identity swap.
  const bound = signal<UseBlocksApi>(EMPTY_API);

  // One subscription record (no `let` reassignment), re-bound on editor change.
  const sub: { editor: Blok | null; handler: (() => void) | null } = { editor: null, handler: null };

  const unsubscribe = (): void => {
    if (sub.editor !== null && sub.handler !== null) {
      sub.editor.off(BLOCK_CHANGED_EVENT, sub.handler);
    }
    sub.editor = null;
    sub.handler = null;
  };

  /**
   * Bind to `ed` if the identity has changed. Guards `ed === sub.editor` so a
   * deferred first effect-run with the same editor already bound is a no-op
   * (no double-subscription). Called synchronously on first call (immediate
   * binding) and then re-tracked by the effect below (future identity changes).
   */
  const bindToEditor = (ed: Blok | null): void => {
    if (ed === sub.editor) {
      return; // Same editor already bound; nothing to do.
    }

    unsubscribe();
    // A changed editor identity is itself a reason to re-read.
    version.update((v) => v + 1);

    if (ed === null) {
      bound.set(EMPTY_API);

      return;
    }

    const handler = (): void => {
      version.update((v) => v + 1);
    };

    ed.on(BLOCK_CHANGED_EVENT, handler);
    sub.editor = ed;
    sub.handler = handler;
    bound.set(createBlocksApiForEditor(ed, touch));
  };

  // Run the initial binding SYNCHRONOUSLY so the returned facade is immediately
  // usable (Angular's effect() is deferred — it does not fire on the same tick).
  // This mirrors Vue's `watch(..., { immediate: true })`.
  bindToEditor(editor());

  // Re-bind when the editor identity changes. Angular 20 permits signal writes
  // inside effect() by default (allowSignalWrites option was removed in v20).
  effect(() => {
    bindToEditor(editor());
  });

  inject(DestroyRef).onDestroy(unsubscribe);

  // A stable facade whose methods delegate to the currently-bound API. Reading
  // `bound()` tracks the editor swap; shared reads track `version` via onRead.
  // Every key listed EXPLICITLY (no spread) so a forgotten delegation is a
  // COMPILE error against UseBlocksApi rather than a silently-missing method.
  return {
    getById: (id) => bound().getById(id),
    getChildren: (parentId) => bound().getChildren(parentId),
    insert: (spec) => bound().insert(spec),
    insertMany: (specs) => bound().insertMany(specs),
    insertTree: (spec) => bound().insertTree(spec),
    insertMarkdown: (markdown, options) => bound().insertMarkdown(markdown, options),
    move: (id, target) => bound().move(id, target),
    nest: (id, parentId) => bound().nest(id, parentId),
    unnest: (id) => bound().unnest(id),
    remove: (id) => bound().remove(id),
    update: (id, data, tunes) => bound().update(id, data, tunes),
    convert: (id, newType, dataOverrides, options) => bound().convert(id, newType, dataOverrides, options),
    transact: (fn) => bound().transact(fn),
    transactWithoutCapture: (fn) => bound().transactWithoutCapture(fn),
    getBlocksCount: () => bound().getBlocksCount(),
    getCurrentBlockIndex: () => bound().getCurrentBlockIndex(),
    getBlockByIndex: (index) => bound().getBlockByIndex(index),
    getBlockByElement: (element) => bound().getBlockByElement(element),
    getBlockData: (id) => bound().getBlockData(id),
    getBlockIndex: (id) => bound().getBlockIndex(id),
    composeBlockData: (toolName) => bound().composeBlockData(toolName),
    renderFromHTML: (html) => bound().renderFromHTML(html),
    insertOutputData: (blocks, options) => bound().insertOutputData(blocks, options),
    splitBlock: (currentBlockId, currentBlockData, newBlockType, newBlockData, insertIndex) =>
      bound().splitBlock(currentBlockId, currentBlockData, newBlockType, newBlockData, insertIndex),
    insertInsideParent: (parentId, insertIndex, childData) =>
      bound().insertInsideParent(parentId, insertIndex, childData),
    render: (data) => bound().render(data),
    clear: () => bound().clear(),
    isSyncingFromYjs: () => bound().isSyncingFromYjs(),
  };
}
