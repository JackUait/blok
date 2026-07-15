import {
  inject,
  onBeforeUnmount,
  onMounted,
  shallowRef,
  toRaw,
  toValue,
  watch,
  type MaybeRefOrGetter,
  type Ref,
} from 'vue';
import { Blok as BlokRuntime } from '@blok/core';
import { setHolder, removeHolder } from './holder-map';
import { deepEqual , normalizeReadOnlyConfig } from '@blok/core/adapters';
import { BLOK_DEFAULT_CONFIG, mergeBlokDefaults } from './provide-blok';
import {
  createBlockPortalRegistry,
  BLOK_PORTAL_REGISTRY_CONFIG_KEY,
  type BlockPortalRegistry,
} from './block-portal-registry';
import { setRegistry, removeRegistry } from './registry-map';
import type { Blok, OutputData } from '@/types';
import type { UseBlokConfig } from './types';

/**
 * Inject the editor's portal registry into every `createVueBlock` tool's config
 * (vanilla tools are left untouched), returning a NEW tools object so the
 * consumer's config is never mutated. A vue-block tool is constructed by CORE,
 * outside any Vue `setup`, so it cannot `inject()` — this config bridge is how
 * the tool reaches its editor-scoped registry.
 */
const injectPortalRegistry = (tools: unknown, registry: BlockPortalRegistry): unknown => {
  if (tools === null || typeof tools !== 'object') {
    return tools;
  }

  const result: Record<string, unknown> = {};

  for (const [name, entry] of Object.entries(tools as Record<string, unknown>)) {
    const toolClass = typeof entry === 'function' ? entry : (entry as { class?: unknown })?.class;
    const isVueBlock =
      typeof toolClass === 'function' && (toolClass as { __isBlokVueBlock?: boolean }).__isBlokVueBlock === true;

    if (!isVueBlock) {
      result[name] = entry;

      continue;
    }

    const base: Record<string, unknown> =
      typeof entry === 'function' ? { class: entry } : { ...(entry as Record<string, unknown>) };

    base.config = {
      ...((base.config as Record<string, unknown> | undefined) ?? {}),
      [BLOK_PORTAL_REGISTRY_CONFIG_KEY]: registry,
    };
    result[name] = base;
  }

  return result;
};

/**
 * Composable that manages a Blok editor instance lifecycle.
 *
 * Creates a detached holder div, instantiates Blok with a plain (de-proxied)
 * config, and exposes the instance through the returned ref once `isReady`
 * resolves. Destroys the editor on unmount. The instance is published only when
 * the resolving editor is still the current one (identity guard), so a late
 * `isReady` from a superseded editor never leaks.
 *
 * @param config - reactive config source (ref/getter) without `holder`
 * @returns a ref to the live Blok instance, or null before ready / after destroy
 */
