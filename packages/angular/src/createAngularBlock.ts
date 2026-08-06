// packages/angular/src/createAngularBlock.ts
import { signal, type Type, type WritableSignal } from '@angular/core';

import type { API } from '@/types';
import type { BlockAPI } from '@/types/api';
import type {
  BlockOrigin,
  BlockToolConstructable,
  BlockToolConstructorOptions,
  BlockToolData,
  ToolboxConfig,
} from '@/types/tools';
import {
  applyChildDecoration,
  BlockChildrenMounted,
  createChildDecorationLedger,
  DATA_ATTR,
} from '@bloklabs/core/adapters';
import { deepEqual } from '@bloklabs/core/adapters';
import { fillDefaults, type PropSchema } from '@bloklabs/core/adapters';
import { mountChildBlocks } from '@bloklabs/core/adapters';

import type { AngularBlockRenderContext, ChildAttributesFn } from './block-context';
import { BLOK_PORTAL_REGISTRY_CONFIG_KEY, type BlockPortalRegistry } from './block-portal-registry';

/**
 * Every STATIC member of core's block-tool contract an Angular block may declare
 * for itself — `ownsChildren`, `keepsChildrenOnEnter`, `conversionConfig`,
 * `pasteConfig`, `sanitize`, `shortcut`, `upgradeData`, and whatever core adds
 * next. Derived from
 * `BlockToolConstructable` rather than enumerated, so a new core static needs no
 * adapter change to become reachable.
 *
 * `toolbox` and `isReadOnlySupported` are excluded because the factory owns
 * them: `toolbox` is authored as {@link CreateAngularBlockSpec.toolbox}, and
 * in-place read-only support is unconditional.
 */
export type BlockToolStatics = Omit<BlockToolConstructable, 'toolbox' | 'isReadOnlySupported'>;

/** Statics the generated class owns; an authored `statics` bag can never take them over. */
const RESERVED_STATICS: readonly string[] = ['toolbox', 'isReadOnlySupported', '__isBlokAngularBlock'];

/**
 * Origins that mean "the author just made this block" — the only ones that fire
 * {@link CreateAngularBlockSpec.onCreated}. Written as an allow-list so a future
 * core origin fails CLOSED (no creation signal) instead of silently opting in.
 *
 * `undefined` is included because core always supplies an origin: an absent one
 * means a host hand-built the constructor options, which is an explicit
 * creation — the same reading core's own container tools apply.
 *
 * Note what is NOT the axis here: `origin === 'user'`. A container gated on that
 * alone would refuse to seed for `api.blocks.insert('steps')` and for a
 * turn-into, leaving an empty, unusable container.
 */
const CREATION_ORIGINS: ReadonlySet<BlockOrigin | undefined> = new Set<BlockOrigin | undefined>([
  undefined,
  'user',
  'api',
  'convert',
]);

/**
 * Announce that a container's child holders have settled in its slot — the
 * signal a host waits on before putting the caret into a freshly inserted
 * child.
 *
 * Optional-chained: the editor always supplies `events`, but a host unit test
 * may hand a block a partial `api`, and an observability signal must never be
 * able to break a render.
 * @param api - the editor-level API
 * @param blockId - the container block's id
 * @param children - the container's model children, in model order
 */
const emitChildrenMounted = (api: API, blockId: string, children: BlockAPI[]): void => {
  api?.events?.emit(BlockChildrenMounted, {
    blockId,
    childIds: children.map(child => child.id),
  });
};

/**
 * Second argument of {@link CreateAngularBlockSpec.onMounted} and
 * {@link CreateAngularBlockSpec.onCreated} — everything the block cannot read
 * off its own `BlockAPI`.
 */
export interface AngularBlockMountedContext {
  /**
   * Why this block instance was constructed: a CREATION origin (`user`, `api`,
   * `convert`) means the author just made it, so seeding default children is
   * correct; a RESTORE origin (`load`, `replay`, `paste`) means the document
   * already says what the children are. `probe` is an off-tree instance built
   * only to read a tool's default data — it must not touch the block tree at
   * all. Defaults to `'api'` when the constructor was handed no origin.
   */
  origin: BlockOrigin;
  /** The editor-level API (`api.blocks`, `api.caret`, `api.events`…). */
  api: API;
}

