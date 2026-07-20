import { useState, useEffect, useRef, useMemo, useContext, type DependencyList } from 'react';
import { Blok as BlokRuntime } from '@bloklabs/core';
import { setHolder, removeHolder } from './holder-map';
import { deepEqual } from './deep-equal';
import { BlokDefaultsContext, mergeBlokDefaults } from './provide-blok';
import {
  createBlockPortalRegistry,
  BLOK_PORTAL_REGISTRY_CONFIG_KEY,
  BLOK_TOOL_NAME_CONFIG_KEY,
  type BlockPortalRegistry,
} from './block-portal-registry';
import { setRegistry, removeRegistry } from './registry-map';
import { bindLiveToolConfigFunctions, buildLiveBlockConfig } from './live-tool-config';
import { normalizeReadOnlyConfig } from '@bloklabs/core/adapters';
import type { Blok } from '@/types';
import type { UseBlokConfig } from './types';

interface EditorInstanceState {
  editor: Blok | null;
  holder: HTMLDivElement | null;
  destroyTimeout: ReturnType<typeof setTimeout> | null;
  isDestroyed: boolean;
  /** True once `editor.isReady` has resolved and its API surface is attached. */
  isEditorReady: boolean;
  /** Opaque token identifying which deps cycle created this editor */
  depsToken: Record<string, unknown> | null;
}

/**
 * Inject the editor's portal registry into every `createReactBlock` tool's
 * config (vanilla tools are left untouched), returning a NEW tools object so
 * the consumer's config is never mutated. A react-block tool is constructed by
 * CORE, outside any React render, so it cannot read context — this config
 * bridge is how the tool reaches its editor-scoped registry.
 */
const isReactBlockEntry = (entry: unknown): boolean => {
  const toolClass = typeof entry === 'function' ? entry : (entry as { class?: unknown })?.class;

  return (
    typeof toolClass === 'function' &&
    (toolClass as { __isBlokReactBlock?: boolean }).__isBlokReactBlock === true
  );
};

const injectPortalRegistry = (tools: unknown, registry: BlockPortalRegistry): unknown => {
  if (tools === null || typeof tools !== 'object') {
    return tools;
  }

  const result: Record<string, unknown> = {};

  for (const [name, entry] of Object.entries(tools as Record<string, unknown>)) {
    if (!isReactBlockEntry(entry)) {
      result[name] = entry;

      continue;
    }

    const base: Record<string, unknown> =
      typeof entry === 'function' ? { class: entry } : { ...(entry as Record<string, unknown>) };

    base.config = {
      ...((base.config as Record<string, unknown> | undefined) ?? {}),
      [BLOK_PORTAL_REGISTRY_CONFIG_KEY]: registry,
      [BLOK_TOOL_NAME_CONFIG_KEY]: name,
    };
    result[name] = base;
  }

  return result;
};

/**
 * React hook that manages a Blok editor instance lifecycle.
 *
 * Creates a detached holder div, instantiates Blok, and returns the instance
 * once `isReady` resolves. Handles StrictMode double-mount by deferring
 * destroy via `setTimeout(0)` and cancelling on remount.
 *
 * @param config - Blok configuration without `holder` (managed internally)
 * @param deps - Optional dependency array; when values change, the editor is recreated
 * @returns The Blok instance once ready, or null during initialization / SSR
 */
