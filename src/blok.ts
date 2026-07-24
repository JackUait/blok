'use strict';

import type { BlokConfig, API, EditorWidth, Tokens, EditorI18n, I18nUpdateOptions } from '../types';

import { DATA_ATTR } from './components/constants/data-attributes';
import { Core } from './components/core';
import { getBlokVersion, isObject, isFunction } from './components/utils';
import { announce } from './components/utils/announcer';
import {
  readyState,
  registerInstance,
  subscribeReady,
  unregisterInstance,
  whenAllReady,
  type ReadyScopeOptions,
  type ReadyStateSnapshot,
} from './components/utils/ready-registry';
import { highlightBlockArrival } from './components/utils/highlight-block-arrival';
import { destroy as destroyTooltip } from './components/utils/tooltip';
import './components/polyfills';
import type { BlokModules } from './types-internal/blok-modules';

/**
 * Export version as a named export
 */
export const version = getBlokVersion();

/**
 * Re-export DATA_ATTR for querying editor elements
 */
export { DATA_ATTR } from './components/constants/data-attributes';

/**
 * Re-export the stable test-id hooks for targeting editor chrome in tests
 */
export { TEST_ID } from './components/constants/test-ids';

/**
 * Blok
 * @license Apache-2.0
 */
class Blok {
  /**
   * Store user-provided configuration for later export
   */
  private readonly initialConfiguration: BlokConfig|string|undefined;

  /**
   * Promise that resolves when core modules are ready and UI is rendered on the page.
   * Resolves with the fully-initialized Blok instance, so awaiting it narrows a
   * pre-ready reference (see {@link PendingBlok}) to the complete API surface.
   */
  public isReady: Promise<Blok>;

  /**
   * Synchronous render-readiness flag. True once the current render batch has
   * landed in the DOM (mirrors the `data-blok-rendered` wrapper attribute);
   * false before first render and while a re-render is in flight.
   * Defined as an instance getter in the constructor.
   */
  declare public readonly isRendered: boolean;

  /**
   * Runtime theme-tokens API. Assigned dynamically in the constructor
   * (mirroring theme/width/placeholder), so declared here for the type.
   */
  declare public readonly tokens: Tokens;

  /**
   * Runtime i18n API. Assigned dynamically in the constructor as an OWN
   * property so it shadows the read-only `i18n` reached through the API
   * prototype — tools keep getting a view they cannot use to flip the host's
   * locale.
   */
  declare public readonly i18n: EditorI18n;

  /**
   * Stores destroy method implementation.
   * Clear heap occupied by Blok and remove UI components from the DOM.
   */
  public destroy: () => void;

  /** Blok version */
  public static get version(): string {
    return getBlokVersion();
  }

  /**
   * Data attributes used by the editor.
   * Single source of truth for all data-blok-* attributes.
   *
   * @example
   * // Query editor elements
   * document.querySelectorAll(`[${Blok.DATA_ATTR.element}]`);
   *
   * // Check if block is selected
   * block.getAttribute(Blok.DATA_ATTR.selected) === 'true';
   */
  public static DATA_ATTR = DATA_ATTR;

  /**
   * Resolves once every Blok instance in scope has finished booting (each
   * instance's `isReady` has settled — rejections count as settled, so a
   * failed boot never wedges the aggregate).
   *
   * Collective-readiness signal for pages hosting several instances (e.g. a
   * comments list of read-only editors plus a composer): await it before
   * autofocusing or measuring layout, instead of hand-aggregating per-instance
   * `onReady` callbacks.
   *
   * Pass `within` to restrict the wait to instances mounted inside a DOM
   * subtree you own — an unrelated editor elsewhere on the page then cannot
   * hold your gate closed. Pass `settleOn: 'rendered'` to extend readiness
   * from *construction* to *content in the DOM*, which also covers post-boot
   * re-renders (`render(data)`); the default `'ready'` only covers boot.
   *
   * An empty scope resolves immediately. Instances that appear while the
   * returned promise is pending extend the wait; instances constructed after
   * it resolves are not covered — call again for a fresh aggregate, or use
   * `subscribeReady()` for a live signal.
   * @param options - optional DOM scope and readiness depth
   */
  public static whenAllReady(options?: ReadyScopeOptions): Promise<void> {
    return whenAllReady(options);
  }