/** Spec for {@link createAngularBlock}. Authored as a standalone component. */
export interface CreateAngularBlockSpec<Data = BlockToolData> {
  /** Tool type name (registered key). */
  type: string;
  /** Optional toolbox entry. */
  toolbox?: ToolboxConfig;
  /** Declarative defaults that also define the exact `save()` key set. */
  propSchema: PropSchema;
  /**
   * The standalone Angular component to render for each block. It injects the
   * per-block context via `inject(BLOK_BLOCK_CONTEXT)`.
   */
  component: Type<unknown>;
  /**
   * Static members of core's tool contract, forwarded verbatim onto the
   * generated tool class — the single channel for everything core reads off the
   * CLASS rather than the instance (`ownsChildren`, `keepsChildrenOnEnter`,
   * `conversionConfig`, `pasteConfig`, `sanitize`, `shortcut`, `upgradeData`…).
   * Without it the only way to declare one was to subclass the generated class.
   *
   * `keepsChildrenOnEnter` is the per-tool Enter POLICY: declare it and Enter on
   * this container's empty LAST child creates the new line INSIDE the container
   * instead of escaping to the container's parent (Blok's default, which is
   * Notion's callout behaviour). Core cannot read that off the DOM — a callout
   * renders the same `data-blok-nested-blocks` slot as a column yet wants the
   * escape — so before it existed a layout container (a card, a `steps` block)
   * had to hijack the editor-global `config.onEnter` and re-derive containment.
   *
   * `toolbox` and `isReadOnlySupported` are owned by the factory and cannot be
   * overridden here (see {@link BlockToolStatics}).
   */
  statics?: BlockToolStatics;
  /**
   * The element the +/drag toolbar should vertically center on — core's
   * `getToolbarAnchorElement` hook, resolved against this block's host element
   * on every call (never cached, so it tracks re-renders).
   *
   * A container block whose own chrome is not editable needs it: with no anchor,
   * core centers the toolbar on the first `[contenteditable]` under the host,
   * which for a container is its FIRST CHILD BLOCK. Return `null`/`undefined`
   * (or omit the field) to keep core's default.
   * @param host - this block's mutation-free host element
   * @param block - this block's per-block API
   */
  getToolbarAnchorElement?: (host: HTMLElement, block: BlockAPI) => HTMLElement | null | undefined;
  /** Optional lifecycle callbacks mapped from Blok's block hooks. */
  onRendered?: (block: BlockAPI) => void;
  /**
   * Fired ONCE per block instance, once the component's DOM (and, for a
   * container, the child holders its `ctx.mountChildren` adopted) exists.
   * Angular mounts the block synchronously while core is still inside
   * `render()`, so this lands with `rendered()` — the first hook at which the
   * host is also in the document. The React and Vue adapters spell the same
   * contract; there it is genuinely LATER than `onRendered`, because their
   * portals commit a frame after core returns.
   *
   * It is also the create-vs-restore signal: `context.origin` says whether the
   * author just made this block (`user`/`api`/`convert`) or the document is
   * being re-materialised (`load`/`replay`/`paste`) — so a container can seed
   * its default children here exactly once, without the "children are
   * transiently empty during a replay" trap.
   * @example
   * ```ts
   * onMounted: (block, { origin, api }) => {
   *   if (origin === 'user' && block.getChildren().length === 0) {
   *     api.blocks.insertInsideParent(block.id);
   *   }
   * }
   * ```
   */
  onMounted?: (block: BlockAPI, context: AngularBlockMountedContext) => void;
  /**
   * The SEEDING hook: `onMounted`, narrowed to a genuine creation. Fired ONCE
   * per block instance, once the component's DOM exists, and only when this
   * instance is the author making a new block (`origin` of `user`, `api` or
   * `convert`) — never for a `load`/`replay`/`paste` restore, and never for the
   * off-tree `probe` instance core builds to read a tool's default data.
   *
   * That predicate is why the hook exists rather than leaving every block to
   * read `context.origin` in `onMounted`: the intuitive `origin === 'user'` test
   * is wrong. It drops `api.blocks.insert('steps')` and turn-into, so a
   * container seeded that way comes up empty for every path except a keystroke.
   * Core refused to ship that axis into its own `column`/`column_list`; this
   * encodes the correct one once, here.
   *
   * The `context` is the same object {@link CreateAngularBlockSpec.onMounted}
   * receives, so a block that only seeds can read `origin` for finer decisions.
   * @example
   * ```ts
   * onCreated: (block, { api }) => {
   *   if (block.getChildren().length === 0) {
   *     api.blocks.insertInsideParent(block.id);
   *   }
   * }
   * ```
   */
  onCreated?: (block: BlockAPI, context: AngularBlockMountedContext) => void;
  onMoved?: (block: BlockAPI) => void;
  onRemoved?: (block: BlockAPI) => void;
}