export function useBlok(
  config: MaybeRefOrGetter<UseBlokConfig>,
  recreateKey?: MaybeRefOrGetter<unknown>
): Ref<Blok | null> {
  // shallowRef (not ref): the live Blok instance must be stored as-is. A deep
  // ref would wrap core in a reactive proxy, breaking its identity checks and
  // handing consumers a proxy instead of the real editor.
  const editor = shallowRef<Blok | null>(null);

  // App-wide defaults from the nearest `provideBlok()`, injected once (the Vue
  // analog of React's `useContext(BlokDefaultsContext)`). Merged UNDER the
  // per-instance config so the escape-hatch path (`useBlok` + `BlokContent`)
  // honors them exactly like `<BlokEditor>`. `inject` must run synchronously in
  // `setup`, hence at the top of the composable.
  const defaults = inject(BLOK_DEFAULT_CONFIG, {});

  /** Per-instance config with `provideBlok` defaults merged under it (instance wins). */
  const mergedConfig = (): UseBlokConfig => mergeBlokDefaults(defaults, toValue(config));

  // Mutable adapter state (held in one object to avoid `let` reassignment):
  // - `current` is the editor that should own the holder/ref; it guards async
  //   isReady resolution against a stale editor (e.g. after a recreate).
  // - `lastRenderedData` is the content the editor currently reflects, updated
  //   when `data` is seeded/rendered AND when the editor emits its own serialized
  //   output via the `onSave` wrapper — so a controlled `update:data -> data`
  //   echo deep-equals this baseline and is deduped to a no-op (no caret reset).
  const state: {
    current: Blok | null;
    holder: HTMLDivElement | null;
    lastRenderedData: OutputData | undefined;
    seededEditor: Blok | null;
    renderChain: Promise<void>;
  } = {
    current: null,
    holder: null,
    lastRenderedData: mergedConfig().data,
    seededEditor: null,
    renderChain: Promise.resolve(),
  };

  /**
   * Snapshot the reactive config into a plain object for core. `toRaw` unwraps
   * the config and its `data` so no Vue reactive proxy reaches core (Risk R0):
   * proxies would break core's identity checks and the holder WeakMap key.
   */
  const buildConfig = (): Record<string, unknown> => {
    // Merge `provideBlok` defaults under the raw per-instance config, then
    // de-proxy. `toRaw` unwraps both the config and its `data` so no Vue reactive
    // proxy reaches core (Risk R0): proxies would break core's identity checks
    // and the holder WeakMap key.
    const snapshot = { ...mergeBlokDefaults(toRaw(defaults), toRaw(toValue(config))) } as Record<string, unknown>;

    delete snapshot.holder;

    if (snapshot.data !== undefined) {
      snapshot.data = toRaw(snapshot.data);
    }

    return snapshot;
  };

  const teardown = (): void => {
    if (state.current !== null) {
      removeHolder(state.current);
      removeRegistry(state.current);
      try {
        state.current.destroy();
      } catch {
        // destroy may throw — still clean up adapter state
      }
    }

    state.current = null;
    state.holder = null;
    editor.value = null;
  };

  const create = (): void => {
    const holder = document.createElement('div');

    state.holder = holder;

    const snapshot = buildConfig();

    // Per-editor portal registry for `createVueBlock` tools: inject it into each
    // vue-block tool's config (so the core-constructed tool can reach it) and
    // associate it with the editor below (so BlokContent can mount the host).
    const registry = createBlockPortalRegistry();

    if (snapshot.tools !== undefined) {
      snapshot.tools = injectPortalRegistry(snapshot.tools, registry);
    }

    // Wrap onSave (when the consumer opted in): record the editor's own
    // serialized output as the dedup baseline BEFORE notifying the consumer, so a
    // controlled `update:data -> data` echo deep-equals it and never re-renders.
    // Reads the latest callback through the config getter so it never goes stale.
    if (typeof snapshot.onSave === 'function') {
      snapshot.onSave = (...args: Parameters<NonNullable<UseBlokConfig['onSave']>>): void => {
        state.lastRenderedData = args[0];
        mergedConfig().onSave?.(...args);
      };
    }

    const blok = new BlokRuntime({ ...snapshot, holder }) as unknown as Blok;

    state.current = blok;
    setHolder(blok, holder);
    setRegistry(blok, registry);

    void blok.isReady
      .then(() => {
        if (state.current === blok) {
          editor.value = blok;
        }
      })
      .catch(() => {
        if (state.current === blok) {
          teardown();
        }
      });
  };

  // Reactive prop sync. Each watcher also depends on `editor`, so it re-applies
  // once the instance appears (the Vue analog of React's `editor` effect-dep).
  // `theme`/`width`/`placeholder` guard on `=== undefined` (NOT falsiness) so a
  // real `placeholder: false` (clear) still propagates.
  watch(
    [editor, () => normalizeReadOnlyConfig(mergedConfig().readOnly).enabled],
    ([ed, readOnlyEnabled]) => {
      if (ed) {
        void ed.readOnly.set(readOnlyEnabled);
      }
    },
    { immediate: true }
  );

  watch(
    [editor, () => mergedConfig().theme],
    ([ed, theme]) => {
      if (ed && theme !== undefined) {
        ed.theme.set(theme);
      }
    },
    { immediate: true }
  );

  watch(
    [editor, () => mergedConfig().width],
    ([ed, width]) => {
      if (ed && width !== undefined) {
        ed.width.set(width);
      }
    },
    { immediate: true }
  );

  watch(
    [editor, () => mergedConfig().placeholder],
    ([ed, placeholder]) => {
      if (ed && placeholder !== undefined) {
        ed.placeholder.set(placeholder);
      }
    },
    { immediate: true }
  );

  watch(
    [editor, () => mergedConfig().autofocus],
    ([ed, autofocus]) => {
      if (ed && autofocus) {
        ed.focus();
      }
    },
    { immediate: true }
  );

  // Reactive content. `data` seeds the editor at construction; afterwards a new
  // *content* value re-renders via the public render() API — deep-equal-deduped
  // against the baseline (so an unchanged reference, including the editor's own
  // echoed output, is a no-op) and serialized via `renderChain`.
  watch(
    [editor, () => mergedConfig().data],
    ([ed, data]) => {
      if (!ed || data === undefined) {
        return;
      }

      // A freshly created editor was already seeded with `data` at construction;
      // record it as the baseline without re-rendering.
      if (state.seededEditor !== ed) {
        state.seededEditor = ed;
        state.lastRenderedData = data;

        return;
      }

      if (deepEqual(data, state.lastRenderedData)) {
        return;
      }

      state.lastRenderedData = data;
      state.renderChain = state.renderChain.catch(() => undefined).then(() => ed.render(toRaw(data)));
    },
    { immediate: true }
  );

  // Recreate on recreateKey identity change (the Vue analog of React `deps` /
  // Angular `recreateKey`). Tears the current editor down and rebuilds; the old
  // editor's late isReady is dropped by the identity guard in `create`.
  if (recreateKey !== undefined) {
    watch(
      () => toValue(recreateKey),
      () => {
        teardown();
        create();
      }
    );
  }

  onMounted(create);
  onBeforeUnmount(teardown);

  return editor;
}