  /**
   * Synchronous readiness snapshot for a scope: how many instances match, how
   * many are still pending, and whether the scope is settled. An empty scope
   * reports `ready: true`.
   * @param options - optional DOM scope and readiness depth
   */
  public static readyState(options?: ReadyScopeOptions): ReadyStateSnapshot {
    return readyState(options);
  }

  /**
   * Subscribes to readiness changes across all instances (construction, boot,
   * render-state flip, destroy) and returns an unsubscribe function. The
   * listener takes no arguments — re-read `Blok.readyState(scope)` when it
   * fires. Pair with `useSyncExternalStore` or any store adapter to drive UI
   * off editor readiness instead of a one-shot latch.
   * @param listener - called after every readiness change
   */
  public static subscribeReady(listener: () => void): () => void {
    return subscribeReady(listener);
  }

  /**
   * @param {BlokConfig|string|undefined} [configuration] - user configuration
   */
  constructor(configuration?: BlokConfig|string) {
    this.initialConfiguration = isObject(configuration)
      ? { ...configuration }
      : configuration;

    /**
     * Set default onReady function or use the one from configuration if provided
     */

    const onReady = (isObject(configuration) && isFunction(configuration.onReady))
      ? configuration.onReady
      : () => {};

    /**
     * Create a Blok instance
     */
    const blok = new Core(configuration);

    /**
     * Flag to track if destroy() was called before isReady resolved
     */
    const lifecycle = { pendingDestroy: false };

    /**
     * Synchronous render-readiness flag: mirrors the `data-blok-rendered`
     * wrapper attribute (set once a render batch has landed in the DOM,
     * cleared while a re-render is in flight). Unlike `isReady`/`onReady`
     * this needs no await/callback, so consumers coordinating several editor
     * instances (e.g. a comments list) can poll mount state synchronously.
     */
    const getWrapper = (): HTMLElement | undefined => {
      const ui = blok.moduleInstances?.UI as { nodes?: { wrapper?: HTMLElement } } | undefined;

      return ui?.nodes?.wrapper;
    };

    Object.defineProperty(this, 'isRendered', {
      get: (): boolean => getWrapper()?.hasAttribute(DATA_ATTR.rendered) ?? false,
      enumerable: true,
      configurable: true,
    });

    /**
     * Initialize destroy to set the pendingDestroy flag.
     * Will be replaced with the real implementation in exportAPI.
     */
    this.destroy = (): void => {
      lifecycle.pendingDestroy = true;
    };

    /**
     * Expose the theme API immediately so callers can set the theme
     * before isReady resolves.
     *
     * Core defers module construction to a microtask, so ThemeManager
     * doesn't exist yet when this code runs. We buffer set() calls and
     * replay the last one after isReady resolves (after ThemeManager.prepare()
     * has already run, so we override the config-based default correctly).
     *
     * Without this, host apps that call instance.theme?.set('dark')
     * before isReady get a silent no-op (theme is undefined), causing
     * dark theme to fail when the host's state arrives after construction.
     */
    type ThemeMode = Parameters<BlokModules['ThemeManager']['setMode']>[0];

    const themeBuffer = { pendingMode: null as ThemeMode | null };

    const getThemeManager = (): BlokModules['ThemeManager'] | undefined =>
      (blok.moduleInstances as Partial<BlokModules>).ThemeManager;

    (this as Record<string, unknown>).theme = {
      get: (): ThemeMode => {
        const tm = getThemeManager();

        return tm !== undefined ? tm.getMode() : (themeBuffer.pendingMode ?? 'auto');
      },
      set: (mode: ThemeMode): void => {
        themeBuffer.pendingMode = mode;

        // Also apply immediately if ThemeManager is already prepared
        const tm = getThemeManager();

        if (tm !== undefined) {
          tm.setMode(mode);
        }
      },
      getResolved: () => {
        const tm = getThemeManager();

        return tm !== undefined ? tm.getResolved() : 'light';
      },
    };

    /**
     * Width API — expose it on the instance immediately (mirrors the theme API),
     * so host apps can call instance.width.set('full') before isReady without a
     * silent no-op. The chosen mode is buffered and replayed once UI is ready.
     */
    const widthBuffer = { pendingMode: null as EditorWidth | null };

    const getUIModule = (): BlokModules['UI'] | undefined =>
      (blok.moduleInstances as Partial<BlokModules>).UI;

    const readWidthMode = (): EditorWidth => {
      const ui = getUIModule();

      return ui !== undefined ? ui.getWidthMode() : (widthBuffer.pendingMode ?? 'narrow');
    };

    const applyWidthMode = (mode: EditorWidth): void => {
      widthBuffer.pendingMode = mode;

      const ui = getUIModule();

      if (ui !== undefined) {
        ui.setWidthMode(mode);
      }
    };

    (this as Record<string, unknown>).width = {
      get: (): EditorWidth => readWidthMode(),
      set: (mode: EditorWidth): void => applyWidthMode(mode),
      toggle: (): void => applyWidthMode(readWidthMode() === 'full' ? 'narrow' : 'full'),
    };

    /**
     * Placeholder API — exposed immediately (mirrors theme/width) so host apps
     * can call instance.placeholder.set(...) before isReady without a silent
     * no-op. The value is buffered and replayed once BlockManager is ready.
     */
    const placeholderBuffer = { pending: null as string | false | null };

    const getBlockManager = (): BlokModules['BlockManager'] | undefined =>
      (blok.moduleInstances as Partial<BlokModules>).BlockManager;

    const applyPlaceholder = (value: string | false): void => {
      placeholderBuffer.pending = value;

      const bm = getBlockManager();

      if (bm !== undefined) {
        bm.setPlaceholder(value);
      }
    };

    (this as Record<string, unknown>).placeholder = {
      get: (): string | false => {
        if (placeholderBuffer.pending !== null) {
          return placeholderBuffer.pending;
        }

        const cfg = this.initialConfiguration;

        return isObject(cfg) ? ((cfg as BlokConfig).placeholder ?? false) : false;
      },
      set: (value: string | false): void => applyPlaceholder(value),
    };

    /**
     * Theme tokens API — exposed immediately (mirrors theme/width/placeholder)
     * so hosts can flip tokens before isReady without a silent no-op. The set
     * is buffered and replayed once UI is ready.
     *
     * Replace semantics: each call carries the complete token set, mirroring
     * config.style.tokens, so a light/dark flip drops tokens absent from the
     * new palette.
     */
    const tokensBuffer = { pending: null as Record<string, string> | null };

    const applyTokens = (tokens: Record<string, string>): void => {
      tokensBuffer.pending = tokens;

      const ui = getUIModule();

      if (ui !== undefined) {
        ui.setThemeTokens(tokens);
        tokensBuffer.pending = null;
      }
    };

    (this as Record<string, unknown>).tokens = {
      get: (): Record<string, string> => {
        if (tokensBuffer.pending !== null) {
          return { ...tokensBuffer.pending };
        }

        const ui = getUIModule();

        if (ui !== undefined) {
          return ui.getThemeTokens();
        }

        const cfg = this.initialConfiguration;

        return isObject(cfg) ? { ...((cfg as BlokConfig).style?.tokens ?? {}) } : {};
      },
      set: (tokens: Record<string, string>): void => applyTokens(tokens),
    };

    /**
     * i18n API — the read half mirrors what tools get through `api.i18n`, the
     * `update` half is the host-only mutator that makes `config.i18n` live.
     *
     * Every call is routed through `isReady`: the I18n module resolves the
     * configured locale during `prepare()`, so an update issued earlier would
     * otherwise be overwritten by the config a moment later. Post-ready calls
     * cost one microtask.
     */
    const getI18nModule = (): BlokModules['I18n'] | undefined =>
      (blok.moduleInstances as Partial<BlokModules>).I18n;

    (this as Record<string, unknown>).i18n = {
      t: (key: string, vars?: Record<string, string | number>): string =>
        getI18nModule()?.t(key, vars) ?? key,
      has: (key: string): boolean => getI18nModule()?.has(key) ?? false,
      getEnglishTranslation: (key: string): string =>
        getI18nModule()?.getEnglishTranslation(key) ?? '',
      getLocale: (): string => getI18nModule()?.getLocale() ?? 'en',
      getDirection: (): 'ltr' | 'rtl' => getI18nModule()?.getDirection() ?? 'ltr',
      update: async (options: I18nUpdateOptions): Promise<void> => {
        await blok.isReady;

        await getI18nModule()?.update(options);
      },
    } satisfies EditorI18n;

    /**
     * We need to export isReady promise in the constructor
     * as it can be used before other API methods are exported
     * @type {Promise<void>}
     */
    this.isReady = blok.isReady.then(() => {
      if (lifecycle.pendingDestroy) {
        Object.values(blok.moduleInstances)
          .forEach((moduleInstance) => {
            if (moduleInstance === undefined || moduleInstance === null) {
              return;
            }

            if (isFunction((moduleInstance as { markDestroyed?: () => void }).markDestroyed)) {
              (moduleInstance as { markDestroyed: () => void }).markDestroyed();
            }
          });

        Object.values(blok.moduleInstances)
          .forEach((moduleInstance) => {
            if (moduleInstance === undefined || moduleInstance === null) {
              return;
            }

            if (isFunction((moduleInstance as { destroy?: () => void }).destroy)) {
              (moduleInstance as { destroy: () => void }).destroy();
            }

            const listeners = (moduleInstance as { listeners?: { removeAll?: () => void } }).listeners;

            if (listeners && isFunction(listeners.removeAll)) {
              listeners.removeAll();
            }
          });

        destroyTooltip();

        const thisKeys = Object.keys(this) as Array<keyof Blok>;
        for (const field of thisKeys) {
          // eslint-disable-next-line @typescript-eslint/no-dynamic-delete -- needed to clear instance properties
          delete this[field];
        }

        Object.setPrototypeOf(this, null);

        return this;
      }

      this.exportAPI(blok);

      // Apply any theme mode buffered before isReady resolved.
      // ThemeManager.prepare() has already run (sets mode from config),
      // so this overrides the config default with the caller's intent.
      if (themeBuffer.pendingMode !== null) {
        const tm = (blok.moduleInstances as Partial<BlokModules>).ThemeManager;

        if (tm !== undefined) {
          tm.setMode(themeBuffer.pendingMode);
        }
        themeBuffer.pendingMode = null;
      }

      // Apply any width mode buffered before isReady resolved.
      if (widthBuffer.pendingMode !== null) {
        const ui = (blok.moduleInstances as Partial<BlokModules>).UI;

        if (ui !== undefined) {
          ui.setWidthMode(widthBuffer.pendingMode);
        }
        widthBuffer.pendingMode = null;
      }

      // Apply any theme tokens buffered before isReady resolved. UI.prepare()
      // has already injected config.style.tokens, so this replaces them with
      // the caller's intent.
      if (tokensBuffer.pending !== null) {
        const ui = (blok.moduleInstances as Partial<BlokModules>).UI;

        if (ui !== undefined) {
          ui.setThemeTokens(tokensBuffer.pending);
        }
        tokensBuffer.pending = null;
      }

      // Apply any placeholder buffered before isReady resolved.
      if (placeholderBuffer.pending !== null) {
        const bm = (blok.moduleInstances as Partial<BlokModules>).BlockManager;

        if (bm !== undefined) {
          bm.setPlaceholder(placeholderBuffer.pending);
        }
        placeholderBuffer.pending = null;
      }

      // Scroll to the block referenced by the URL hash, if present.
      // isReady resolves only after all blocks are in the DOM (requestIdleCallback fence in Renderer),
      // so no extra polling is needed even on slow connections.
      // However, when consumers pass no `data` in the config and instead call blocks.render()
      // from onReady, the target block won't exist yet. In that case we store the hash
      // on Renderer.pendingHashScroll so BlocksAPI.render() can retry after the real blocks arrive.
      const rawHash = window.location.hash.slice(1);
      const hash = rawHash ? Blok.safeDecodeHash(rawHash) : '';

      if (hash) {
        const el = document.querySelector(`[data-blok-id="${CSS.escape(hash)}"]`);

        if (el) {
          const topOffset = (isObject(this.initialConfiguration)
            ? (this.initialConfiguration as BlokConfig).scrollToBlock?.topOffset
            : undefined) ?? 0;

          Blok.scrollToHashBlock(blok, el, hash, topOffset);
        } else if (blok.moduleInstances.Renderer !== undefined) {
          blok.moduleInstances.Renderer.pendingHashScroll = hash;
        }
      }

      // Hand the fully-exported instance to onReady so callers can drive the
      // editor's API the moment it's ready (parity with the React/Vue/Angular
      // adapters, whose `ready` events all emit the live instance). The argument
      // is optional, so existing zero-arg `onReady` handlers are unaffected.
      onReady(this);

      return this;
    });

    /**
     * Register this instance with the collective-readiness registry (backing
     * the static whenAllReady()) and settle it when the outer isReady chain
     * settles — after exportAPI and onReady have run, and on rejection too so
     * a failed boot never wedges the aggregate. Registered here, after the
     * isReady assignment, so a synchronous constructor throw above cannot
     * leak a pending count.
     */
    const settleReadyRegistry = registerInstance(this, getWrapper);

    this.isReady.then(settleReadyRegistry, settleReadyRegistry);
  }

