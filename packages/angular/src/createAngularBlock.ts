// packages/angular/src/createAngularBlock.ts
import { signal, type Type, type WritableSignal } from '@angular/core';

import type { BlockAPI } from '@/types/api';
import type { BlockToolConstructorOptions, BlockToolData, ToolboxConfig } from '@/types/tools';
import { DATA_ATTR } from '@blok/core/adapters';
import { deepEqual } from '@blok/core/adapters';
import { fillDefaults, type PropSchema } from '@blok/core/adapters';
import { mountChildBlocks } from '@blok/core/adapters';

import type { AngularBlockRenderContext } from './block-context';
import { BLOK_PORTAL_REGISTRY_CONFIG_KEY, type BlockPortalRegistry } from './block-portal-registry';

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
  /** Optional lifecycle callbacks mapped from Blok's block hooks. */
  onRendered?: (block: BlockAPI) => void;
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
  rendered(): void;
  moved(): void;
  removed(): void;
  destroy(): void;
}) & {
  readonly __isBlokAngularBlock: true;
  readonly toolbox: ToolboxConfig | undefined;
  readonly isReadOnlySupported: boolean;
} {
  return class AngularBlockTool {
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
    /** True while a pointer drag suppresses dispatchChange. */
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
      this.dataSig = signal(this.mirror);
      this.readOnlySig = signal(options.readOnly);

      this.ctx = {
        data: this.dataSig.asReadonly(),
        commit: this.commit,
        block: this.blockApi,
        readOnly: this.readOnlySig.asReadonly(),
        mountChildren: this.mountChildren,
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

    public moved(): void {
      // No remount: core relocates the host element; the mounted view rides along
      // as its DOM children.
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

    /** Container blocks: remember the host and (re)mount the real child holders. */
    private readonly mountChildren = (host: HTMLElement): void => {
      this.childHost = host;
      host.setAttribute(DATA_ATTR.nestedBlocks, '');
      this.remountChildren();
    };

    private remountChildren(): void {
      if (this.childHost !== null) {
        mountChildBlocks(this.childHost, this.blockApi.getChildren());
      }
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
}
