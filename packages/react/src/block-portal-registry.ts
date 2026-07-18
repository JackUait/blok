import type { ComponentType } from 'react';

/**
 * Tool-config key carrying the editor's portal registry into a
 * `createReactBlock` tool. The tool is constructed by CORE (outside any React
 * render), so it cannot read context — `useBlok` injects the editor-scoped
 * registry through each react-block tool's `config`, and the tool reads it here.
 */
export const BLOK_PORTAL_REGISTRY_CONFIG_KEY = '__blokPortalRegistry';

/**
 * Tool-config key carrying the name the tool was registered under in the
 * consumer's `tools` map (injected next to the registry). The factory needs it
 * to associate portal entries with their tool so live config updates can be
 * routed; it is stripped (with the registry key) before the sanitized config
 * reaches the component.
 */
export const BLOK_TOOL_NAME_CONFIG_KEY = '__blokToolName';

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
  /** Name the tool is registered under — routes per-tool live config updates. */
  toolName?: string;
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
  /**
   * Replace the `config` prop of every entry registered under `toolName`, and
   * remember it so entries registered LATER start from this latest config
   * instead of their construction-time snapshot.
   */
  setToolConfig(toolName: string, config: Record<string, unknown>): void;
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
  /** Latest per-tool config, applied to mounted entries and future registers. */
  const toolConfigs = new Map<string, Record<string, unknown>>();

  const commit = (next: Map<string, BlockPortalEntry>): void => {
    state.snapshot = next;
    listeners.forEach(listener => listener());
  };

  return {
    register(id: string, entry: BlockPortalEntry): void {
      const next = new Map(state.snapshot);
      const liveConfig = entry.toolName === undefined ? undefined : toolConfigs.get(entry.toolName);

      next.set(
        id,
        liveConfig === undefined ? entry : { ...entry, props: { ...entry.props, config: liveConfig } }
      );
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
    setToolConfig(toolName: string, config: Record<string, unknown>): void {
      toolConfigs.set(toolName, config);

      const matching = [...state.snapshot].filter(([, entry]) => entry.toolName === toolName);

      if (matching.length === 0) {
        return;
      }

      const next = new Map(state.snapshot);

      for (const [id, entry] of matching) {
        next.set(id, { ...entry, props: { ...entry.props, config } });
      }

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
