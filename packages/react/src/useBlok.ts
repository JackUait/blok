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
import { setContentBaseline, removeContentBaseline } from './content-baseline-map';
import { bindLiveToolConfigFunctions, buildLiveBlockConfig } from './live-tool-config';
import {
  createEmittedEchoWindow,
  equalsOutputData,
  normalizeReadOnlyConfig,
  toRenderableData,
} from '@bloklabs/core/adapters';
import type { Blok, LiveHandlers } from '@/types';
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
 * Warning text for a controlled `data` change the adapter refuses to render
 * under collaboration. Kept verbatim in all three adapters (they share no code).
 * @param doc - the collaboration document id, for the reset endpoint in the text
 * @returns the message to warn with, once per adapter instance
 */
const collaborationDataIgnoredMessage = (doc?: string): string =>
  '[Blok] `data` is ignored while collaboration is on: the document lives on the sync service ' +
  'and is shared with everyone editing it, so replacing it from this editor would overwrite their work. ' +
  `To replace the whole document, call POST /sync/${doc ?? '{doc}'}/reset on your server — ` +
  'it reloads the document from your own document endpoint and every open editor picks it up. ' +
  'To change part of it, use the blocks API (insert/update/delete).';

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

/** React inline tools (createReactInlineTool) need the same registry bridge. */
const isReactInlineToolEntry = (entry: unknown): boolean => {
  const toolClass = typeof entry === 'function' ? entry : (entry as { class?: unknown })?.class;

  return (
    typeof toolClass === 'function' &&
    (toolClass as { __isBlokReactInlineTool?: boolean }).__isBlokReactInlineTool === true
  );
};

