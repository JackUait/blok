import { useEffect, useRef, type ComponentType, type ReactElement } from 'react';
import { flushSync } from 'react-dom';
import { DATA_ATTR, deepEqual, fillDefaults, mountChildBlocks, type PropSchema } from '@bloklabs/core/adapters';
import {
  BLOK_PORTAL_REGISTRY_CONFIG_KEY,
  type BlockPortalRegistry,
} from './block-portal-registry';
import type { BlockAPI } from '@/types/api';
import type { BlockToolConstructorOptions, BlockToolData, ToolboxConfig } from '@/types/tools';

export type { PropSchema, PropSchemaEntry } from '@bloklabs/core/adapters';

/** Props handed to a React block's `component` (the only data write path is `commit`). */
export interface ReactBlockRenderProps<Data> {
  /** Frozen snapshot of the block data. Re-rendered with a new value on change; never mutate. */
  data: Readonly<Data>;
  /** The ONLY data write path: merge a partial patch and sync once. */
  commit: (patch: Partial<Data>) => void;
  /** This block's per-block API (id, connection methods, dispatchChange…). */
  block: BlockAPI;
  /**
   * Read-only flag. Render disabled/inert UI when true (e.g. drop
   * `contentEditable`, hide controls). Toggled IN PLACE by core's read-only
   * switch — the component re-renders without remounting, so ephemeral state
   * survives. Honor it: a block that ignores `readOnly` stays interactive when
   * the editor is read-only (same contract as a vanilla tool's `setReadOnly`).
   */
  readOnly: boolean;
  /** Engine-owned child slot — render `<BlockChildren />` for a container block. */
  BlockChildren: ComponentType;
}

/** Spec for {@link createReactBlock}. */
export interface CreateReactBlockSpec<Data = BlockToolData> {
  /** Tool type name (registered key). */
  type: string;
  /** Optional toolbox entry. */
  toolbox?: ToolboxConfig;
  /** Declarative defaults that also define the exact `save()` key set. */
  propSchema: PropSchema;
  /** The component rendered for each block instance. */
  component: ComponentType<ReactBlockRenderProps<Data>>;
  /** Optional lifecycle callbacks mapped from Blok's block hooks. */
  onRendered?: (block: BlockAPI) => void;
  onMoved?: (block: BlockAPI) => void;
  onRemoved?: (block: BlockAPI) => void;
}

/**
 * Author a first-party React block. Returns a `BlockToolConstructable`
 * registered exactly like a vanilla tool (`tools: { type: createReactBlock(...) }`).
 *
 * The factory owns the host element (`data-blok-mutation-free`), a frozen
 * defaults-filled data mirror, and the entry props the component reads. It
 * portals the component into the host via the editor's shared portal registry
 * (the TipTap `ReactNodeViewRenderer` pattern) — every block renders inside the
 * SAME React tree that renders `BlokContent`, so app-level context (themes,
 * design-system providers, stores) flows into blocks with no bridge. Blok's
 * block lifecycle maps to React:
 * - `render()` creates the host and registers the portal entry (returned sync).
 * - `setData()` dedups, pushes the new snapshot, and flushes React's commit
 *   before resolving `true` — defeating core's default remount.
 * - `save()` returns the complete frozen mirror (never the DOM, never partial).
 * - `commit()` merges a patch and fires `dispatchChange` exactly once.
 * - `removed()`/`destroy()` unregister the portal (deterministic unmount).
 */