  /**
   * Export external API methods
   * @param {Core} blok — Blok's instance
   */
  public exportAPI(blok: Core): void {
    const fieldsToExport = [ 'configuration' ];
    const destroy = (): void => {
      // Drop this instance from the readiness registry first, so aggregates
      // scoped to a subtree stop counting an editor that is going away.
      unregisterInstance(this);

      // Mark all modules as destroyed first so any in-flight async work stops gracefully
      Object.values(blok.moduleInstances)
        .forEach((moduleInstance) => {
          if (moduleInstance === undefined || moduleInstance === null) {
            return;
          }

          if (isFunction((moduleInstance as { markDestroyed?: () => void }).markDestroyed)) {
            (moduleInstance as { markDestroyed: () => void }).markDestroyed();
          }
        });

      Object.values(blok.moduleInstances)
        .forEach((moduleInstance) => {
          if (moduleInstance === undefined || moduleInstance === null) {
            return;
          }

          if (isFunction((moduleInstance as { destroy?: () => void }).destroy)) {
            (moduleInstance as { destroy: () => void }).destroy();
          }

          const listeners = (moduleInstance as { listeners?: { removeAll?: () => void } }).listeners;

          if (listeners && isFunction(listeners.removeAll)) {
            listeners.removeAll();
          }
        });

      destroyTooltip();

      const thisKeys = Object.keys(this) as Array<keyof Blok>;
      for (const field of thisKeys) {
        // eslint-disable-next-line @typescript-eslint/no-dynamic-delete -- needed to clear instance properties
        delete this[field];
      }

      Object.setPrototypeOf(this, null);
    };

    fieldsToExport.forEach((field) => {
      if (field !== 'configuration') {
        (this as Record<string, unknown>)[field] = (blok as unknown as Record<string, unknown>)[field];

        return;
      }

      const coreConfiguration = (blok as unknown as { configuration?: BlokConfig|string|undefined }).configuration;
      const configurationToExport = isObject(this.initialConfiguration)
        ? this.initialConfiguration
        : coreConfiguration ?? this.initialConfiguration;

      if (configurationToExport === undefined) {
        return;
      }

      (this as Record<string, unknown>)[field] = configurationToExport;
    });

    this.destroy = destroy;

    const apiMethods = blok.moduleInstances.API.methods;
    const eventsDispatcherApi = blok.moduleInstances.EventsAPI.methods;

    const defineDispatcher = (target: Record<string, unknown>): void => {
      if (!Object.prototype.hasOwnProperty.call(target, 'eventsDispatcher')) {
        Object.defineProperty(target, 'eventsDispatcher', {
          value: eventsDispatcherApi,
          configurable: true,
          enumerable: true,
          writable: false,
        });
      }
    };

    defineDispatcher(apiMethods as unknown as Record<string, unknown>);
    defineDispatcher(this as Record<string, unknown>);

    if (Object.getPrototypeOf(apiMethods) !== Blok.prototype) {
      Object.setPrototypeOf(apiMethods, Blok.prototype);
    }

    Object.setPrototypeOf(this, apiMethods);

    const moduleAliases = Object.create(null) as Record<string, unknown>;
    const moduleInstances = blok.moduleInstances as Partial<BlokModules>;
    const moduleInstancesRecord = moduleInstances as unknown as Record<string, unknown>;

    const getAliasName = (name: string): string => (
      /^[A-Z]+$/.test(name)
        ? name.toLowerCase()
        : name.charAt(0).toLowerCase() + name.slice(1)
    );

    Object.keys(moduleInstancesRecord)
      .forEach((name) => {
        const alias = getAliasName(name);

        Object.defineProperty(moduleAliases, alias, {
          configurable: true,
          enumerable: true,
          get: () => moduleInstancesRecord[name],
        });
      });

    type ToolbarModuleWithSettings = {
      blockSettings?: unknown;
      inlineToolbar?: unknown;
    };

    const toolbarModule = moduleInstances.Toolbar as unknown as ToolbarModuleWithSettings | undefined;
    const blockSettingsModule = moduleInstances.BlockSettings;

    if (toolbarModule !== undefined && blockSettingsModule !== undefined && toolbarModule.blockSettings === undefined) {
      toolbarModule.blockSettings = blockSettingsModule;
    }

    const inlineToolbarModule = moduleInstances.InlineToolbar;

    if (toolbarModule !== undefined && inlineToolbarModule !== undefined && toolbarModule.inlineToolbar === undefined) {
      toolbarModule.inlineToolbar = inlineToolbarModule;
    }

    Object.defineProperty(this, 'module', {
      value: moduleAliases,
      configurable: true,
      enumerable: false,
      writable: false,
    });

    delete (this as Partial<Blok>).exportAPI;

    const shorthands = {
      blocks: {
        clear: 'clear',
        render: 'render',
      },
      caret: {
        focus: 'focus',
      },
      events: {
        on: 'on',
        off: 'off',
        emit: 'emit',
      },
      saver: {
        save: 'save',
      },
    };

    Object.entries(shorthands)
      .forEach(([key, methods]) => {
        Object.entries(methods)
          .forEach(([name, alias]) => {
            const apiKey = key as keyof API;
            const apiMethodGroup = blok.moduleInstances.API.methods[apiKey] as unknown as Record<string, unknown>;

            (this as Record<string, unknown>)[alias] = apiMethodGroup[name];
          });
      });

    // Expose isMobile property directly on the Blok instance
    const uiMethods = blok.moduleInstances.API.methods.ui as unknown as Record<string, unknown>;
    Object.defineProperty(this, 'isMobile', {
      configurable: true,
      enumerable: true,
      get(): boolean {
        return uiMethods.isMobile as boolean;
      },
    });
  }