const injectPortalRegistry = (tools: unknown, registry: BlockPortalRegistry): unknown => {
  if (tools === null || typeof tools !== 'object') {
    return tools;
  }

  const result: Record<string, unknown> = {};

  for (const [name, entry] of Object.entries(tools as Record<string, unknown>)) {
    if (!isReactBlockEntry(entry) && !isReactInlineToolEntry(entry)) {
      result[name] = entry;

      continue;
    }

    const base: Record<string, unknown> =
      typeof entry === 'function' ? { class: entry } : { ...(entry as Record<string, unknown>) };

    base.config = {
      ...((base.config) ?? {}),
      [BLOK_PORTAL_REGISTRY_CONFIG_KEY]: registry,
      [BLOK_TOOL_NAME_CONFIG_KEY]: name,
    };

    // A React block tool whose toolbox title is a ReactElement needs a live
    // portal that only the editor's registry can host. Build a per-editor
    // toolbox override (element-title hosts registered now) and let core's
    // per-tool `toolbox` setting carry it. Undefined = no ReactElement titles,
    // so the static string/`toolNames.*` path is left untouched.
    const buildPortalToolbox = (base.class as {
      __buildPortalToolbox?: (r: BlockPortalRegistry, n: string) => unknown;
    }).__buildPortalToolbox;

    const portalToolbox = typeof buildPortalToolbox === 'function' && base.toolbox === undefined
      ? buildPortalToolbox(registry, name)
      : undefined;

    if (portalToolbox !== undefined) {
      base.toolbox = portalToolbox;
    }

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
  // or rendered (the reactive `data` effect below), when the editor emits its
  // own serialized content via `onSave`, and when an IMPERATIVE call changed the
  // content out of band (the content-baseline channel registered below). The
  // `onSave` writer is what makes a controlled `onSave -> setData -> data`
  // round-trip a no-op: the echoed payload content-equals this baseline, so the
  // data effect skips the redundant render() (which would otherwise reset the
  // caret). Declared here so the `onSave` wrapper below can update it before the
  // consumer's setState re-runs the data effect. `undefined` means "nothing
  // recorded yet" — never an empty document.
  const lastRenderedDataRef = useRef(config.data);
  // Window of recently emitted `onSave` payloads. The baseline above only
  // remembers the LAST one, but a host that persists on save and refetches can
  // echo an EARLIER save after a newer one replaced the baseline (the user kept
  // typing). Such a stale echo is still the editor's own output — re-rendering
  // it would clobber the caret and the content typed since — so the data effect
  // treats a match against ANY windowed payload as a no-op.
  const echoWindowRef = useRef(createEmittedEchoWindow());
  const seededEditorRef = useRef<Blok | null>(null);
  // The `data` the live editor was actually constructed with. The seed gate in
  // the reactive-`data` effect compares the current prop against THIS (not mere
  // editor identity) so a prop that diverged from the construction value —
  // undefined-at-mount then loaded, or changed before the editor finished
  // initializing — still renders instead of being mistaken for the seed.
  const constructedDataRef = useRef(config.data);
  // The `collaboration` the live editor was CONSTRUCTED with. The key is
  // mount-fixed, so dropping it from the prop (`collaboration: on ? {...} :
  // undefined`) cannot turn a live session into a single-player editor —
  // reading the current prop instead would let that change fall through into
  // render(), which refuses under collaboration and rejects with nothing
  // surfaced anywhere.
  const constructedCollaborationRef = useRef(config.collaboration);
  const renderChainRef = useRef<Promise<void>>(Promise.resolve());
  // One collaboration warning per hook instance (see the data effect).
  const collaborationWarnedRef = useRef(false);
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
  // Last-applied tool-level `toolbox` setting per tool name (dedupe baseline for
  // the reactive toolbox effect below). Seeded from the construction-time tools.
  const appliedToolboxRef = useRef<Map<string, unknown>>(new Map());
  // Live callback channel (see the handler-presence effect below): the current
  // editor's stable per-handler wrappers (each forwards to the LATEST render's
  // prop through `configRef`, so their identity never changes) and the presence
  // actually installed on that editor — the dedupe baseline.
  const handlerWrappersRef = useRef<LiveHandlers | null>(null);
  const appliedHandlerPresenceRef = useRef<Record<keyof LiveHandlers, boolean>>({
    onChange: false,
    onSave: false,
    onEnter: false,
    onSubmit: false,
    onBeforeRender: false,
    onAfterRender: false,
  });

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
      removeContentBaseline(state.editor);
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
    appliedToolboxRef.current = new Map(
      Object.entries((currentConfig.tools ?? {}) as Record<string, unknown>).map(([name, entry]) => [
        name,
        entry !== null && typeof entry === 'object' ? (entry as { toolbox?: unknown }).toolbox : undefined,
      ])
    );

    // Stable per-editor wrappers for the live callback config. Each forwards to
    // the LATEST render's prop through `configRef`, so a consumer never has to
    // freeze callback identities — and, because identity is fixed for the
    // editor's life, only PRESENCE has to be synced afterwards (below).
    const handlerWrappers: LiveHandlers = {
      onChange: (...args: Parameters<NonNullable<UseBlokConfig['onChange']>>): void => {
        configRef.current.onChange?.(...args);
      },
      onSave: (...args: Parameters<NonNullable<UseBlokConfig['onSave']>>): void => {
        // Record the editor's own serialized output as the rendered baseline so a
        // controlled consumer echoing it straight back into `data` is a no-op —
        // no redundant render(), no caret reset, no round-trip recursion.
        lastRenderedDataRef.current = args[0];
        echoWindowRef.current.record(args[0]);
        configRef.current.onSave?.(...args);
      },
      // Forward the return value: it is the "handled" signal the core acts on.
      onEnter: (...args: Parameters<NonNullable<UseBlokConfig['onEnter']>>): boolean | void =>
        configRef.current.onEnter?.(...args),
      onSubmit: (...args: Parameters<NonNullable<UseBlokConfig['onSubmit']>>): void => {
        configRef.current.onSubmit?.(...args);
      },
      onBeforeRender: (
        ...args: Parameters<NonNullable<UseBlokConfig['onBeforeRender']>>
      ): ReturnType<NonNullable<UseBlokConfig['onBeforeRender']>> =>
        configRef.current.onBeforeRender?.(...args) ?? args[0],
      onAfterRender: (...args: Parameters<NonNullable<UseBlokConfig['onAfterRender']>>): void => {
        configRef.current.onAfterRender?.(...args);
      },
    };

    handlerWrappersRef.current = handlerWrappers;

    // Handler PRESENCE is load-bearing in core — an `onSubmit` turns Enter into
    // serialize-and-submit, an `onSave` arms the change pipeline — so an absent
    // prop must leave the key absent. Attach only the wrappers whose prop the
    // consumer actually passed, and record what was installed so the effect
    // below can push later presence flips instead of recreating the editor.
    const handlerPresence: Record<keyof LiveHandlers, boolean> = {
      onChange: currentConfig.onChange !== undefined,
      onSave: currentConfig.onSave !== undefined,
      onEnter: currentConfig.onEnter !== undefined,
      onSubmit: currentConfig.onSubmit !== undefined,
      onBeforeRender: currentConfig.onBeforeRender !== undefined,
      onAfterRender: currentConfig.onAfterRender !== undefined,
    };

    appliedHandlerPresenceRef.current = handlerPresence;

    const blokConfig = {
      ...currentConfig,
      ...(liveTools === undefined ? {} : { tools: liveTools as UseBlokConfig['tools'] }),
      holder,
      onReady: (...args: Parameters<NonNullable<UseBlokConfig['onReady']>>): void => {
        configRef.current.onReady?.(...args);
      },
      ...(handlerPresence.onChange ? { onChange: handlerWrappers.onChange } : {}),
      ...(handlerPresence.onSave ? { onSave: handlerWrappers.onSave } : {}),
      ...(handlerPresence.onEnter ? { onEnter: handlerWrappers.onEnter } : {}),
      ...(handlerPresence.onSubmit ? { onSubmit: handlerWrappers.onSubmit } : {}),
      ...(handlerPresence.onBeforeRender ? { onBeforeRender: handlerWrappers.onBeforeRender } : {}),
      ...(handlerPresence.onAfterRender ? { onAfterRender: handlerWrappers.onAfterRender } : {}),
    };

    const blok = new BlokRuntime(blokConfig);
    state.editor = blok;
    // Remember what this editor was seeded with so the reactive-`data` effect can
    // tell a genuine post-construction change from the construction value itself.
    constructedDataRef.current = currentConfig.data;
    constructedCollaborationRef.current = currentConfig.collaboration;
    setHolder(blok, holder);
    setRegistry(blok, registry);
    // Imperative-content channel: `useBlokHandle().clear()` / `.render()` change
    // the content OUT OF BAND of the reactive `data` effect below. They report
    // the new content here so the dedupe baseline and the emitted-echo window
    // (both read by that effect) describe the editor as it actually is —
    // otherwise restoring a document the editor itself emitted is dismissed as
    // an echo and never rendered.
    setContentBaseline(blok, {
      markRendered: (content): void => {
        echoWindowRef.current.clear();
        lastRenderedDataRef.current = content;
        pendingDataRef.current = undefined;
      },
    });

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
          removeContentBaseline(blok);
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

  // Live tool-level `toolbox` setting. Toolbox membership was construction-only,
  // which forced permission-style gating (`toolbox: false` for users who may not
  // insert a tool) into `deps` — recreating the whole editor on a permission
  // flip. Instead, diff each tool's `toolbox` setting against the last applied
  // value on every render and push genuine changes through the runtime
  // `tools.update` API (which reaches the live adapter and rebuilds the Toolbox
  // UI). Applies only once the editor is ready — module APIs attach at isReady —
  // and the ready transition re-renders, so a change made earlier is not lost.
  useEffect(() => {
    const state = stateRef.current;

    if (state.editor === null || state.isDestroyed || !state.isEditorReady) {
      return;
    }

    const latestTools = configRef.current.tools as Record<string, unknown> | undefined;

    if (latestTools === null || typeof latestTools !== 'object') {
      return;
    }

    for (const [name, entry] of Object.entries(latestTools)) {
      // Only tools the editor was constructed with can be updated at runtime.
      if (!appliedToolboxRef.current.has(name)) {
        continue;
      }

      const latest =
        entry !== null && typeof entry === 'object' ? (entry as { toolbox?: unknown }).toolbox : undefined;
      const applied = appliedToolboxRef.current.get(name);

      if (deepEqual(latest, applied)) {
        continue;
      }

      appliedToolboxRef.current.set(name, latest);
      (state.editor as unknown as {
        tools?: { update: (toolName: string, config: Record<string, unknown>) => void };
      }).tools?.update(name, { toolbox: latest });
    }
  });

  // Reactive: onChange
  // Reactive: onSave
  // Reactive: onEnter
  // Reactive: onSubmit
  // Reactive: onBeforeRender
  // Reactive: onAfterRender
  //
  // Callback PRESENCE was frozen at construction, and in core the presence of a
  // handler IS the semantics: an `onSubmit` makes Enter serialize-and-submit
  // instead of splitting the block, an `onSave` arms the whole change-observation
  // pipeline. A host whose "Enter sends" toggle (or `onSave` subscription) lives
  // in React state therefore had to bump `deps` and destroy/rebuild the editor,
  // losing caret and undo history. Instead, diff each handler's presence against
  // what is installed and push genuine flips through the runtime `handlers.set`
  // API — passing `undefined` for a prop that disappeared, which is what makes
  // the change reversible rather than a one-way latch. Identity never changes
  // (the wrappers forward through `configRef`), so only presence is diffed.
  // Applies once the editor is ready — module APIs attach at isReady — and the
  // ready transition re-renders, so a flip made earlier is not lost.
  useEffect(() => {
    const state = stateRef.current;
    const wrappers = handlerWrappersRef.current;

    if (state.editor === null || state.isDestroyed || !state.isEditorReady || wrappers === null) {
      return;
    }

    const latest = configRef.current;
    const applied = appliedHandlerPresenceRef.current;
    const diff: LiveHandlers = {};
    const changed: { value: boolean } = { value: false };

    const sync = <K extends keyof LiveHandlers>(key: K, write: (value: LiveHandlers[K]) => void): void => {
      const present = latest[key] !== undefined;

      if (present === applied[key]) {
        return;
      }

      applied[key] = present;
      changed.value = true;
      write(present ? wrappers[key] : undefined);
    };

    sync('onChange', (value) => {
      diff.onChange = value;
    });
    sync('onSave', (value) => {
      diff.onSave = value;
    });
    sync('onEnter', (value) => {
      diff.onEnter = value;
    });
    sync('onSubmit', (value) => {
      diff.onSubmit = value;
    });
    sync('onBeforeRender', (value) => {
      diff.onBeforeRender = value;
    });
    sync('onAfterRender', (value) => {
      diff.onAfterRender = value;
    });

    if (changed.value) {
      state.editor.handlers.set(diff);
    }
  });

  // Reactive: readOnly (object form normalized so the effect deps are stable booleans).
  // The object form additionally syncs `hideControls` through the options
  // parameter of `readOnly.set` — a plain boolean prop keeps the historical
  // boolean-only call so it never overwrites a construction-time object form.
  const readOnlyIsObjectForm = typeof config.readOnly === 'object' && config.readOnly !== null;
  const { enabled: readOnlyEnabled, hideControls: readOnlyHideControls } = normalizeReadOnlyConfig(config.readOnly);
  useEffect(() => {
    if (editor === null) {
      return;
    }

    if (readOnlyIsObjectForm) {
      void editor.readOnly.set(readOnlyEnabled, { hideControls: readOnlyHideControls });
    } else {
      void editor.readOnly.set(readOnlyEnabled);
    }
  }, [editor, readOnlyEnabled, readOnlyHideControls, readOnlyIsObjectForm]);

  // Reactive: hideToolbar — `toolbar.setHidden` writes `config.hideToolbar`
  // (read live by the toolbar's open guards) AND toggles the wrapper's
  // toolbar-hidden attribute (the CSS hook that collapses the gutter), so a
  // prop flip takes effect in place. Guarded on `undefined` so a consumer who
  // never sets the prop gets no call at all (mirrors theme/width).
  const { hideToolbar } = config;
  useEffect(() => {
    if (editor === null || hideToolbar === undefined) {
      return;
    }
    editor.toolbar.setHidden(hideToolbar);
  }, [editor, hideToolbar]);

  // Reactive: toolbarPosition — `toolbar.setPosition` writes
  // `config.toolbarPosition` (read live by the layout paths CSS cannot mirror)
  // AND re-stamps the wrapper's toolbar-position attribute (the CSS hook that
  // swaps the gutter and the actions bar), so a prop flip moves the controls in
  // place. Guarded on `undefined` so a consumer who never sets the prop gets no
  // call at all (mirrors hideToolbar).
  const { toolbarPosition } = config;
  useEffect(() => {
    if (editor === null || toolbarPosition === undefined) {
      return;
    }
    editor.toolbar.setPosition(toolbarPosition);
  }, [editor, toolbarPosition]);

  // Reactive: inlineToolbar — `tools.setInlineToolbar` re-assigns every block
  // tool's inline set and invalidates sanitize caches, so the change lands on
  // the next selection without a re-render. The dep is a content serialization
  // (boolean | string[]) so a re-created array literal with the same entries
  // does not re-fire the setter.
  const { inlineToolbar } = config;
  const inlineToolbarKey = inlineToolbar === undefined ? undefined : JSON.stringify(inlineToolbar);
  useEffect(() => {
    if (editor === null || inlineToolbar === undefined) {
      return;
    }
    editor.tools.setInlineToolbar(inlineToolbar);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- inlineToolbar is deliberately depped by CONTENT (inlineToolbarKey) so a re-created array literal with the same entries does not thrash the setter
  }, [editor, inlineToolbarKey]);

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

  // Reactive: style.tokens
  //
  // Theme tokens were construction-only, so a host with a live light/dark
  // toggle had to bump `deps` (destroying the editor, losing caret/history) or
  // hand-write the global stylesheet Blok already injects. Push genuine changes
  // through the runtime `tokens` API instead, deep-equal–deduped because
  // `tokens` is almost always a fresh object literal each render.
  const styleTokens = config.style?.tokens;
  /*
   * Seeded with the mount-time value: construction already injected those
   * tokens, so the first effect run is a no-op and only genuine changes push.
   */
  const appliedTokensRef = useRef<Record<string, string> | undefined>(config.style?.tokens);

  useEffect(() => {
    if (editor === null || styleTokens === undefined) {
      return;
    }

    if (deepEqual(styleTokens, appliedTokensRef.current)) {
      return;
    }

    appliedTokensRef.current = styleTokens;
    editor.tokens.set(styleTokens);
  }, [editor, styleTokens]);

  // Reactive: i18n
  //
  // `config.i18n` was read once during the editor's boot and never again, so a
  // host driving a language switcher from React state had no correct option:
  // accept a permanently stale UI, or bump `deps` and destroy the editor
  // mid-typing. Push genuine changes through the runtime `i18n.update` API
  // instead, deep-equal–deduped because `i18n` is almost always a fresh object
  // literal each render (a `useMemo`d message map re-created on locale change
  // is the whole point of the prop).
  //
  // `defaultLocale` is deliberately not forwarded: it only decides the
  // fallback while resolving the INITIAL locale, so it is inert after mount.
  const { i18n } = config;
  /*
   * Seeded with the mount-time value: construction already applied it, so the
   * first effect run is a no-op and only genuine changes push.
   */
  const appliedI18nRef = useRef<UseBlokConfig['i18n']>(config.i18n);

  useEffect(() => {
    if (editor === null || i18n === undefined) {
      return;
    }

    if (deepEqual(i18n, appliedI18nRef.current)) {
      return;
    }

    appliedI18nRef.current = i18n;

    const { locale, messages, direction } = i18n;

    void editor.i18n.update({
      ...(locale === undefined ? {} : { locale }),
      ...(messages === undefined ? {} : { messages }),
      ...(direction === undefined ? {} : { direction }),
    });
  }, [editor, i18n]);

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
  // recreation. Updates are content-deduped against the editor's current
  // baseline (`lastRenderedDataRef`, declared above and also updated by the
  // `onSave` wrapper and the imperative content-baseline channel) so a new
  // reference with the same content — including the editor's own serialized
  // output echoed back, however the host reshaped it in transit — is a no-op and
  // won't clobber the caret. Renders are serialized so rapid changes can't overlap.
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
      // Payloads emitted by a PRIOR editor are likewise moot for this one.
      echoWindowRef.current.clear();

      if (deepEqual(data, constructedDataRef.current)) {
        lastRenderedDataRef.current = data;

        return;
      }
    }

    // Skip when the editor already reflects this content (last SUCCESSFUL render)
    // OR a render of the same content is already queued/in-flight — re-rendering
    // identical content would needlessly reset the caret.
    //
    // Compared with the SAME structural lens the echo window uses
    // (`equalsOutputData`, not a raw deep-equal): a host that persists the
    // editor's own document and hands back a stripped copy — fresh `time`,
    // dropped ids, no `lastEditedAt` stamp — is still echoing content the editor
    // already shows. `undefined` means "nothing recorded yet", which is NOT an
    // empty document, so it must never match.
    const baseline = lastRenderedDataRef.current;
    const inFlight = pendingDataRef.current;

    if (
      (baseline !== undefined && equalsOutputData(data, baseline)) ||
      (inFlight !== undefined && equalsOutputData(data, inFlight))
    ) {
      return;
    }

    // Skip stale echoes: content the editor itself emitted via `onSave` recently,
    // arriving back reshaped (fresh envelope, stripped ids) and/or late — after a
    // newer save already replaced the baseline above.
    if (echoWindowRef.current.matches(data)) {
      return;
    }

    // Under collaboration the document belongs to the sync service, and render()
    // refuses a wholesale replace — so don't attempt one. The prop's premise
    // ("this value IS the document") does not hold here. Decided against the
    // MOUNTED config, never the current prop: `collaboration` is mount-fixed,
    // so a host that drops the key is still driving a collaboration session and
    // deserves the warning rather than a silently rejected render.
    const mountedCollaboration = constructedCollaborationRef.current;

    if (mountedCollaboration !== undefined) {
      if (!collaborationWarnedRef.current) {
        collaborationWarnedRef.current = true;
        console.warn(collaborationDataIgnoredMessage(mountedCollaboration.doc));
      }

      return;
    }

    // Genuinely external content takes over: earlier emitted payloads are moot,
    // and keeping them could wrongly no-op a later deliberate revert to one.
    echoWindowRef.current.clear();

    // Mark the content in-flight, but DON'T advance the success baseline until the
    // render actually resolves. A failed render leaves the editor on its last
    // successful content, so the baseline must keep pointing there — otherwise a
    // run of consecutive failures (e.g. successive malformed `data`) would strand
    // the baseline on a never-rendered payload and wrongly dedupe a later retry.
    pendingDataRef.current = data;
    renderChainRef.current = renderChainRef.current
      .catch(() => undefined)
      // `data` may be null here (a controlled "clear to empty"); render() throws
      // on null, so normalize null → { blocks: [] } at the boundary.
      .then(() => editor.render(toRenderableData(data)))
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
      removeContentBaseline(state.editor);
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