export function createReactBlock<Data = BlockToolData>(
  spec: CreateReactBlockSpec<Data>
): (new (options: BlockToolConstructorOptions) => {
  render(): HTMLElement;
  save(): BlockToolData;
  setData(newData: BlockToolData): Promise<boolean>;
  setReadOnly(state: boolean): void;
  rendered(): void;
  moved(): void;
  removed(): void;
  destroy(): void;
}) & {
  readonly __isBlokReactBlock: true;
  readonly toolbox: ToolboxConfig | undefined;
  readonly isReadOnlySupported: boolean;
} {
  return class ReactBlockTool {
    /** Marker so `useBlok` can detect react-block tools and inject the registry. */
    public static readonly __isBlokReactBlock = true as const;

    public static get toolbox(): ToolboxConfig | undefined {
      return spec.toolbox;
    }

    /**
     * React blocks support read-only mode: `setReadOnly` pushes a new prop the
     * component reads, so the block re-renders read-only IN PLACE. Without this
     * flag core's ReadOnly module throws a critical error when read-only is
     * enabled and a React block is present.
     */
    public static get isReadOnlySupported(): boolean {
      return true;
    }

    private readonly blockApi: BlockAPI;
    private readonly registry: BlockPortalRegistry | undefined;
    private readonly pointerDrag: () => boolean;
    private readonly childrenComponent: ComponentType;
    private mirror: Readonly<Data>;
    /** Dedup baseline: skip a redundant render of identical data. */
    private lastRendered: Readonly<Data>;
    /** Read-only flag mirrored into the entry props by setReadOnly. */
    private readOnly: boolean;
    private hostEl: HTMLElement | null = null;
    /** True while a deferred dispatch is waiting for a pointer drag to end. */
    private pendingDispatch = false;

    public constructor(options: BlockToolConstructorOptions) {
      this.blockApi = options.block;

      const config = (options.config ?? {}) as Record<string, unknown>;

      this.registry = config[BLOK_PORTAL_REGISTRY_CONFIG_KEY] as BlockPortalRegistry | undefined;

      // Read the LIVE pointer-drag flag so a mid-drag commit can be deferred
      // (core silently drops a dispatchChange while a drag is active).
      const api = options.api as unknown as { blocks?: { isPointerDragActive?: boolean } } | undefined;

      this.pointerDrag = (): boolean => api?.blocks?.isPointerDragActive === true;

      this.mirror = fillDefaults<Data>(spec.propSchema, (options.data ?? {}) as Record<string, unknown>);
      this.lastRendered = this.mirror;
      this.readOnly = options.readOnly;

      const blockApi = this.blockApi;

      // Per-instance child slot: a childless ref'd div Blok owns; mountChildBlocks
      // appends the real child holders imperatively (React never reconciles them).
      this.childrenComponent = function BlockChildren(): ReactElement {
        const slotRef = useRef<HTMLDivElement | null>(null);

        // No dep array: re-adopt children after EVERY render (mirrors the Vue
        // adapter's onMounted + onUpdated pair).
        useEffect(() => {
          if (slotRef.current !== null) {
            mountChildBlocks(slotRef.current, blockApi.getChildren());
          }
        });

        return <div ref={slotRef} {...{ [DATA_ATTR.nestedBlocks]: '' }} />;
      };
    }

    public render(): HTMLElement {
      const host = document.createElement('div');

      // The Blok-owned host: React reconciles the chrome portaled INTO it, but
      // this attribute makes core's MutationObserver ignore those mutations, so
      // React's reconciliation never registers as a user edit.
      host.setAttribute('data-blok-mutation-free', 'true');
      this.hostEl = host;

      this.registry?.register(this.blockApi.id, {
        hostEl: host,
        component: spec.component as unknown as ComponentType<Record<string, unknown>>,
        props: this.buildProps(),
      });

      // Returned synchronously; React flushes the portal on its next commit.
      return host;
    }

    public rendered(): void {
      spec.onRendered?.(this.blockApi);
    }

    public save(): BlockToolData {
      // The complete, frozen mirror — never the DOM, never partial.
      return this.mirror as BlockToolData;
    }

    public async setData(newData: BlockToolData): Promise<boolean> {
      const next = fillDefaults<Data>(spec.propSchema, newData ?? {});

      // Dedup: identical data → skip the render entirely, but still return true
      // so core keeps the block in place (no remount).
      if (deepEqual(next, this.lastRendered)) {
        return true;
      }

      this.mirror = next;
      this.lastRendered = next;

      // Flush React's commit before resolving. Core drives setData inside its
      // RAF-extended Yjs-suppression window, so the re-render must land before
      // suppression lifts — without ever remounting.
      this.pushProps({ data: next });

      return true;
    }

    /**
     * In-place read-only toggle. Pushes a new `readOnly` prop the component
     * reads, so the block re-renders read-only WITHOUT a remount (ephemeral
     * component state survives). A regular prototype method (not an arrow
     * field) so core's `supportsInPlaceReadOnly` — which probes the
     * constructable's PROTOTYPE for `setReadOnly` — selects the in-place path.
     */
    public setReadOnly(state: boolean): void {
      this.readOnly = state;
      this.pushProps({ readOnly: state });
    }

    public moved(): void {
      // No remount: Blok relocates the host element; the portal follows it.
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

    /** The full entry props handed to the component on (re-)register. */
    private buildProps(): Record<string, unknown> {
      const props: ReactBlockRenderProps<Data> = {
        data: this.mirror,
        commit: this.commit,
        block: this.blockApi,
        readOnly: this.readOnly,
        BlockChildren: this.childrenComponent,
      };

      return props as unknown as Record<string, unknown>;
    }

    /** Push a prop patch to the mounted component and flush React's commit. */
    private pushProps(props: Record<string, unknown>): void {
      const registry = this.registry;

      if (registry === undefined) {
        return;
      }

      // setData/setReadOnly arrive from core outside React's render phase, so a
      // synchronous flush is safe and makes the DOM update deterministic.
      flushSync(() => {
        registry.setProps(this.blockApi.id, props);
      });
    }

    /**
     * The only data write path. Merges the patch into the frozen mirror, pushes
     * the new snapshot, records the dedup baseline, and fires dispatchChange
     * EXACTLY once — deferring it while a pointer drag is active (core would
     * otherwise silently drop it).
     */
    private readonly commit = (patch: Partial<Data>): void => {
      const next = fillDefaults<Data>(spec.propSchema, {
        ...(this.mirror as Record<string, unknown>),
        ...(patch as Record<string, unknown>),
      });

      this.mirror = next;
      this.lastRendered = next;
      // No flushSync here: commit is called from React event handlers (inside a
      // render batch), where a sync flush is illegal — the normal async commit
      // is fine because the change originates from the component itself.
      this.registry?.setProps(this.blockApi.id, { data: next });

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
