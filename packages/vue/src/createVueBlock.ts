// src/vue/createVueBlock.ts
import {
  defineComponent,
  h,
  nextTick,
  onMounted,
  onUpdated,
  ref,
  shallowRef,
  toRaw,
  type Component,
  type PropType,
  type ShallowRef,
  type VNodeChild,
} from 'vue';

import type { API } from '@/types';
import type { BlockAPI } from '@/types/api';
import type {
  BlockOrigin,
  BlockToolConstructable,
  BlockToolConstructorOptions,
  BlockToolData,
  ToolboxConfig,
} from '@/types/tools';
import { BlockChildrenMounted, DATA_ATTR , deepEqual , mountChildBlocks } from '@bloklabs/core/adapters';
import { fillDefaults, type PropSchema } from '@bloklabs/core/adapters';

import {
  BLOK_PORTAL_REGISTRY_CONFIG_KEY,
  type BlockPortalRegistry,
} from './block-portal-registry';

export type { PropSchema, PropSchemaEntry } from '@bloklabs/core/adapters';

/**
 * Every STATIC member of core's block-tool contract a Vue block may declare for
 * itself — `ownsChildren`, `keepsChildrenOnEnter`, `conversionConfig`,
 * `pasteConfig`, `sanitize`, `shortcut`, `upgradeData`, and whatever core adds
 * next. Derived from
 * `BlockToolConstructable` rather than enumerated, so a new core static needs no
 * adapter change to become reachable.
 *
 * `toolbox` and `isReadOnlySupported` are excluded because the factory owns
 * them: `toolbox` is authored as {@link CreateVueBlockSpec.toolbox}, and
 * in-place read-only support is unconditional.
 */
export type BlockToolStatics = Omit<BlockToolConstructable, 'toolbox' | 'isReadOnlySupported'>;

/** Statics the generated class owns; an authored `statics` bag can never take them over. */
const RESERVED_STATICS: readonly string[] = ['toolbox', 'isReadOnlySupported', '__isBlokVueBlock'];

/**
 * Origins that mean "the author just made this block" — the only ones that fire
 * {@link CreateVueBlockSpec.onCreated}. Written as an allow-list so a future
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
 * One child's decoration: attribute name → value. `null`/`undefined` removes the
 * attribute; a boolean or number is stringified (so `false` writes
 * `data-active="false"`, which CSS can select, rather than dropping the hook).
 */
export type ChildAttributes = Record<string, string | number | boolean | null | undefined>;

/** The `BlockChildren` per-child decorator (see {@link VueBlockRenderProps.BlockChildren}). */
export type ChildAttributesFn = (child: BlockAPI, index: number) => ChildAttributes;

/** What the previous decoration pass wrote for one child, so it can be undone. */
interface StampedChild {
  holder: HTMLElement;
  names: string[];
}

/**
 * Apply one pass of per-child holder attributes and clear the previous pass's
 * leftovers — including on a child that has since left the container, which
 * would otherwise keep a dead index forever.
 * @param stamped - the slot's ledger of what the last pass wrote (mutated)
 * @param children - the container's model children, in model order
 * @param decorate - the authored per-child decorator, if any
 */
const applyChildAttributes = (
  stamped: Map<string, StampedChild>,
  children: BlockAPI[],
  decorate: ChildAttributesFn | undefined
): void => {
  const next = new Map<string, StampedChild>();

  children.forEach((child, index) => {
    const names: string[] = [];

    for (const [name, value] of Object.entries(decorate?.(child, index) ?? {})) {
      if (value === null || value === undefined) {
        child.holder.removeAttribute(name);
        continue;
      }

      child.holder.setAttribute(name, String(value));
      names.push(name);
    }

    next.set(child.id, { holder: child.holder, names });
  });

  for (const [id, previous] of stamped) {
    const current = next.get(id);

    previous.names
      .filter(name => current === undefined || !current.names.includes(name))
      .forEach(name => previous.holder.removeAttribute(name));
  }

  stamped.clear();
  next.forEach((entry, id) => stamped.set(id, entry));
};