  /**
   * Decodes a URL hash fragment, falling back to the raw value on malformed percent-sequences.
   * @param raw - raw hash fragment (without leading #)
   */
  private static safeDecodeHash(raw: string): string {
    try {
      return decodeURIComponent(raw);
    } catch {
      // Malformed percent-sequence (e.g. %ZZ) — return raw so no block is matched
      return raw;
    }
  }

  /**
   * Scrolls the located hash target into view, selects it, highlights its
   * arrival, and announces the navigation to assistive technology.
   * @param blok - Core instance
   * @param el - matched block element
   * @param hash - decoded block id
   * @param topOffset - scroll top offset in pixels
   */
  private static scrollToHashBlock(blok: Core, el: Element, hash: string, topOffset: number): void {
    const y = el.getBoundingClientRect().top + window.scrollY - topOffset;

    window.scrollTo({ top: y, behavior: 'smooth' });

    Blok.selectBlockById(blok, hash);
    highlightBlockArrival(el);

    const i18n = (blok.moduleInstances as Partial<BlokModules>).I18n;

    if (i18n !== undefined) {
      announce(i18n.t('a11y.navigatedToBlock'));
    }
  }

  /**
   * Selects the block identified by `id` in BlockManager, if it exists.
   * @param blok - Core instance
   * @param id - decoded block id
   */
  private static selectBlockById(blok: Core, id: string): void {
    const block = blok.moduleInstances.BlockManager.getBlockById(id);

    if (block !== undefined) {
      blok.moduleInstances.BlockSelection.selectBlock(block);
    }
  }
}

