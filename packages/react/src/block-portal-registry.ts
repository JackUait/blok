import type { ComponentType } from 'react';

/**
 * Tool-config key carrying the editor's portal registry into a
 * `createReactBlock` tool. The tool is constructed by CORE (outside any React
 * render), so it cannot read context — `useBlok` injects the editor-scoped
 * registry through each react-block tool's `config`, and the tool reads it here.
 */
export const BLOK_PORTAL_REGISTRY_CONFIG_KEY = '__blokPortalRegistry';

/**
 * One mounted React block in the portal registry. `hostEl` is the Blok-owned
 * `toolRenderedElement` (tagged `data-blok-mutation-free`) the component is
 * portaled into; `props` is replaced immutably by `setProps` so the mounted
 * component re-renders in place (no remount).
 */
export interface BlockPortalEntry {
  hostEl: HTMLElement;
  component: ComponentType<Record<string, unknown>>;
  props: Record<string, unknown>;
}

/**
 * Per-editor registry of React blocks. A single shared `BlockPortalHost`
 * renders one `createPortal` per entry, so every block lives in ONE React tree
 * (shared context, one reconciler) — the TipTap ReactNodeViewRenderer pattern,
 * not a `createRoot` per block.
 *
 * Shaped as an external store (`subscribe`/`getSnapshot`) so the host can read
 * it through `useSyncExternalStore`. The snapshot is immutable: every mutation
 * replaces it, and `getSnapshot` is referentially stable between mutations.
 */
export interface BlockPortalRegistry {
  /**
   * Register (or replace) the entry for `id`. Idempotent: a second register
   * for the same id replaces the entry rather than mounting a duplicate.
   */
  register(id: string, entry: BlockPortalEntry): void;
  /** Remove the entry for `id`. Safe (no-op) when absent. */
  unregister(id: string): void;
  /** Merge `props` into the entry's props (in-place update, no remount). */
  setProps(id: string, props: Record<string, unknown>): void;
  /** Subscribe to snapshot changes; returns the unsubscribe function. */
  subscribe(listener: () => void): () => void;
  /** Current immutable snapshot (stable identity until the next mutation). */
  getSnapshot(): ReadonlyMap<string, BlockPortalEntry>;
}

/**
 * Create a fresh portal registry. One per editor instance (associated via the
 * registry map, mirroring the holder WeakMap), so multiple editors on a page
 * never cross-render each other's blocks.
 */
export const createBlockPortalRegistry = (): BlockPortalRegistry => {
  const state = {
    snapshot: new Map<string, BlockPortalEntry>() as ReadonlyMap<string, BlockPortalEntry>,
  };
  const listeners = new Set<() => void>();

  const commit = (next: Map<string, BlockPortalEntry>): void => {
    state.snapshot = next;
    listeners.forEach(listener => listener());
  };

  return {
    register(id: string, entry: BlockPortalEntry): void {
      const next = new Map(state.snapshot);

      next.set(id, entry);
      commit(next);
    },
    unregister(id: string): void {
      if (!state.snapshot.has(id)) {
        return;
      }

      const next = new Map(state.snapshot);

      next.delete(id);
      commit(next);
    },
    setProps(id: string, props: Record<string, unknown>): void {
      const current = state.snapshot.get(id);

      if (current === undefined) {
        return;
      }

      const next = new Map(state.snapshot);

      next.set(id, { ...current, props: { ...current.props, ...props } });
      commit(next);
    },
    subscribe(listener: () => void): () => void {
      listeners.add(listener);

      return (): void => {
        listeners.delete(listener);
      };
    },
    getSnapshot(): ReadonlyMap<string, BlockPortalEntry> {
      return state.snapshot;
    },
  };
};