/**
 * Announce that a container's child holders have settled in its slot — the
 * signal a host waits on before putting the caret into a freshly inserted
 * child, since the teleport commits a tick after core's `rendered()`.
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

/** Context handed to a Vue block's `setup` (the only data write path is `commit`). */
export interface VueBlockRenderProps<Data> {
  /** Reactive, FROZEN snapshot of the block data. Read `data.value`; never mutate. */
  data: ShallowRef<Readonly<Data>>;
  /** The ONLY data write path: merge a partial patch and sync once. */
  commit: (patch: Partial<Data>) => void;
  /** This block's per-block API (id, connection methods, dispatchChange…). */
  block: BlockAPI;
  /**
   * The EDITOR-level API this block belongs to (`api.blocks`, `api.caret`,
   * `api.toolbar`…) — the same object a vanilla tool receives in its
   * constructor. Reach for it when a block has to drive the document around it
   * instead of routing everything through `block.call()` string dispatch.
   *
   * For the reactive, id/parentId-relative view of the tree (and to re-render
   * when your own children change), pair `useBlocks` with `useBlokInstance()`
   * instead — the api handle itself is not reactive.
   */
  api: API;
  /**
   * Reactive read-only flag. Read `readOnly.value` in render to disable editing
   * (e.g. drop `contenteditable`, hide controls). Toggled IN PLACE by core's
   * read-only switch — the component reacts without a remount, so ephemeral state
   * survives. Honor it: a block that ignores `readOnly` stays interactive when
   * the editor is read-only (same contract as a vanilla tool's `setReadOnly`).
   */
  readOnly: Readonly<ShallowRef<boolean>>;
  /**
   * Engine-owned child slot — render `h(BlockChildren)` for a container block.
   *
   * Accepts one optional prop, `childAttributes: (child, index) => ChildAttributes`,
   * applied to each child's HOLDER after the holders are mounted. Named hooks
   * (`data-step-index`, `data-active`…) replace positional `:nth-child()` CSS
   * over Blok's holders, which breaks the moment a child is inserted, removed or
   * reordered. The holders stay DIRECT children of the slot — core requires that
   * (hierarchy reparenting and caret navigation compare `holder.parentElement`
   * by identity), so decoration is attributes, never wrapper elements. Attributes
   * the callback stops producing are removed on the next pass.
   *
   * Writing on a child's holder is inert by design: core's mutation filter drops
   * a holder-targeted attribute record for the child block and suppresses it for
   * the container. The guarantee stops at the holder and its
   * `[data-blok-element-content]` wrapper — writing AT or BELOW a child's tool
   * root DOES score as that child's edit.
   */
  BlockChildren: Component;
}

/**
 * Second argument of {@link CreateVueBlockSpec.onMounted} and
 * {@link CreateVueBlockSpec.onCreated} — everything the block cannot read off
 * its own `BlockAPI`.
 */