/**
 * Author a first-party Angular block. Returns a `BlockToolConstructable`
 * registered exactly like a vanilla tool (`tools: { type: { class:
 * createAngularBlock(...) } }`).
 *
 * The factory owns the host element (`data-blok-mutation-free`), a frozen
 * defaults-filled data mirror, and signals the component reads. It mounts the
 * component into the host via the editor's shared portal registry (the analog of
 * Vue's Teleport registry), bridging Blok's block lifecycle to Angular:
 * - `render()` creates the host and registers the portal entry (mounted sync).
 * - `setData()` dedups, swaps the reactive snapshot, flushes CD, resolves true.
 * - `save()` returns the complete frozen mirror (never the DOM, never partial).
 * - `commit()` merges a patch and fires `dispatchChange` exactly once.
 * - `setReadOnly()` flips a reactive flag and flushes CD (in-place, no remount).
 * - `removed()`/`destroy()` unregister the portal (deterministic unmount).
 */
export function createAngularBlock<Data = BlockToolData>(
  spec: CreateAngularBlockSpec<Data>
): (new (options: BlockToolConstructorOptions) => {
  render(): HTMLElement;
  save(): BlockToolData;
  setData(newData: BlockToolData): Promise<boolean>;
  setReadOnly(state: boolean): void;
  getToolbarAnchorElement(): HTMLElement | undefined;
  rendered(): void;
  moved(): void;
  removed(): void;
  destroy(): void;
}) & BlockToolStatics & {
  readonly __isBlokAngularBlock: true;
  readonly toolbox: ToolboxConfig | undefined;
  readonly isReadOnlySupported: boolean;
} {
  const AngularBlockTool = class AngularBlockTool {
    /** Marker so the directive can detect Angular-block tools and inject the registry. */
    public static readonly __isBlokAngularBlock = true as const;

    public static get toolbox(): ToolboxConfig | undefined {
      return spec.toolbox;
    }

    /**
     * Angular blocks support read-only mode: `setReadOnly` flips a reactive flag
     * the component reads, so the block re-renders read-only IN PLACE. Without
     * this static, core's ReadOnly module throws when read-only is enabled and an
     * Angular block is present.
     */
    public static get isReadOnlySupported(): boolean {
      return true;
    }

    private readonly blockApi: BlockAPI;
    /** The editor-level API, handed to the component as `ctx.api`. */
    private readonly api: API;
    private readonly registry: BlockPortalRegistry | undefined;
    private readonly pointerDrag: () => boolean;
    private readonly dataSig: WritableSignal<Readonly<Data>>;
    private readonly readOnlySig: WritableSignal<boolean>;
    private readonly ctx: AngularBlockRenderContext<Data>;
    private mirror: Readonly<Data>;
    /** Dedup baseline: skip a redundant flush of identical data. */
    private lastRendered: Readonly<Data>;
    private hostEl: HTMLElement | null = null;
    /** Last host passed to ctx.mountChildren, re-mounted on each data change. */
    private childHost: HTMLElement | null = null;
    /** Element the component handed to ctx.setToolbarAnchor, if any. */
    private anchorEl: HTMLElement | null = null;
    /**
     * Last per-child decorators passed to ctx.mountChildren; BOTH re-applied on
     * every remount (the author calls mountChildren once, the factory re-runs the
     * mount on each data change).
     */
    private childAttributes: ChildAttributesFn | undefined;
    private childContentAttributes: ChildAttributesFn | undefined;
    /** What the last decoration pass wrote, so a dropped key is cleaned up. */
    private readonly childLedger = createChildDecorationLedger();
    /** Why core built this instance — gates `onCreated`, handed to `onMounted`. */
    private readonly origin: BlockOrigin;
    /** True once the post-mount hooks fired; a repeated rendered() must not re-fire them. */
    private mountSignalled = false;
    /** True while a pointer drag suppresses dispatchChange. */
    private pendingDispatch = false;

    public constructor(options: BlockToolConstructorOptions) {
      this.blockApi = options.block;

      const config = (options.config ?? {}) as Record<string, unknown>;

      this.registry = config[BLOK_PORTAL_REGISTRY_CONFIG_KEY] as BlockPortalRegistry | undefined;

      this.api = options.api;

      // Read the LIVE pointer-drag flag so a mid-drag commit can be deferred
      // (core silently drops a dispatchChange while a drag is active).
      const drag = options.api as unknown as { blocks?: { isPointerDragActive?: boolean } } | undefined;

      this.pointerDrag = (): boolean => drag?.blocks?.isPointerDragActive === true;

      this.mirror = fillDefaults<Data>(spec.propSchema, (options.data ?? {}) as Record<string, unknown>);
      this.lastRendered = this.mirror;
      this.dataSig = signal(this.mirror);
      this.readOnlySig = signal(options.readOnly);
      // Absent origin means a caller that predates the signal; 'api' is core's
      // own default, so it is never mistaken for a user gesture.
      this.origin = options.origin ?? 'api';

      this.ctx = {
        data: this.dataSig.asReadonly(),
        commit: this.commit,
        block: this.blockApi,
        api: this.api,
        readOnly: this.readOnlySig.asReadonly(),
        mountChildren: this.mountChildren,
        setToolbarAnchor: this.setToolbarAnchor,
      };
    }

    public render(): HTMLElement {
      const host = document.createElement('div');

      // Core's MutationObserver ignores this subtree, so Angular's DOM writes
      // never register as a user edit.
      host.setAttribute('data-blok-mutation-free', 'true');
      this.hostEl = host;

      this.registry?.register(this.blockApi.id, {
        hostEl: host,
        component: spec.component,
        context: this.ctx as AngularBlockRenderContext<unknown>,
      });

      return host;
    }

    public rendered(): void {
      spec.onRendered?.(this.blockApi);

      // register() mounted the component and ran its first change detection
      // synchronously inside render(), and core has now put the host in the
      // document — so this is the settled moment. Once per instance: core
      // re-runs rendered() for a re-materialised block, and a repeated creation
      // signal would seed a container's default children twice. With no
      // registry (vanilla core, no directive) nothing was ever mounted, so
      // there is no settle to report — matching React/Vue, where the signal
      // originates in the component itself.
      if (this.registry === undefined || this.mountSignalled) {
        return;
      }

      this.mountSignalled = true;

      const context = { origin: this.origin, api: this.api };

      spec.onMounted?.(this.blockApi, context);

      // Creation-only, and after onMounted: a seeding hook must see whatever
      // the mount hook already put in place.
      if (CREATION_ORIGINS.has(this.origin)) {
        spec.onCreated?.(this.blockApi, context);
      }
    }

    public save(): BlockToolData {
      return this.mirror as BlockToolData;
    }

    public async setData(newData: BlockToolData): Promise<boolean> {
      const next = fillDefaults<Data>(spec.propSchema, (newData ?? {}) as Record<string, unknown>);

      // Dedup: identical data → skip the flush, but still return true so core
      // keeps the block in place (no remount).
      if (deepEqual(next, this.lastRendered)) {
        return true;
      }

      this.mirror = next;
      this.lastRendered = next;
      this.dataSig.set(next);
      // Synchronous CD: core drives setData outside NgZone, so nothing else
      // schedules a render. Never throw (a throw would make core remount).
      this.registry?.flush(this.blockApi.id);
      this.remountChildren();

      // Resolve after a microtask for interface symmetry with the async core
      // setData contract; CD has already flushed synchronously above.
      await Promise.resolve();

      return true;
    }

    /**
     * In-place read-only toggle. Flips the reactive flag the component reads via
     * `ctx.readOnly`, then flushes CD so the block re-renders read-only WITHOUT a
     * remount (ephemeral state survives). A prototype method (not an arrow field)
     * so core's `supportsInPlaceReadOnly` — which probes the PROTOTYPE — selects
     * the in-place path.
     */
    public setReadOnly(state: boolean): void {
      this.readOnlySig.set(state);
      this.registry?.flush(this.blockApi.id);
    }

    /**
     * Core's toolbar-anchor hook. Always defined so the delegation is one
     * `typeof … === 'function'` probe away, and always resolved fresh against
     * the LIVE host — the anchor element is Angular-rendered, so it does not
     * exist yet when the tool is constructed and may be replaced on any change
     * detection pass. A spec without a resolver returns undefined, which is
     * exactly what core's default positioning already assumes.
     */
    public getToolbarAnchorElement(): HTMLElement | undefined {
      /**
       * An element the component handed over wins — it is the exact node, chosen
       * from inside the template. `isConnected` is the guard that matters: a
       * component that re-renders its anchor can leave a detached node here, and
       * positioning the toolbar against one silently parks it at 0,0.
       */
      const declared = this.anchorEl;

      if (declared !== null && declared.isConnected) {
        return declared;
      }

      const host = this.hostEl;

      if (host === null || spec.getToolbarAnchorElement === undefined) {
        return undefined;
      }

      return spec.getToolbarAnchorElement(host, this.blockApi) ?? undefined;
    }

    /**
     * `ctx.setToolbarAnchor`. A bound field so the context object handed through
     * DI keeps a stable identity.
     * @param element - the anchor element, or null to fall back to the spec hook
     */
    private readonly setToolbarAnchor = (element: HTMLElement | null): void => {
      this.anchorEl = element;
    };

    public moved(): void {
      // No remount: core relocates the host element; the mounted view rides along
      // as its DOM children.
      spec.onMoved?.(this.blockApi);
    }

    public removed(): void {
      // Ownership-scoped: core composes a REPLACEMENT block (which mounts under
      // the SAME id) before it tears this one down, so an unqualified unregister
      // here would destroy the live componentRef and blank the block.
      this.registry?.unregister(this.blockApi.id, this.hostEl ?? undefined);
      spec.onRemoved?.(this.blockApi);
    }

    public destroy(): void {
      // Idempotent with removed(); unregister is safe when already absent.
      this.registry?.unregister(this.blockApi.id, this.hostEl ?? undefined);
    }

    /**
     * Container blocks: remember the host (and any per-child decorator) and
     * (re)mount the real child holders.
     */
    private readonly mountChildren = (
      host: HTMLElement,
      childAttributes?: ChildAttributesFn,
      childContentAttributes?: ChildAttributesFn
    ): void => {
      this.childHost = host;
      this.childAttributes = childAttributes;
      this.childContentAttributes = childContentAttributes;
      host.setAttribute(DATA_ATTR.nestedBlocks, '');
      this.remountChildren();
    };

    private remountChildren(): void {
      if (this.childHost === null) {
        return;
      }

      const children = this.blockApi.getChildren();

      mountChildBlocks(this.childHost, children);
      applyChildDecoration(this.childLedger, children, {
        childAttributes: this.childAttributes,
        childContentAttributes: this.childContentAttributes,
      });
      emitChildrenMounted(this.api, this.blockApi.id, children);
    }

    /**
     * The only data write path. Merges the patch into the frozen mirror, swaps
     * the reactive snapshot, flushes CD, and fires dispatchChange EXACTLY once —
     * deferring it while a pointer drag is active (core would otherwise silently
     * drop it).
     */
    private readonly commit = (patch: Partial<Data>): void => {
      const next = fillDefaults<Data>(spec.propSchema, {
        ...(this.mirror as Record<string, unknown>),
        ...(patch as Record<string, unknown>),
      });

      // Idempotent: a patch that changes nothing is a full no-op — no signal
      // swap, no CD flush, no dispatchChange — so an effect echoing the current
      // value back through commit can never loop.
      if (deepEqual(next, this.mirror)) {
        return;
      }

      this.mirror = next;
      this.lastRendered = next;
      this.dataSig.set(next);
      this.registry?.flush(this.blockApi.id);
      this.remountChildren();
      this.flushDispatch();
    };

    /** Dispatch the change, or retry on the next frame if a drag is in progress. */
    private flushDispatch(): void {
      if (!this.pointerDrag()) {
        this.pendingDispatch = false;
        this.blockApi.dispatchChange();

        return;
      }

      if (this.pendingDispatch) {
        return;
      }

      this.pendingDispatch = true;

      const retry = (): void => {
        if (this.pointerDrag()) {
          requestAnimationFrame(retry);

          return;
        }

        this.pendingDispatch = false;
        this.blockApi.dispatchChange();
      };

      requestAnimationFrame(retry);
    }
  };

  // Forward the authored statics onto the generated class. `defineProperty`
  // (not assignment) because `toolbox`/`isReadOnlySupported` are accessors and a
  // plain write would throw in strict mode; the reserved list keeps a stray bag
  // from taking those — or the adapter's own marker — over.
  for (const [key, value] of Object.entries(spec.statics ?? {})) {
    if (RESERVED_STATICS.includes(key)) {
      continue;
    }

    Object.defineProperty(AngularBlockTool, key, {
      value,
      writable: true,
      enumerable: true,
      configurable: true,
    });
  }

  return AngularBlockTool;
}
