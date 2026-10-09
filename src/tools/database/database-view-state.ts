import type { DatabaseViewConfig, DatabaseViewStateStore, PersonalViewPatch } from './types';

/** Synchronous per-browser storage; `api.viewState` scoped to the block in production. */
export interface ViewStateFallback {
  get(key: string): unknown;
  set(key: string, value: unknown): void;
}

export interface PersonalViewEditsOptions {
  /** The host lever. Without it, edits stay in this browser through `fallback`. */
  store?: DatabaseViewStateStore;
  fallback: ViewStateFallback;
  /** Called when edits load from the host store. */
  onChange: () => void;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** Keeps only the personal keys, each with the right outer shape. */
const sanitize = (value: unknown): PersonalViewPatch => {
  if (!isRecord(value)) return {};
  const patch: PersonalViewPatch = {};

  if (Array.isArray(value.filters)) patch.filters = value.filters as PersonalViewPatch['filters'];
  if (Array.isArray(value.sorts)) patch.sorts = value.sorts as PersonalViewPatch['sorts'];
  if (isRecord(value.filterTree) && Array.isArray(value.filterTree.filterRules)) {
    patch.filterTree = value.filterTree as PersonalViewPatch['filterTree'];
  }

  return patch;
};

const keyOf = (viewId: string): string => `view:${viewId}`;

/**
 * A person's unsaved filter and sort edits (decision D4). Notion keeps them
 * personal until "Save for everyone"; only that save writes the document.
 * Reads are synchronous from a cache, so a render never waits on the host.
 */
export class PersonalViewEdits {
  private readonly options: PersonalViewEditsOptions;
  private readonly cache = new Map<string, PersonalViewPatch>();

  constructor(options: PersonalViewEditsOptions) {
    this.options = options;
  }

  /** Fetches each view's edits from the host store. Without a store, the fallback is read lazily. */
  async load(viewIds: string[]): Promise<void> {
    const { store } = this.options;

    if (store === undefined) return;

    const loaded = await Promise.all(viewIds.map(async (viewId) => {
      try {
        return [viewId, sanitize(await store.get(viewId))] as const;
      } catch {
        return [viewId, {}] as const;
      }
    }));

    for (const [viewId, patch] of loaded) {
      this.cache.set(viewId, patch);
    }
    this.options.onChange();
  }

  get(viewId: string): PersonalViewPatch {
    const cached = this.cache.get(viewId);

    if (cached !== undefined) return cached;
    if (this.options.store !== undefined) return {};

    const patch = sanitize(this.readFallback(viewId));

    this.cache.set(viewId, patch);

    return patch;
  }

  has(viewId: string): boolean {
    return Object.keys(this.get(viewId)).length > 0;
  }

  /** Merges `patch` into the person's edits for the view. */
  set(viewId: string, patch: PersonalViewPatch): void {
    this.write(viewId, { ...this.get(viewId), ...patch });
  }

  clear(viewId: string): void {
    this.write(viewId, {});
  }

  /** The view as this person sees it. */
  effective(view: DatabaseViewConfig): DatabaseViewConfig {
    const patch = this.get(view.id);

    return Object.keys(patch).length === 0 ? view : { ...view, ...patch };
  }

  private write(viewId: string, patch: PersonalViewPatch): void {
    this.cache.set(viewId, patch);

    const { store, fallback } = this.options;

    if (store !== undefined) {
      store.set(viewId, patch).catch(() => undefined);

      return;
    }

    try {
      fallback.set(keyOf(viewId), Object.keys(patch).length === 0 ? undefined : structuredClone(patch));
    } catch {
      // Storage can be full or blocked; the edit still holds for this session.
    }
  }

  private readFallback(viewId: string): unknown {
    try {
      return this.options.fallback.get(keyOf(viewId));
    } catch {
      return undefined;
    }
  }
}
