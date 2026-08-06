// packages/angular/src/block-context.ts
import { InjectionToken, type Signal } from '@angular/core';

import type { API } from '@/types';
import type { BlockAPI } from '@/types/api';

/**
 * One child's decoration: attribute name → value. `null`/`undefined` removes the
 * attribute; a boolean or number is stringified (so `false` writes
 * `data-active="false"`, which CSS can select, rather than dropping the hook).
 */
export type ChildAttributes = Record<string, string | number | boolean | null | undefined>;

/** The per-child decorator accepted by {@link AngularBlockRenderContext.mountChildren}. */
export type ChildAttributesFn = (child: BlockAPI, index: number) => ChildAttributes;

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
   * The EDITOR-level API this block belongs to (`api.blocks`, `api.caret`,
   * `api.toolbar`…) — the same object a vanilla tool receives in its
   * constructor. Reach for it when a block has to drive the document around it
   * instead of routing everything through `block.call()` string dispatch.
   *
   * For the reactive, id/parentId-relative view of the tree (and to re-render
   * when your own children change), pair `injectBlocks` with
   * `injectBlokInstance()` instead — the api handle itself is not reactive.
   */
  api: API;
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
   *
   * `childAttributes` decorates each child's HOLDER after the holders are
   * mounted, and is REMEMBERED — every later remount re-applies it. Named hooks
   * (`data-step-index`, `data-active`…) replace positional `:nth-child()` CSS
   * over Blok's holders, which breaks the moment a child is inserted, removed or
   * reordered. The holders stay DIRECT children of `host` — core requires that
   * (hierarchy reparenting and caret navigation compare `holder.parentElement`
   * by identity), so decoration is attributes, never wrapper elements.
   * Attributes the callback stops producing are removed on the next pass.
   *
   * `childContentAttributes` is the same decoration applied one level IN — on
   * each child's `[data-blok-element-content]` wrapper instead of its holder —
   * and is remembered the same way. Core's decoration law blesses both, and a
   * container needs both: the holder is the child's outer box (rails, indices,
   * hover states), the content wrapper is where the child's own text box begins,
   * which is what a numbered rail or a connector line has to align to. Reach for
   * it instead of walking core's wrapper chain from a holder hook (`[data-step] >
   * [data-blok-element-content] > …`) — those selectors encode engine DOM in host
   * CSS and break when that structure changes. A child whose DOM has not
   * committed yet has no wrapper to write to and is stamped on the next pass.
   *
   * Writing on a child's holder is inert by design: core's mutation filter drops
   * a holder-targeted attribute record for the child block and suppresses it for
   * the container. The guarantee stops at the holder and its
   * `[data-blok-element-content]` wrapper — writing AT or BELOW a child's tool
   * root DOES score as that child's edit.
   */
  mountChildren: (
    host: HTMLElement,
    childAttributes?: ChildAttributesFn,
    childContentAttributes?: ChildAttributesFn
  ) => void;
  /**
   * Name the element the +/drag toolbar should vertically center on, from inside
   * the component: `ctx.setToolbarAnchor(this.head().nativeElement)` in
   * `ngAfterViewInit`. The Angular counterpart of React's/Vue's
   * `toolbarAnchorRef` — core's `getToolbarAnchorElement` is otherwise a
   * `(host, block) => Element` hook resolved OUTSIDE the component, so pointing
   * at an element the template renders meant inventing a data attribute and
   * `querySelector`-ing for it from
   * `CreateAngularBlockSpec.getToolbarAnchorElement`.
   *
   * A container block whose own chrome is not editable needs an anchor: with
   * none, core centers the toolbar on the first `[contenteditable]` under the
   * host, which for a container is its FIRST CHILD BLOCK — parking the +/drag
   * handles halfway down, beside content that has a toolbar of its own.
   *
   * The element set here outranks the declared hook while it is MOUNTED; once it
   * detaches (or `null` is passed) the hook takes over again, so the toolbar is
   * never positioned against a stale node. Never calling it keeps core's default.
   */
  setToolbarAnchor: (element: HTMLElement | null) => void;
}

/** DI token carrying the per-block render context into the authored component. */
export const BLOK_BLOCK_CONTEXT = new InjectionToken<AngularBlockRenderContext<unknown>>(
  'BLOK_BLOCK_CONTEXT'
);