export interface VueBlockMountedContext {
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

/** Spec for {@link createVueBlock}. Authored as a `.ts` render function (no SFC). */
export interface CreateVueBlockSpec<Data = BlockToolData> {
  /** Tool type name (registered key). */
  type: string;
  /** Optional toolbox entry. */
  toolbox?: ToolboxConfig;
  /** Declarative defaults that also define the exact `save()` key set. */
  propSchema: PropSchema;
  /** Returns a render function (the `defineComponent` + `setup`-returns-`h` shape). */
  setup: (props: VueBlockRenderProps<Data>) => () => VNodeChild;
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
   * Fired ONCE per block instance, after the teleport's FIRST commit — the
   * first moment this block's rendered DOM exists (and, for a container, the
   * moment `BlockChildren` has adopted the child holders). `onRendered` cannot
   * mean that: core calls `rendered()` in the same tick as `render()`, before
   * Vue has drawn anything, which is why hosts ended up setting the caret twice
   * around a `requestAnimationFrame`.
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
  onMounted?: (block: BlockAPI, context: VueBlockMountedContext) => void;
  /**
   * The SEEDING hook: `onMounted`, narrowed to a genuine creation. Fired ONCE
   * per block instance, after the teleport's first commit, and only when this
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
   * The `context` is the same object {@link CreateVueBlockSpec.onMounted}
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
  onCreated?: (block: BlockAPI, context: VueBlockMountedContext) => void;
  onMoved?: (block: BlockAPI) => void;
  onRemoved?: (block: BlockAPI) => void;
}

/**
 * Author a first-party Vue block. Returns a `BlockToolConstructable` registered
 * exactly like a vanilla tool (`tools: { type: { class: createVueBlock(...) } }`).
 *
 * The factory owns the host element (`data-blok-mutation-free`), a frozen
 * defaults-filled data mirror, and a reactive `shallowRef` the component reads.
 * It teleports the component into the host via the editor's shared portal
 * registry (the TipTap `VueNodeViewRenderer` pattern), and bridges Blok's block
 * lifecycle to Vue:
 * - `render()` creates the host and registers the portal entry (returned sync).
 * - `setData()` is async: it dedups, swaps the reactive snapshot, and `await`s
 *   Vue's commit before resolving `true` — defeating core's default remount and
 *   landing the update inside core's RAF-extended Yjs suppression window.
 * - `save()` returns the complete frozen mirror (never the DOM, never partial).
 * - `commit()` merges a patch and fires `dispatchChange` exactly once.
 * - `removed()`/`destroy()` unregister the portal (deterministic unmount).
 */
export function createVueBlock<Data = BlockToolData>(
  spec: CreateVueBlockSpec<Data>
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
  readonly __isBlokVueBlock: true;
  readonly toolbox: ToolboxConfig | undefined;
  readonly isReadOnlySupported: boolean;
} {
  /**
   * One wrapped component definition per BLOCK INSTANCE.
   *
   * Per-TYPE looks equivalent — each instance gets its own context through the
   * `ctx` prop — but the portal host keys its `<Teleport>` by BLOCK ID, and core
   * composes a replacement block (registering under that same id) BEFORE it
   * destroys the block it replaces. With a shared type, Vue sees same key + same
   * type and PATCHES the mounted instance instead of replacing it: `setup` has
   * already run and its render closure captured the SUPERSEDED instance's `ctx`,
   * so the live host renders the old block's data forever. A distinct type per
   * instance makes Vue replace the instance, so the replacement's ctx renders.
   * Within one instance the type is stable, so in-place prop updates still never
   * remount.
   */
  const defineWrappedComponent = (): Component =>
    defineComponent({
      name: `VueBlock(${spec.type})`,
      props: {
        ctx: { type: Object as PropType<VueBlockRenderProps<Data>>, required: true },
        /**
         * Adapter-internal: the tool instance's post-commit notifier. Declared as
         * a prop (not part of `ctx`) so it never reaches the authored `setup`.
         */
        notifyMounted: { type: Function as PropType<() => void>, default: undefined },
      },
      setup(props) {
        // The block's DOM exists from here on — this is the first commit core's
        // `rendered()` hook could not wait for.
        onMounted(() => props.notifyMounted?.());

        // props is shallow-reactive: `props.ctx` is the raw context object, so the
        // `data` ref inside it is NOT unwrapped (no reactive ref-unwrap gotcha).
        return spec.setup(props.ctx);
      },
    });

  const VueBlockTool = class VueBlockTool {
    /** Marker so `useBlok` can detect vue-block tools and inject the registry. */
    public static readonly __isBlokVueBlock = true as const;

    public static get toolbox(): ToolboxConfig | undefined {
      return spec.toolbox;
    }

    /**
     * Vue blocks support read-only mode: `setReadOnly` flips a reactive flag the
     * component reads, so the block re-renders read-only IN PLACE. Without this
     * flag core's ReadOnly module throws a critical error when read-only is
     * enabled and a Vue block is present.
     */
    public static get isReadOnlySupported(): boolean {
      return true;
    }

    private readonly blockApi: BlockAPI;
    /** The editor-level API, handed to the block setup as `ctx.api`. */
    private readonly api: API;
    private readonly registry: BlockPortalRegistry | undefined;
    private readonly pointerDrag: () => boolean;
    private readonly dataRef: ShallowRef<Readonly<Data>>;
    /** Reactive read-only flag handed to setup; flipped in place by setReadOnly. */
    private readonly readOnlyRef: ShallowRef<boolean>;
    private readonly childrenComponent: Component;
    /** This instance's own wrapper type — see {@link defineWrappedComponent}. */
    private readonly wrappedComponent: Component = defineWrappedComponent();
    /** Why core built this instance — gates `onCreated`, handed to `onMounted`. */
    private readonly origin: BlockOrigin;
    /** True once the post-mount hooks fired; a re-mounted teleport must not re-fire them. */
    private mountSignalled = false;
    private mirror: Readonly<Data>;
    /** Dedup baseline (Risk R3/R6): skip a redundant render of identical data. */
    private lastRendered: Readonly<Data>;
    private hostEl: HTMLElement | null = null;
    /** Latest patch queued while a pointer drag suppresses dispatchChange. */
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

      this.mirror = fillDefaults<Data>(spec.propSchema, toRaw(options.data ?? {}) as Record<string, unknown>);
      this.lastRendered = this.mirror;
      this.dataRef = shallowRef(this.mirror);
      this.readOnlyRef = shallowRef(options.readOnly);
      // Absent origin means a caller that predates the signal; 'api' is core's
      // own default, so it is never mistaken for a user gesture.
      this.origin = options.origin ?? 'api';

      const blockApi = this.blockApi;
      const api = this.api;

      // Per-instance child slot: a childless ref'd div Blok owns; mountChildBlocks
      // appends the real child holders imperatively (Vue never reconciles them).
      this.childrenComponent = defineComponent({
        name: `VueBlockChildren(${spec.type})`,
        props: {
          childAttributes: {
            type: Function as PropType<ChildAttributesFn>,
            default: undefined,
          },
        },
        setup(props) {
          const slot = ref<HTMLElement | null>(null);
          // What the last decoration pass wrote, so a dropped key is cleaned up.
          const stamped = new Map<string, StampedChild>();
          const mountKids = (): void => {
            if (slot.value === null) {
              return;
            }

            const children = blockApi.getChildren();

            mountChildBlocks(slot.value, children);
            applyChildAttributes(stamped, children, props.childAttributes);
            emitChildrenMounted(api, blockApi.id, children);
          };

          onMounted(mountKids);
          onUpdated(mountKids);

          return () => h('div', { ref: slot, [DATA_ATTR.nestedBlocks]: '' });
        },
      });
    }

    public render(): HTMLElement {
      const host = document.createElement('div');

      // The Blok-owned host: Vue reconciles the chrome teleported INTO it, but
      // this attribute makes core's MutationObserver ignore those mutations, so
      // Vue's reconciliation never registers as a user edit.
      host.setAttribute('data-blok-mutation-free', 'true');
      this.hostEl = host;

      const ctx: VueBlockRenderProps<Data> = {
        data: this.dataRef,
        commit: this.commit,
        block: this.blockApi,
        api: this.api,
        readOnly: this.readOnlyRef,
        BlockChildren: this.childrenComponent,
      };

      this.registry?.register(this.blockApi.id, {
        hostEl: host,
        component: this.wrappedComponent,
        props: { ctx, notifyMounted: this.notifyMounted },
      });

      // Returned synchronously; Vue flushes the teleport on the next tick.
      return host;
    }

    public rendered(): void {
      spec.onRendered?.(this.blockApi);
    }

    /**
     * The wrapped component's post-commit callback: the first moment this
     * block's DOM (and, for a container, its mounted child holders) exists.
     * Fires the post-mount hooks once per block instance — a teleport that
     * re-mounts must not repeat a creation signal.
     */
    private readonly notifyMounted = (): void => {
      if (this.mountSignalled) {
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
    };

    public save(): BlockToolData {
      // The complete, frozen, toRaw-clean mirror — never the DOM, never partial.
      return this.mirror;
    }

    public async setData(newData: BlockToolData): Promise<boolean> {
      const next = fillDefaults<Data>(spec.propSchema, toRaw(newData ?? {}));

      // Dedup (Risk R3): identical data → skip the render entirely, but still
      // return true so core keeps the block in place (no remount).
      if (deepEqual(next, this.lastRendered)) {
        return true;
      }

      this.mirror = next;
      this.lastRendered = next;
      this.dataRef.value = next;

      // Await Vue's commit. Core drives setData asynchronously inside its
      // RAF-extended Yjs-suppression window, so awaiting nextTick lands the
      // re-render before suppression lifts — without ever remounting.
      await nextTick();

      return true;
    }

    /**
     * In-place read-only toggle. Flips the reactive flag the component reads via
     * `ctx.readOnly`, so the block re-renders read-only WITHOUT a remount
     * (ephemeral component state survives). A regular prototype method (not an
     * arrow field) so core's `supportsInPlaceReadOnly` — which probes the
     * constructable's PROTOTYPE for `setReadOnly` — selects the in-place path.
     */
    public setReadOnly(state: boolean): void {
      this.readOnlyRef.value = state;
    }

    /**
     * Core's toolbar-anchor hook. Always defined so the delegation is one
     * `typeof … === 'function'` probe away, and always resolved fresh against
     * the LIVE host — the anchor element is Vue-rendered, so it does not exist
     * yet when the tool is constructed and may be replaced on any re-render. A
     * spec without a resolver returns undefined, which is exactly what core's
     * default positioning already assumes.
     */
    public getToolbarAnchorElement(): HTMLElement | undefined {
      const host = this.hostEl;

      if (host === null || spec.getToolbarAnchorElement === undefined) {
        return undefined;
      }

      return spec.getToolbarAnchorElement(host, this.blockApi) ?? undefined;
    }

    public moved(): void {
      // No remount: Blok relocates the host element; the teleport follows it.
      spec.onMoved?.(this.blockApi);
    }

    public removed(): void {
      // Ownership-scoped: core composes a REPLACEMENT block (which registers
      // under the SAME id) before it tears this one down, so an unqualified
      // unregister here would delete the live entry and blank the block.
      this.registry?.unregister(this.blockApi.id, this.hostEl ?? undefined);
      spec.onRemoved?.(this.blockApi);
    }

    public destroy(): void {
      // Idempotent with removed(); unregister is safe when already absent.
      this.registry?.unregister(this.blockApi.id, this.hostEl ?? undefined);
    }

    /**
     * The only data write path. Merges the patch into the frozen mirror, swaps
     * the reactive snapshot, records the dedup baseline, and fires
     * dispatchChange EXACTLY once — deferring it while a pointer drag is active
     * (core would otherwise silently drop it).
     */
    private readonly commit = (patch: Partial<Data>): void => {
      const next = fillDefaults<Data>(spec.propSchema, {
        ...(this.mirror as Record<string, unknown>),
        ...(patch as Record<string, unknown>),
      });

      // Idempotent: a patch that changes nothing is a full no-op — no reactive
      // swap, no dispatchChange — so a watcher echoing the current value back
      // through commit can never loop.
      if (deepEqual(next, this.mirror)) {
        return;
      }

      this.mirror = next;
      this.lastRendered = next;
      this.dataRef.value = next;

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

    Object.defineProperty(VueBlockTool, key, {
      value,
      writable: true,
      enumerable: true,
      configurable: true,
    });
  }

  return VueBlockTool;
}