export { Blok };
export { Blok as EditorJS };
export default Blok;

/**
 * Compatibility shim for migrating Editor.js custom inline tools.
 * Adapts a legacy `render()→HTMLElement` + `surround`/`checkState` tool
 * into Blok's `render()→MenuConfig` inline tool contract.
 */
export { wrapLegacyInlineTool } from './components/inline-tools/wrap-legacy-inline-tool';

/**
 * Derive an inline tool's sanitizer rule from its MarkSpec — the same
 * derivation the framework adapters use for spec-declared marks.
 */
export { markSanitizerConfig } from './components/marks/mark-engine';

/**
 * Typed event-name constants for editor lifecycle events observable via
 * `blok.events.on(...)`. Prefer these over raw strings to avoid typos and
 * get typed payloads (see {@link BlokEditorEventMap}).
 */
export { BlockRendered, BlocksRendered } from './components/events';

/**
 * Structural comparison and emptiness predicates for saved documents, the
 * loose-wire normalizers, the shared empty-document constant, and the
 * `onSave`-echo window. Semver-guaranteed so consumers never hand-write deep
 * equality for the `data → render → onSave → data` echo round-trip, emptiness
 * gating, a `null`-stripping DTO mapper (which silently drops
 * tunes/parent/content/indent), a `{ blocks: [] }` empty-document literal, or a
 * controlled-echo dedupe window.
 */
export {
  EMPTY_OUTPUT_DATA,
  createEmittedEchoWindow,
  equalsOutputData,
  isEmptyOutputData,
  normalizeOutputData,
  normalizeOutputBlocks,
  toRenderableData,
} from './shared/output-data';

/**
 * Pure hierarchical-spec flattener: turn `children`-nested block specs into the
 * flat `parent`/`content` `OutputBlockData[]` Blok stores, so nested seed data
 * (columns, tables, whole documents) needs no hand-wired id arrays.
 */
export { flattenTree } from './shared/flatten-tree';

/**
 * Single source of truth for the sanitize-allowlist composition. Editors and
 * the view renderer both consume `defineBlokSchema`, so a document can never
 * be displayed under a different allowlist than the one that produced it.
 */
export { composeBaseSanitizeConfig, defineBlokSchema } from './shared/sanitize-schema';
export type { BlokSchemaConfig, BlokViewSchema, DefinedBlokSchema, ResolvedSchemaTool } from './shared/sanitize-schema';
