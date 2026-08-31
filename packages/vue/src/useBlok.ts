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
import { Blok as BlokRuntime } from '@bloklabs/core';
import { setContentBaseline, removeContentBaseline } from './content-baseline-map';
import { setHolder, removeHolder } from './holder-map';
import { deepEqual, equalsOutputData, normalizeReadOnlyConfig, toRenderableData } from '@bloklabs/core/adapters';
import { BLOK_DEFAULT_CONFIG, mergeBlokDefaults } from './provide-blok';
import {
  createBlockPortalRegistry,
  BLOK_PORTAL_REGISTRY_CONFIG_KEY,
  type BlockPortalRegistry,
} from './block-portal-registry';
import { setRegistry, removeRegistry } from './registry-map';
import type { Blok, BlokConfig, LiveHandlers, LooseOutputData, OutputData } from '@/types';
import type { UseBlokConfig } from './types';

/** Presence map for the live callback config (see the handler watcher below). */
type HandlerPresence = Record<keyof LiveHandlers, boolean>;

/**
 * Which live callbacks the config currently carries. PRESENCE is load-bearing
 * in core — an `onSubmit` turns Enter into serialize-and-submit, an `onSave`
 * arms the change-observation pipeline — so it is tracked separately from the
 * callbacks themselves (whose identity the adapter keeps stable).
 * @param config - the merged per-render config
 * @returns one boolean per live handler key
 */
