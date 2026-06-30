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

import type { BlockAPI } from '../../types/api';
import type {
  BlockToolConstructorOptions,
  BlockToolData,
  ToolboxConfig,
} from '../../types/tools';
import { DATA_ATTR } from '../components/constants/data-attributes';
import { deepEqual } from '../shared/deep-equal';
import { mountChildBlocks } from '../tools/nested-blocks';

import {
  BLOK_PORTAL_REGISTRY_CONFIG_KEY,
  type BlockPortalRegistry,
} from './block-portal-registry';

/** One field of a {@link CreateVueBlockSpec.propSchema}. */
export interface PropSchemaEntry {
  /** Default value, used when the incoming data omits this key. */
  default: unknown;
  /** Optional allowed values (advisory; not enforced at runtime in v1). */
  values?: readonly unknown[];
}

/**
 * Declarative data shape. The keys here are EXACTLY the keys `save()` returns to
 * Yjs — this closes the per-key-sync key-resurrection gap (a cleared field is
 * written as its explicit default, never dropped).
 */
export type PropSchema = Record<string, PropSchemaEntry>;

/** Context handed to a Vue block's `setup` (the only data write path is `commit`). */
export interface VueBlockRenderProps<Data> {
  /** Reactive, FROZEN snapshot of the block data. Read `data.value`; never mutate. */
  data: ShallowRef<Readonly<Data>>;
  /** The ONLY data write path: merge a partial patch and sync once. */
  commit: (patch: Partial<Data>) => void;
  /** This block's per-block API (id, connection methods, dispatchChange…). */
  block: BlockAPI;
  /** Engine-owned child slot — render `h(BlockChildren)` for a container block. */
  BlockChildren: Component;
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
  /** Optional lifecycle callbacks mapped from Blok's block hooks. */
  onRendered?: (block: BlockAPI) => void;
  onMoved?: (block: BlockAPI) => void;
  onRemoved?: (block: BlockAPI) => void;
}

/**
 * Fill a data object against the schema: every schema key present, incoming
 * value when defined else the schema default, and ONLY schema keys (so `save()`
 * is never partial). Returns a frozen plain object — `toRaw`-clean, never a Vue
 * proxy — safe to hand straight to core's per-key Yjs sync.
 */
const fillDefaults = <Data>(schema: PropSchema, data: Record<string, unknown>): Readonly<Data> => {
  const result: Record<string, unknown> = {};

  for (const key of Object.keys(schema)) {
    result[key] = data[key] !== undefined ? data[key] : schema[key].default;
  }

  return Object.freeze(result) as Readonly<Data>;
};

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
  rendered(): void;
  moved(): void;
  removed(): void;
  destroy(): void;
}) & { readonly __isBlokVueBlock: true; readonly toolbox: ToolboxConfig | undefined } {
  // One wrapped component definition per TYPE; each block instance gets its own
  // context via the `ctx` prop, so Vue mounts a distinct instance per entry.
  const WrappedComponent = defineComponent({
    name: `VueBlock(${spec.type})`,
    props: {
      ctx: { type: Object as PropType<VueBlockRenderProps<Data>>, required: true },
    },
    setup(props) {
      // props is shallow-reactive: `props.ctx` is the raw context object, so the
      // `data` ref inside it is NOT unwrapped (no reactive ref-unwrap gotcha).
      return spec.setup(props.ctx);
    },
  });

  return class VueBlockTool {
    /** Marker so `useBlok` can detect vue-block tools and inject the registry. */
    public static readonly __isBlokVueBlock = true as const;

    public static get toolbox(): ToolboxConfig | undefined {
      return spec.toolbox;
    }

    private readonly blockApi: BlockAPI;
    private readonly registry: BlockPortalRegistry | undefined;
    private readonly pointerDrag: () => boolean;
    private readonly dataRef: ShallowRef<Readonly<Data>>;
    private readonly childrenComponent: Component;
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

      // Read the LIVE pointer-drag flag so a mid-drag commit can be deferred
      // (core silently drops a dispatchChange while a drag is active).
      const api = options.api as unknown as { blocks?: { isPointerDragActive?: boolean } } | undefined;

      this.pointerDrag = (): boolean => api?.blocks?.isPointerDragActive === true;

      this.mirror = fillDefaults<Data>(spec.propSchema, toRaw(options.data ?? {}) as Record<string, unknown>);
      this.lastRendered = this.mirror;
      this.dataRef = shallowRef(this.mirror);

      const blockApi = this.blockApi;

      // Per-instance child slot: a childless ref'd div Blok owns; mountChildBlocks
      // appends the real child holders imperatively (Vue never reconciles them).
      this.childrenComponent = defineComponent({
        name: `VueBlockChildren(${spec.type})`,
        setup() {
          const slot = ref<HTMLElement | null>(null);
          const mountKids = (): void => {
            if (slot.value !== null) {
              mountChildBlocks(slot.value, blockApi.getChildren());
            }
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
        BlockChildren: this.childrenComponent,
      };

      this.registry?.register(this.blockApi.id, {
        hostEl: host,
        component: WrappedComponent,
        props: { ctx },
      });

      // Returned synchronously; Vue flushes the teleport on the next tick.
      return host;
    }

    public rendered(): void {
      spec.onRendered?.(this.blockApi);
    }

    public save(): BlockToolData {
      // The complete, frozen, toRaw-clean mirror — never the DOM, never partial.
      return this.mirror as BlockToolData;
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

    public moved(): void {
      // No remount: Blok relocates the host element; the teleport follows it.
      spec.onMoved?.(this.blockApi);
    }

    public removed(): void {
      this.registry?.unregister(this.blockApi.id);
      spec.onRemoved?.(this.blockApi);
    }

    public destroy(): void {
      // Idempotent with removed(); unregister is safe when already absent.
      this.registry?.unregister(this.blockApi.id);
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
}
