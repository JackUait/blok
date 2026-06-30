// src/angular/block-context.ts
import { InjectionToken, type Signal } from '@angular/core';

import type { BlockAPI } from '../../types/api';

/**
 * Context handed to a `createAngularBlock` component. Delivered via DI (the
 * BLOK_BLOCK_CONTEXT token) rather than @Input, because core constructs the tool
 * outside Angular and the signal-input() form does not compile under the repo's
 * JIT test harness. The ONLY data write path is `commit`.
 */
export interface AngularBlockRenderContext<Data> {
  /** Reactive, FROZEN snapshot of the block data. Read `data()`; never mutate. */
  data: Signal<Readonly<Data>>;
  /** The ONLY data write path: merge a partial patch and sync once. */
  commit: (patch: Partial<Data>) => void;
  /** This block's per-block API (id, getChildren, dispatchChange…). */
  block: BlockAPI;
  /**
   * Reactive read-only flag. Read `readOnly()` in the template to disable
   * editing (drop `contenteditable`, hide controls). Toggled IN PLACE by core's
   * read-only switch — the component reacts without a remount, so ephemeral
   * state survives. A block that ignores it stays interactive when the editor is
   * read-only (same contract as a vanilla tool's `setReadOnly`).
   */
  readOnly: Signal<boolean>;
  /**
   * Container blocks only: append this block's real child holders into `host`
   * (a `data-blok-nested` element the author owns). Call it once in
   * `ngAfterViewInit`; the factory re-runs the same mount on every data change
   * so late-added children appear. Angular must NOT manage these child holders.
   */
  mountChildren: (host: HTMLElement) => void;
}

/** DI token carrying the per-block render context into the authored component. */
export const BLOK_BLOCK_CONTEXT = new InjectionToken<AngularBlockRenderContext<unknown>>(
  'BLOK_BLOCK_CONTEXT'
);
