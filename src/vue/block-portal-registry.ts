// src/vue/block-portal-registry.ts
import { markRaw, reactive, type Component } from 'vue';

/**
 * Tool-config key carrying the editor's portal registry into a `createVueBlock`
 * tool. The tool is constructed by CORE (outside any Vue `setup`), so it cannot
 * `inject()` — `useBlok` injects the editor-scoped registry through each
 * vue-block tool's `config`, and the tool reads it here.
 */
export const BLOK_PORTAL_REGISTRY_CONFIG_KEY = '__blokPortalRegistry';

/**
 * One mounted Vue block in the portal registry. `hostEl` is the Blok-owned
 * `toolRenderedElement` (tagged `data-blok-mutation-free`) the component is
 * teleported into; `props` is a REACTIVE object so `setProps` updates the
 * rendered block in place (no remount).
 */
export interface BlockPortalEntry {
  hostEl: HTMLElement;
  component: Component;
  props: Record<string, unknown>;
}

/**
 * Per-editor registry of Vue blocks. A single shared {@link BlockPortalHost}
 * renders one `<Teleport>` per entry, so every block lives in ONE render tree
 * (shared provide/inject + app plugins, one effect scope) — the TipTap
 * `VueNodeViewRenderer` pattern, not a Vue app per block.
 */
export interface BlockPortalRegistry {
  /** Reactive set of entries the host iterates (keyed by block id). */
  readonly entries: ReadonlyMap<string, BlockPortalEntry>;
  /**
   * Register (or replace) the entry for `id`. Idempotent: a second register
   * for the same id replaces the entry rather than mounting a duplicate.
   */
  register(id: string, entry: BlockPortalEntry): void;
  /** Remove the entry for `id`. Safe (no-op) when absent. */
  unregister(id: string): void;
  /** Merge `props` into the live entry's reactive props (in-place update). */
  setProps(id: string, props: Record<string, unknown>): void;
}

/**
 * Create a fresh portal registry. One per editor instance (associated via the
 * registry map, mirroring the holder WeakMap), so multiple editors on a page
 * never cross-render each other's blocks.
 */
export const createBlockPortalRegistry = (): BlockPortalRegistry => {
  // Vue's reactive Map tracks iteration (entries/size), so the host re-renders
  // on register/unregister.
  const entries = reactive(new Map<string, BlockPortalEntry>());

  return {
    entries: entries as ReadonlyMap<string, BlockPortalEntry>,
    register(id: string, entry: BlockPortalEntry): void {
      // markRaw so the reactive Map (which must still track add/delete) does NOT
      // deep-proxy the entry — a proxied component DEFINITION or DOM host would
      // break rendering ("received a Component made reactive"). Per-entry prop
      // reactivity, when needed, lives on the `props` object itself.
      // set() replaces an existing entry — idempotent, never duplicates.
      entries.set(id, markRaw(entry));
    },
    unregister(id: string): void {
      entries.delete(id);
    },
    setProps(id: string, props: Record<string, unknown>): void {
      const entry = entries.get(id);

      if (entry === undefined) {
        return;
      }

      // Mutate the reactive props object in place so the mounted component
      // re-renders without being remounted (preserving its internal state).
      Object.assign(entry.props, props);
    },
  };
};