export function useBlok(configInput: UseBlokConfig, deps?: DependencyList): Blok | null {
  // App-wide defaults from the nearest <BlokProvider> are merged UNDER the
  // per-instance config (instance wins; tools registries merge). When no
  // provider is present this returns `configInput` unchanged.
  const defaults = useContext(BlokDefaultsContext);
  const config = mergeBlokDefaults(defaults, configInput);

  const [editor, setEditor] = useState<Blok | null>(null);
  const configRef = useRef(config);
  configRef.current = config;

  const stateRef = useRef<EditorInstanceState>({
    editor: null,
    holder: null,
    destroyTimeout: null,
    isDestroyed: false,
    isEditorReady: false,
    depsToken: null,
  });

  // A new token is created only when deps change (useMemo compares deps).
  // StrictMode re-runs see the SAME token. Deps changes produce a NEW token.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const depsToken = useMemo(() => ({}), deps ?? []);

  // Tracks the data the editor currently reflects — set when content is seeded
  // or rendered (the reactive `data` effect below) AND when the editor emits its
  // own serialized content via `onSave`. The latter is what makes a controlled
  // `onSave -> setData -> data` round-trip a no-op: the echoed payload deep-equals
  // this baseline, so the data effect skips the redundant render() (which would
  // otherwise reset the caret). Declared here so the `onSave` wrapper below can
  // update it before the consumer's setState re-runs the data effect.
  const lastRenderedDataRef = useRef(config.data);
  const seededEditorRef = useRef<Blok | null>(null);
  // The `data` the live editor was actually constructed with. The seed gate in
  // the reactive-`data` effect compares the current prop against THIS (not mere
  // editor identity) so a prop that diverged from the construction value —
  // undefined-at-mount then loaded, or changed before the editor finished
  // initializing — still renders instead of being mistaken for the seed.
  const constructedDataRef = useRef(config.data);
  const renderChainRef = useRef<Promise<void>>(Promise.resolve());
  // The content of the render currently queued/in-flight (distinct from
  // `lastRenderedDataRef`, which tracks the last SUCCESSFULLY rendered content).
  // Used to dedupe a re-queue of the same in-flight content without advancing the
  // success baseline — so a failed render can't strand the baseline on content
  // the editor never actually showed.
  const pendingDataRef = useRef<UseBlokConfig['data']>(undefined);
  // Live block-config channel (see the sync effect below): the current editor's
  // portal registry, its construction-time wrapped tools (stable function
  // wrappers), and the last config pushed per tool name (dedupe baseline).
  const liveRegistryRef = useRef<BlockPortalRegistry | null>(null);
  const wrappedToolsRef = useRef<unknown>(undefined);
  const pushedBlockConfigsRef = useRef<Map<string, Record<string, unknown>>>(new Map());

  // Main lifecycle effect
  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    const state = stateRef.current;

    // Cancel pending deferred destroy (StrictMode remount)
    if (state.destroyTimeout !== null) {
      clearTimeout(state.destroyTimeout);
      state.destroyTimeout = null;
    }

    // Reuse editor on StrictMode remount (same deps cycle). The construction
    // effect below only calls setEditor(blok) once `blok.isReady` resolves and
    // exportAPI() has attached the full instance API (readOnly, focus, etc.).
    // StrictMode's synchronous cleanup+remount cycle happens well before that
    // promise can settle, so publishing `state.editor` here unconditionally
    // exposed a half-constructed instance to every reactive effect (e.g. the
    // readOnly sync effect calling `.readOnly.set(...)` on an instance whose
    // API surface wasn't attached yet, throwing). Only reuse it into state
    // once it's actually known-ready — otherwise leave `editor` as-is and let
    // the still-pending `isReady.then()` from the original construction (never
    // torn down, since only its destroy was deferred) publish it for real.
    if (state.editor !== null && !state.isDestroyed && state.depsToken === depsToken) {
      if (state.isEditorReady) {
        setEditor(state.editor);
      }

      return (): void => {
        deferDestroy(state, setEditor);
      };
    }

    // Destroy leftover editor from a previous deps cycle
    if (state.editor !== null && !state.isDestroyed) {
      removeHolder(state.editor);
      removeRegistry(state.editor);
      try {
        state.editor.destroy();
      } catch {
        // destroy may throw — still clean up state
      }
      state.editor = null;
      state.holder = null;
      state.isDestroyed = true;
      state.isEditorReady = false;
      setEditor(null);
    }

    // Create detached holder
    const holder = document.createElement('div');
    state.holder = holder;
    state.isDestroyed = false;
    state.isEditorReady = false;
    state.depsToken = depsToken;

    // Wrap callbacks via ref so they never go stale
    const currentConfig = configRef.current;

    // Per-editor portal registry for `createReactBlock` tools: injected into
    // each react-block tool's config (so the core-constructed tool can reach
    // it) and associated with the editor below (so BlokContent can mount the
    // shared portal host). Tool-config FUNCTIONS are first re-bound to stable
    // wrappers that always call the latest render's closure — so consumers
    // never need to freeze identities or recreate the editor to update them.
    const registry = createBlockPortalRegistry();
    const wrappedTools =
      currentConfig.tools === undefined
        ? undefined
        : bindLiveToolConfigFunctions(currentConfig.tools, () => configRef.current.tools);
    const liveTools = wrappedTools === undefined ? undefined : injectPortalRegistry(wrappedTools, registry);

    // Reset the live block-config channel for this editor: the sync effect below
    // reads these to push changed non-function config VALUES to mounted blocks.
    liveRegistryRef.current = registry;
    wrappedToolsRef.current = wrappedTools;
    pushedBlockConfigsRef.current = new Map();

    const blokConfig = {
      ...currentConfig,
      ...(liveTools === undefined ? {} : { tools: liveTools as UseBlokConfig['tools'] }),
      holder,
      onReady: (...args: Parameters<NonNullable<UseBlokConfig['onReady']>>): void => {
        configRef.current.onReady?.(...args);
      },
      onChange: (...args: Parameters<NonNullable<UseBlokConfig['onChange']>>): void => {
        configRef.current.onChange?.(...args);
      },
      // Forward the return value: it is the "handled" signal the core acts on.
      onEnter: (...args: Parameters<NonNullable<UseBlokConfig['onEnter']>>): boolean | void =>
        configRef.current.onEnter?.(...args),
    };

    // Only attach onSave when the consumer opted in: its mere presence makes the
    // core serialize on every change batch, so an absent prop must stay absent.
    // The wrapper reads through the ref so the latest callback is always used.
    if (currentConfig.onSave) {
      blokConfig.onSave = (...args: Parameters<NonNullable<UseBlokConfig['onSave']>>): void => {
        // Record the editor's own serialized output as the rendered baseline so a
        // controlled consumer echoing it straight back into `data` is a no-op —
        // no redundant render(), no caret reset, no round-trip recursion.
        lastRenderedDataRef.current = args[0];
        configRef.current.onSave?.(...args);
      };
    }

    // onBeforeRender / onAfterRender are opt-in (absent prop must stay absent so
    // the core skips them). When present, route through the ref so the latest
    // callback is always used without recreating the editor.
    if (currentConfig.onBeforeRender) {
      blokConfig.onBeforeRender = (
        ...args: Parameters<NonNullable<UseBlokConfig['onBeforeRender']>>
      ): ReturnType<NonNullable<UseBlokConfig['onBeforeRender']>> =>
        configRef.current.onBeforeRender?.(...args) ?? args[0];
    }

    if (currentConfig.onAfterRender) {
      blokConfig.onAfterRender = (...args: Parameters<NonNullable<UseBlokConfig['onAfterRender']>>): void => {
        configRef.current.onAfterRender?.(...args);
      };
    }

    const blok = new BlokRuntime(blokConfig) as unknown as Blok;
    state.editor = blok;
    // Remember what this editor was seeded with so the reactive-`data` effect can
    // tell a genuine post-construction change from the construction value itself.
    constructedDataRef.current = currentConfig.data;
    setHolder(blok, holder);
    setRegistry(blok, registry);

    void blok.isReady
      .then(() => {
        if (state.editor === blok && !state.isDestroyed) {
          state.isEditorReady = true;
          setEditor(blok);
        }
      })
      .catch(() => {
        if (state.editor === blok && !state.isDestroyed) {
          removeHolder(blok);
          removeRegistry(blok);
          try {
            blok.destroy();
          } catch {
            // destroy may also throw — still clean up state
          }
          state.editor = null;
          state.holder = null;
          state.isDestroyed = true;
          state.isEditorReady = false;
          setEditor(null);
        }
      });

    return (): void => {
      deferDestroy(state, setEditor);
    };
  }, [depsToken]);

  // Live tool-config VALUES for react blocks. Function slots are already live
  // via the stable wrappers, but non-function values (permissions, URLs,
  // locale…) were snapshotted at construction — which forced consumers to put
  // them in `deps` and recreate the whole editor to change them. Instead, this
  // effect runs on every render, rebuilds each react-block tool's
  // component-facing config from the LATEST render's values (keeping wrapper
  // identities for functions), and pushes it through the portal registry when
  // it genuinely changed — mounted blocks re-render in place, future blocks
  // start from the latest config.
  useEffect(() => {
    const registry = liveRegistryRef.current;
    const state = stateRef.current;

    if (registry === null || state.editor === null || state.isDestroyed) {
      return;
    }

    const latestTools = configRef.current.tools as Record<string, unknown> | undefined;

    if (latestTools === null || typeof latestTools !== 'object') {
      return;
    }

    const wrappedTools = wrappedToolsRef.current as Record<string, unknown> | undefined;

    for (const [name, entry] of Object.entries(latestTools)) {
      if (!isReactBlockEntry(entry)) {
        continue;
      }

      const latestConfig =
        typeof entry === 'function' ? {} : ((entry as { config?: unknown }).config ?? {});
      const wrappedEntry = wrappedTools?.[name];
      const wrappedConfig =
        wrappedEntry !== null && typeof wrappedEntry === 'object'
          ? (wrappedEntry as { config?: unknown }).config
          : undefined;

      const candidate = buildLiveBlockConfig(wrappedConfig, latestConfig);
      const pushed = pushedBlockConfigsRef.current.get(name);

      if (pushed !== undefined && deepEqual(candidate, pushed)) {
        continue;
      }

      const frozen = Object.freeze(candidate);

      pushedBlockConfigsRef.current.set(name, frozen);
      registry.setToolConfig(name, frozen);
    }
  });

  // Reactive: readOnly (object form normalized so the effect dep is a stable boolean)
  const readOnlyEnabled = normalizeReadOnlyConfig(config.readOnly).enabled;
  useEffect(() => {
    if (editor === null) {
      return;
    }
    void editor.readOnly.set(readOnlyEnabled);
  }, [editor, readOnlyEnabled]);

  // Reactive: autofocus
  const { autofocus } = config;
  useEffect(() => {
    if (editor === null || !autofocus) {
      return;
    }
    editor.focus();
  }, [editor, autofocus]);

  // Reactive: theme
  const { theme } = config;
  useEffect(() => {
    if (editor === null || theme === undefined) {
      return;
    }
    editor.theme.set(theme);
  }, [editor, theme]);

  // Reactive: width
  const { width } = config;
  useEffect(() => {
    if (editor === null || width === undefined) {
      return;
    }
    editor.width.set(width);
  }, [editor, width]);

  // Reactive: placeholder
  const { placeholder } = config;
  useEffect(() => {
    if (editor === null || placeholder === undefined) {
      return;
    }
    editor.placeholder.set(placeholder);
  }, [editor, placeholder]);

  // Reactive: data (controlled content)
  //
  // `data` seeds the editor at construction. Afterwards, changing the prop to
  // new *content* re-renders the editor via the public render() API — no
  // recreation. Updates are deep-equal–deduped against the editor's current
  // content baseline (`lastRenderedDataRef`, declared above and also updated by
  // the `onSave` wrapper) so a new reference with the same content — including
  // the editor's own serialized output echoed back — is a no-op and won't
  // clobber the caret. Renders are serialized so rapid changes can't overlap.
  const { data } = config;
  useEffect(() => {
    if (editor === null || data === undefined) {
      return;
    }

    // The lifecycle effect runs BEFORE this one, so a commit that changes `deps`
    // AND `data` together has already swapped `state.editor` to the freshly
    // constructed instance (and may have destroyed the old one) by the time this
    // effect fires with the PREVIOUS render's `editor` closure. Rendering through
    // that stale handle would target a destroyed editor — and the new instance is
    // already seeded with the new `data` at construction. Skip unless this closure
    // still owns the live editor, mirroring the isReady guard above.
    const state = stateRef.current;

    if (state.editor !== editor || state.isDestroyed) {
      return;
    }

    // First time observing this editor: it was seeded at construction with
    // `constructedDataRef`. When the current prop still matches that seed, just
    // record the baseline and skip the redundant render. When it has diverged
    // (undefined-at-mount then loaded, or changed before the editor finished
    // initializing), fall through and render so the editor reflects the prop.
    if (seededEditorRef.current !== editor) {
      seededEditorRef.current = editor;
      // A render still pending on a PRIOR editor is moot for this fresh instance;
      // clear it so its content can't dedupe a needed render on the new editor.
      pendingDataRef.current = undefined;

      if (deepEqual(data, constructedDataRef.current)) {
        lastRenderedDataRef.current = data;

        return;
      }
    }

    // Skip when the editor already reflects this content (last SUCCESSFUL render)
    // OR a render of the same content is already queued/in-flight — re-rendering
    // identical content would needlessly reset the caret.
    if (deepEqual(data, lastRenderedDataRef.current) || deepEqual(data, pendingDataRef.current)) {
      return;
    }

    // Mark the content in-flight, but DON'T advance the success baseline until the
    // render actually resolves. A failed render leaves the editor on its last
    // successful content, so the baseline must keep pointing there — otherwise a
    // run of consecutive failures (e.g. successive malformed `data`) would strand
    // the baseline on a never-rendered payload and wrongly dedupe a later retry.
    pendingDataRef.current = data;
    renderChainRef.current = renderChainRef.current
      .catch(() => undefined)
      .then(() => editor.render(data))
      .then(
        () => {
          lastRenderedDataRef.current = data;
        },
        () => {
          // render failed: keep the last successful baseline so a later identical
          // or corrected `data` re-renders instead of being deduped. Owning the
          // rejection here also keeps it off the unhandled-rejection path.
        }
      )
      .then(() => {
        // Clear the in-flight marker once settled, unless a newer render has since
        // claimed it (then that newer render owns the clear).
        if (pendingDataRef.current === data) {
          pendingDataRef.current = undefined;
        }
      });
  }, [editor, data]);

  return editor;
}

function deferDestroy(
  state: EditorInstanceState,
  setEditorState: React.Dispatch<React.SetStateAction<Blok | null>>
): void {
  /* eslint-disable no-param-reassign -- intentional mutation of shared state ref */
  state.destroyTimeout = setTimeout(() => {
    if (state.editor !== null) {
      removeHolder(state.editor);
      removeRegistry(state.editor);
      try {
        state.editor.destroy();
      } catch {
        // destroy may throw — still clean up state
      }
      state.editor = null;
      state.holder = null;
      state.isDestroyed = true;
      state.isEditorReady = false;
      state.destroyTimeout = null;
      setEditorState(null);
    }
  }, 0);
  /* eslint-enable no-param-reassign */
}