const readHandlerPresence = (config: UseBlokConfig): HandlerPresence => ({
  onChange: config.onChange !== undefined,
  onSave: config.onSave !== undefined,
  onEnter: config.onEnter !== undefined,
  onSubmit: config.onSubmit !== undefined,
  onBeforeRender: config.onBeforeRender !== undefined,
  onAfterRender: config.onAfterRender !== undefined,
});

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
      ...((base.config) ?? {}),
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
  //   echo content-equals this baseline and is deduped to a no-op (no caret
  //   reset). `undefined` means "nothing recorded yet" — never an empty document.
  const state: {
    current: Blok | null;
    holder: HTMLDivElement | null;
    lastRenderedData: OutputData | LooseOutputData | null | undefined;
    seededEditor: Blok | null;
    renderChain: Promise<void>;
    collaborationWarned: boolean;
    appliedHandlerPresence: HandlerPresence;
  } = {
    current: null,
    holder: null,
    lastRenderedData: mergedConfig().data,
    seededEditor: null,
    renderChain: Promise.resolve(),
    collaborationWarned: false,
    appliedHandlerPresence: {
      onChange: false,
      onSave: false,
      onEnter: false,
      onSubmit: false,
      onBeforeRender: false,
      onAfterRender: false,
    },
  };

  /**
   * Stable wrappers for the live callback config. Each forwards to the LATEST
   * config through `mergedConfig()`, so callback identity never goes stale and
   * only PRESENCE has to be synced after mount (the watcher below).
   */
  const handlerWrappers: Required<LiveHandlers> = {
    onChange: (...args: Parameters<NonNullable<UseBlokConfig['onChange']>>): void => {
      mergedConfig().onChange?.(...args);
    },
    onSave: (...args: Parameters<NonNullable<UseBlokConfig['onSave']>>): void => {
      // Record the editor's own serialized output as the dedup baseline BEFORE
      // notifying the consumer, so a controlled `update:data -> data` echo
      // content-equals it and never re-renders.
      state.lastRenderedData = args[0];
      mergedConfig().onSave?.(...args);
    },
    // Forward the return value: it is the "handled" signal the core acts on.
    onEnter: (...args: Parameters<NonNullable<UseBlokConfig['onEnter']>>): boolean | void =>
      mergedConfig().onEnter?.(...args),
    onSubmit: (...args: Parameters<NonNullable<UseBlokConfig['onSubmit']>>): void => {
      mergedConfig().onSubmit?.(...args);
    },
    onBeforeRender: (
      ...args: Parameters<NonNullable<UseBlokConfig['onBeforeRender']>>
    ): ReturnType<NonNullable<UseBlokConfig['onBeforeRender']>> =>
      mergedConfig().onBeforeRender?.(...args) ?? args[0],
    onAfterRender: (...args: Parameters<NonNullable<UseBlokConfig['onAfterRender']>>): void => {
      mergedConfig().onAfterRender?.(...args);
    },
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
      removeContentBaseline(state.current);
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

    // Install the stable wrappers for the callbacks the consumer actually
    // passed, and clear the rest: an absent handler must stay absent, because
    // core reads PRESENCE as intent. What was installed is recorded so the
    // watcher below can push later flips instead of recreating the editor.
    const presence = readHandlerPresence(mergedConfig());

    snapshot.onChange = presence.onChange ? handlerWrappers.onChange : undefined;
    snapshot.onSave = presence.onSave ? handlerWrappers.onSave : undefined;
    snapshot.onEnter = presence.onEnter ? handlerWrappers.onEnter : undefined;
    snapshot.onSubmit = presence.onSubmit ? handlerWrappers.onSubmit : undefined;
    snapshot.onBeforeRender = presence.onBeforeRender ? handlerWrappers.onBeforeRender : undefined;
    snapshot.onAfterRender = presence.onAfterRender ? handlerWrappers.onAfterRender : undefined;

    state.appliedHandlerPresence = presence;

    const blok = new BlokRuntime({ ...snapshot, holder });

    state.current = blok;
    setHolder(blok, holder);
    setRegistry(blok, registry);
    // The out-of-band content channel: `<BlokEditor>`'s exposed `render()`
    // changes the document without going through the reactive `data` watcher,
    // so it reports the result here. Without it the watcher's baseline names a
    // document the editor no longer shows, and a controlled `data` set back to
    // that document is deduped away — leaving the editor on the imperative
    // content while the host's state says otherwise.
    setContentBaseline(blok, {
      markRendered: (content): void => {
        state.lastRenderedData = content;
      },
    });

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
  // readOnly syncs the full normalized pair: `enabled` always, `hideControls`
  // only for the object form (`readOnly.set` toggles IN PLACE — see
  // `readOnly.togglesInPlace` — so no recreation is ever needed).
  watch(
    [
      editor,
      () => normalizeReadOnlyConfig(mergedConfig().readOnly).enabled,
      () => normalizeReadOnlyConfig(mergedConfig().readOnly).hideControls,
      () => typeof mergedConfig().readOnly === 'object',
    ],
    ([ed, readOnlyEnabled, hideControls, isObjectForm]) => {
      if (ed) {
        void (isObjectForm ? ed.readOnly.set(readOnlyEnabled, { hideControls }) : ed.readOnly.set(readOnlyEnabled));
      }
    },
    { immediate: true }
  );

  // hideToolbar toggles the hover toolbar and its gutter in place. Coerces
  // undefined to false (like readOnly) so clearing the option propagates.
  watch(
    [editor, () => mergedConfig().hideToolbar],
    ([ed, hideToolbar]) => {
      if (ed) {
        ed.toolbar.setHidden(Boolean(hideToolbar));
      }
    },
    { immediate: true }
  );

  // toolbarPosition moves the controls between the start/end gutters in place.
  // Unset stays unset (no call), so an app that never passes the prop keeps
  // core's own default rather than having it re-asserted on every boot.
  watch(
    [editor, () => mergedConfig().toolbarPosition],
    ([ed, toolbarPosition]) => {
      if (ed && toolbarPosition !== undefined) {
        ed.toolbar.setPosition(toolbarPosition);
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

  // Theme tokens were construction-only, so a host with a live light/dark
  // toggle had to recreate the editor or hand-write the global stylesheet Blok
  // already injects. Deep-equal-deduped because `tokens` is typically a fresh
  // object literal; `deep: true` so mutating the same object still propagates.
  const appliedTokens: { value: Record<string, string> | undefined } = { value: undefined };

  watch(
    [editor, () => mergedConfig().style?.tokens],
    ([ed, tokens]) => {
      if (!ed || tokens === undefined || deepEqual(tokens, appliedTokens.value)) {
        return;
      }

      appliedTokens.value = { ...tokens };
      ed.tokens.set(tokens);
    },
    { immediate: true, deep: true }
  );

  // `config.i18n` was consumed once during boot, so a host driving a language
  // switcher had to recreate the editor (losing caret, focus and undo stack)
  // to relabel the UI. This drives the runtime `i18n.update` API instead.
  // Deep-equal-deduped and `deep: true` for the same reasons as tokens.
  // `defaultLocale` is not forwarded: it only affects the INITIAL locale
  // resolution, so it is inert after mount.
  /*
   * Seeded with the mount-time value: construction already applied it, so the
   * immediate run is a no-op and only genuine changes push.
   */
  const appliedI18n: { value: BlokConfig['i18n'] | undefined } = { value: mergedConfig().i18n };

  watch(
    [editor, () => mergedConfig().i18n],
    ([ed, i18n]) => {
      if (!ed || i18n === undefined || deepEqual(i18n, appliedI18n.value)) {
        return;
      }

      appliedI18n.value = { ...i18n };

      const { locale, messages, direction } = i18n;

      void ed.i18n.update({
        ...(locale === undefined ? {} : { locale }),
        ...(messages === undefined ? {} : { messages }),
        ...(direction === undefined ? {} : { direction }),
      });
    },
    { immediate: true, deep: true }
  );

  // inlineToolbar re-assigns inline tools in place. Content-compared (not
  // identity-compared) because `boolean | string[]` configs are typically fresh
  // array literals; the baseline is tracked per editor instance so a recreated
  // editor gets the current value applied again. `deep: true` so mutating the
  // same array still propagates (mirrors the tokens watch).
  const appliedInlineToolbar: { editor: Blok | null; value: boolean | string[] | undefined } = {
    editor: null,
    value: undefined,
  };

  watch(
    [editor, () => mergedConfig().inlineToolbar],
    ([ed, inlineToolbar]) => {
      if (!ed || inlineToolbar === undefined) {
        return;
      }

      if (appliedInlineToolbar.editor === ed && deepEqual(inlineToolbar, appliedInlineToolbar.value)) {
        return;
      }

      // De-proxy: copy an array so no Vue reactive proxy reaches core.
      const plain = Array.isArray(inlineToolbar) ? [...inlineToolbar] : inlineToolbar;

      appliedInlineToolbar.editor = ed;
      appliedInlineToolbar.value = plain;
      ed.tools.setInlineToolbar(plain);
    },
    { immediate: true, deep: true }
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

  // Live callback config. Callback presence was frozen at construction and IS
  // the semantics in core (`onSubmit` makes Enter serialize-and-submit instead
  // of splitting the block; `onSave` arms the change pipeline), so a `@save`
  // listener or an "Enter sends" toggle added after mount used to need an
  // editor recreate — losing caret and undo history. Diff presence against what
  // is installed and push genuine flips through the runtime `handlers.set` API,
  // writing `undefined` for a callback that disappeared so the change is
  // reversible. Identity is never diffed: the wrappers forward to the latest
  // config already.
  watch(
    [editor, () => JSON.stringify(readHandlerPresence(mergedConfig()))],
    ([ed]) => {
      if (!ed) {
        return;
      }

      const latest = readHandlerPresence(mergedConfig());
      const applied = state.appliedHandlerPresence;
      const diff: LiveHandlers = {};
      const changed: { value: boolean } = { value: false };

      const sync = <K extends keyof LiveHandlers>(key: K, write: (value: LiveHandlers[K]) => void): void => {
        if (latest[key] === applied[key]) {
          return;
        }

        applied[key] = latest[key];
        changed.value = true;
        write(latest[key] ? handlerWrappers[key] : undefined);
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
        ed.handlers.set(diff);
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

      // Structural comparison (`equalsOutputData`, not a raw deep-equal): a host
      // that persists the editor's own document and hands back a stripped copy —
      // fresh `time`, dropped ids, no `lastEditedAt` stamp — is still echoing
      // content the editor already shows, and re-rendering it would reset the
      // caret for zero visual change. `undefined` means "nothing recorded yet",
      // which is NOT an empty document, so it must never match.
      const baseline = state.lastRenderedData;

      if (baseline !== undefined && equalsOutputData(data, baseline)) {
        return;
      }

      // Under collaboration the document belongs to the sync service, and
      // render() refuses a wholesale replace — so don't attempt one. The prop's
      // premise ("this value IS the document") does not hold here.
      const collaboration = mergedConfig().collaboration;

      if (collaboration !== undefined) {
        if (!state.collaborationWarned) {
          state.collaborationWarned = true;
          console.warn(collaborationDataIgnoredMessage(collaboration.doc));
        }

        return;
      }

      state.lastRenderedData = data;
      // `data` may be null (a controlled "clear to empty"); render() throws on
      // null, so normalize null → { blocks: [] } at the boundary. toRaw(null)
      // stays null, so the helper still sees it.
      state.renderChain = state.renderChain
        .catch(() => undefined)
        .then(() => ed.render(toRenderableData(toRaw(data))));
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
