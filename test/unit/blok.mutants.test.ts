/**
 * PROVEN EQUIVALENT (no test can distinguish these mutants):
 *
 * - exportAPI L583 `field !== 'configuration'` forced false AND its block emptied:
 *   fieldsToExport holds exactly 'configuration', so the branch never runs either way.
 * - constructor L248 `lifecycle = { pendingDestroy: false }` -> `{}`: the flag is
 *   only truthy-checked (L459, L553); an absent property and false are
 *   indistinguishable there, and the L274 write recreates the property.
 * - L620 `getPrototypeOf(apiMethods) !== Blok.prototype` forced true:
 *   setPrototypeOf to a prototype the object already has is a no-op, so the
 *   unconditional call equals the guarded one.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { Mock } from 'vitest';
import type {
  BlokConfig,
  PendingBlok,
  ReadyScopeOptions,
  ReadyStateSnapshot,
} from '../../types';
import type { Block } from '../../src/components/block';

// getBlokVersion() runs at module evaluation of src/blok.ts and reads this
// global; without it the import throws before a single test runs.
(globalThis as { VERSION?: string }).VERSION = '2.31.0-test';

/**
 * Shape the mocked Core hands to Blok. `moduleInstances` is deliberately a
 * loose record: several tests need holes (`undefined`/`null`) and modules that
 * appear only after construction, neither of which `BlokModules` allows.
 */
interface MockCoreInstance {
  configuration: unknown;
  moduleInstances: Record<string, unknown>;
  isReady: Promise<void>;
}

interface CoreState {
  modules: Record<string, unknown>;
  configuration: unknown;
  instances: MockCoreInstance[];
  /** Overrides the promise MockCore hands Blok, so a boot can be made to fail. */
  isReady: Promise<void> | null;
}

const h = vi.hoisted(() => {
  const settleReady = vi.fn();
  const coreState: CoreState = {
    modules: {},
    configuration: undefined,
    instances: [],
    isReady: null,
  };

  return {
    settleReady,
    // Parameters are declared so `mock.calls[0][0]` is a real tuple slot: an
    // inferred zero-arg mock makes the call-args type `[]` and indexing it a
    // type error.
    registerInstance: vi.fn((_instance: unknown, _getWrapper: () => HTMLElement | undefined) => settleReady),
    unregisterInstance: vi.fn(),
    whenAllReady: vi.fn(),
    readyState: vi.fn(),
    subscribeReady: vi.fn(),
    announce: vi.fn(),
    highlightBlockArrival: vi.fn(),
    destroyTooltip: vi.fn(),
    coreState,
  };
});

vi.mock('../../src/components/utils/ready-registry', () => ({
  registerInstance: h.registerInstance,
  unregisterInstance: h.unregisterInstance,
  whenAllReady: h.whenAllReady,
  readyState: h.readyState,
  subscribeReady: h.subscribeReady,
}));

vi.mock('../../src/components/utils/announcer', () => ({
  announce: h.announce,
  registerAnnouncer: vi.fn(),
  destroyAnnouncer: vi.fn(),
}));

vi.mock('../../src/components/utils/highlight-block-arrival', () => ({
  highlightBlockArrival: h.highlightBlockArrival,
}));

vi.mock('../../src/components/utils/tooltip', () => ({
  destroy: h.destroyTooltip,
}));

vi.mock('../../src/components/core', () => {
  /**
   * Stand-in for Core: it hands Blok whatever module record the current test
   * installed, and resolves immediately so `isReady` lands on the next microtask.
   */
  class MockCore {
    public configuration: unknown;
    public moduleInstances: Record<string, unknown>;
    public isReady: Promise<void>;

    /**
     * @param _configuration - user config, ignored: tests drive Core's own
     *   `configuration` field through the shared state instead
     */
    public constructor(_configuration?: unknown) {
      this.configuration = h.coreState.configuration;
      this.moduleInstances = h.coreState.modules;
      this.isReady = h.coreState.isReady ?? Promise.resolve();
      h.coreState.instances.push(this);
    }
  }

  return { Core: MockCore };
});

vi.mock('../../src/components/polyfills', () => ({}));

import { Blok } from '../../src/blok';

/** Module that records the teardown calls `destroy()` is supposed to make. */
interface Probe {
  markDestroyed: Mock;
  destroy: Mock;
  listeners: { removeAll: Mock };
}

interface Kit {
  modules: Record<string, unknown>;
  probe: Probe;
  ui: {
    nodes: { wrapper?: HTMLElement; holder?: HTMLElement };
    getWidthMode: Mock;
    setWidthMode: Mock;
    getThemeTokens: Mock;
    setThemeTokens: Mock;
  };
  themeManager: { getMode: Mock; setMode: Mock; getResolved: Mock };
  blockManager: { setPlaceholder: Mock; getBlockById: Mock };
  blockSelection: { selectBlock: Mock };
  i18n: {
    t: Mock;
    has: Mock;
    getEnglishTranslation: Mock;
    getLocale: Mock;
    getDirection: Mock;
    update: Mock;
  };
  renderer: { pendingHashScroll: string | null };
  toolbar: { blockSettings: unknown; inlineToolbar: unknown };
  toolbarWrites: { blockSettings: unknown[]; inlineToolbar: unknown[] };
  blockSettings: Record<string, unknown>;
  inlineToolbar: Record<string, unknown>;
  apiMethods: Record<string, unknown>;
  eventsMethods: Record<string, unknown>;
  uiMethods: { isMobile: boolean };
}

interface KitOptions {
  ui?: boolean;
  themeManager?: boolean;
  blockManager?: boolean;
  blockSelection?: boolean;
  i18n?: boolean;
  renderer?: boolean;
  toolbar?: boolean;
  blockSettings?: boolean;
  inlineToolbar?: boolean;
  /** Reuse one `API.methods` object across two editors (dispatcher-guard test). */
  apiMethods?: Record<string, unknown>;
}

/** Post-boot surface exportAPI installs, none of which is on the source class. */
interface ExportedBlok {
  configuration?: unknown;
  eventsDispatcher: unknown;
  isMobile: boolean;
  module: Record<string, unknown>;
}

const makeApiMethods = (uiMethods: { isMobile: boolean }): Record<string, unknown> => ({
  blocks: {
    clear: vi.fn(),
    render: vi.fn(),
  },
  caret: { focus: vi.fn() },
  events: {
    on: vi.fn(),
    off: vi.fn(),
    emit: vi.fn(),
  },
  saver: { save: vi.fn() },
  ui: uiMethods,
});

const makeKit = (options: KitOptions = {}): Kit => {
  const probe: Probe = {
    markDestroyed: vi.fn(),
    destroy: vi.fn(),
    listeners: { removeAll: vi.fn() },
  };
  const ui = {
    nodes: {} as { wrapper?: HTMLElement; holder?: HTMLElement },
    getWidthMode: vi.fn(() => 'narrow'),
    setWidthMode: vi.fn(),
    getThemeTokens: vi.fn(() => ({})),
    setThemeTokens: vi.fn(),
  };
  const themeManager = {
    getMode: vi.fn(() => 'auto'),
    setMode: vi.fn(),
    getResolved: vi.fn(() => 'light'),
  };
  const blockManager = {
    setPlaceholder: vi.fn(),
    getBlockById: vi.fn(() => undefined),
  };
  const blockSelection = { selectBlock: vi.fn() };
  const i18n = {
    t: vi.fn((key: string) => `t:${key}`),
    has: vi.fn(() => true),
    getEnglishTranslation: vi.fn(() => 'english'),
    getLocale: vi.fn(() => 'fr'),
    getDirection: vi.fn(() => 'rtl'),
    update: vi.fn(() => Promise.resolve()),
  };
  const renderer = { pendingHashScroll: null as string | null };
  const toolbarWrites = {
    blockSettings: [] as unknown[],
    inlineToolbar: [] as unknown[],
  };
  let blockSettingsSlot: unknown;
  let inlineToolbarSlot: unknown;
  // Accessors, not plain fields: the only observable effect of the wiring
  // guards at exportAPI is WHETHER the slot is written, and writing `undefined`
  // over `undefined` is invisible to a plain read.
  const toolbar = {
    get blockSettings(): unknown {
      return blockSettingsSlot;
    },
    set blockSettings(value: unknown) {
      toolbarWrites.blockSettings.push(value);
      blockSettingsSlot = value;
    },
    get inlineToolbar(): unknown {
      return inlineToolbarSlot;
    },
    set inlineToolbar(value: unknown) {
      toolbarWrites.inlineToolbar.push(value);
      inlineToolbarSlot = value;
    },
  };
  const blockSettings = { name: 'BlockSettings' };
  const inlineToolbar = { name: 'InlineToolbar' };
  const uiMethods = { isMobile: true };
  const apiMethods = options.apiMethods ?? makeApiMethods(uiMethods);
  const eventsMethods = {
    on: vi.fn(),
    off: vi.fn(),
    emit: vi.fn(),
  };

  const modules: Record<string, unknown> = {
    API: { methods: apiMethods },
    EventsAPI: { methods: eventsMethods },
    Probe: probe,
    // Two holes: destroy() walks Object.values() and must survive both.
    MissingModule: undefined,
    NulledModule: null,
  };

  if (options.ui !== false) {
    modules.UI = ui;
  }
  if (options.themeManager !== false) {
    modules.ThemeManager = themeManager;
  }
  if (options.blockManager !== false) {
    modules.BlockManager = blockManager;
  }
  if (options.blockSelection !== false) {
    modules.BlockSelection = blockSelection;
  }
  if (options.i18n !== false) {
    modules.I18n = i18n;
  }
  if (options.renderer !== false) {
    modules.Renderer = renderer;
  }
  if (options.toolbar !== false) {
    modules.Toolbar = toolbar;
  }
  if (options.blockSettings !== false) {
    modules.BlockSettings = blockSettings;
  }
  if (options.inlineToolbar !== false) {
    modules.InlineToolbar = inlineToolbar;
  }

  return {
    modules,
    probe,
    ui,
    themeManager,
    blockManager,
    blockSelection,
    i18n,
    renderer,
    toolbar,
    toolbarWrites,
    blockSettings,
    inlineToolbar,
    apiMethods,
    eventsMethods,
    uiMethods,
  };
};

const install = (kit: Kit): Kit => {
  h.coreState.modules = kit.modules;

  return kit;
};

const pendingOf = (editor: Blok): PendingBlok => editor as unknown as PendingBlok;
const exportedOf = (editor: Blok): ExportedBlok => editor as unknown as ExportedBlok;

/** jsdom refuses direct assignment to window.location, so swap the object. */
const setHash = (hash: string): void => {
  Object.defineProperty(window, 'location', {
    value: { ...window.location, hash },
    writable: true,
    configurable: true,
  });
};

const setScrollY = (value: number): void => {
  Object.defineProperty(window, 'scrollY', {
    value,
    writable: true,
    configurable: true,
  });
};

/** Element whose viewport top is pinned, so the scroll arithmetic is exact. */
const blockElement = (id: string, top: number): HTMLElement => {
  const el = document.createElement('div');

  el.setAttribute('data-blok-id', id);
  el.getBoundingClientRect = (): DOMRect => ({
    top,
    bottom: top,
    left: 0,
    right: 0,
    width: 0,
    height: 0,
    x: 0,
    y: top,
    toJSON: () => ({}),
  });
  document.body.appendChild(el);

  return el;
};

describe('Blok entry point — mutation coverage', () => {
  let scrollTo: Mock;
  let originalScrollTo: typeof window.scrollTo;

  beforeEach(() => {
    vi.clearAllMocks();

    h.registerInstance.mockImplementation(() => h.settleReady);
    h.coreState.modules = {};
    h.coreState.configuration = {};
    h.coreState.instances = [];
    h.coreState.isReady = null;

    originalScrollTo = window.scrollTo;
    scrollTo = vi.fn();
    window.scrollTo = scrollTo;

    setHash('');
    setScrollY(0);
    document.body.innerHTML = '';
  });

  afterEach(() => {
    vi.restoreAllMocks();
    window.scrollTo = originalScrollTo;
    setHash('');
    document.body.innerHTML = '';
  });

  // -------------------------------------------------------------------------
  // Static readiness surface
  // -------------------------------------------------------------------------

  describe('static readiness delegates', () => {
    it('whenAllReady hands the caller scope to the registry and returns its promise', async () => {
      const scope: ReadyScopeOptions = {
        within: document.body,
        settleOn: 'rendered',
      };
      const promise = Promise.resolve();

      h.whenAllReady.mockReturnValue(promise);

      expect(Blok.whenAllReady(scope)).toBe(promise);
      expect(h.whenAllReady).toHaveBeenCalledWith(scope);

      await promise;
    });

    it('readyState returns the registry snapshot for the caller scope', () => {
      const snapshot: ReadyStateSnapshot = {
        total: 3,
        pending: 2,
        ready: false,
      };
      const scope: ReadyScopeOptions = { settleOn: 'ready' };

      h.readyState.mockReturnValue(snapshot);

      expect(Blok.readyState(scope)).toBe(snapshot);
      expect(h.readyState).toHaveBeenCalledWith(scope);
    });

    it('subscribeReady returns the registry unsubscribe for the caller listener', () => {
      const unsubscribe = vi.fn();
      const listener = vi.fn();

      h.subscribeReady.mockReturnValue(unsubscribe);

      expect(Blok.subscribeReady(listener)).toBe(unsubscribe);
      expect(h.subscribeReady.mock.calls[0][0]).toBe(listener);
    });
  });

  // -------------------------------------------------------------------------
  // isRendered
  // -------------------------------------------------------------------------

  describe('isRendered', () => {
    it('is false, not a throw, while the UI module does not exist yet', () => {
      install(makeKit({ ui: false }));

      const editor = new Blok({});

      expect(editor.isRendered).toBe(false);
    });

    it('is false while the UI module exists but no render batch has landed', () => {
      const kit = install(makeKit());

      kit.ui.nodes.wrapper = document.createElement('div');

      const editor = new Blok({});

      expect(editor.isRendered).toBe(false);
    });

    it('mirrors the rendered attribute on the UI wrapper', () => {
      const kit = install(makeKit());
      const wrapper = document.createElement('div');

      wrapper.setAttribute('data-blok-rendered', 'true');
      kit.ui.nodes.wrapper = wrapper;

      const editor = new Blok({});

      expect(editor.isRendered).toBe(true);
    });

    it('is enumerable, so a snapshot of the instance carries it', () => {
      install(makeKit());

      const editor = new Blok({});
      const descriptor = Object.getOwnPropertyDescriptor(editor, 'isRendered');

      expect(descriptor?.enumerable).toBe(true);
      expect(Object.keys(editor)).toContain('isRendered');
    });
  });

  // -------------------------------------------------------------------------
  // Theme API
  // -------------------------------------------------------------------------

  describe('theme API', () => {
    it('reads the live mode from ThemeManager rather than the buffer default', () => {
      const kit = install(makeKit());

      kit.themeManager.getMode.mockReturnValue('dark');

      const editor = new Blok({});

      expect(pendingOf(editor).theme.get()).toBe('dark');
    });

    it('reads the resolved theme from ThemeManager rather than the light default', () => {
      const kit = install(makeKit());

      kit.themeManager.getResolved.mockReturnValue('dark');

      const editor = new Blok({});

      expect(pendingOf(editor).theme.getResolved()).toBe('dark');
    });

    it('replays a pre-ready set once ThemeManager appears', async () => {
      const kit = install(makeKit({ themeManager: false }));
      const editor = new Blok({});

      pendingOf(editor).theme.set('dark');
      kit.modules.ThemeManager = kit.themeManager;

      await editor.isReady;

      expect(kit.themeManager.setMode).toHaveBeenCalledTimes(1);
      expect(kit.themeManager.setMode).toHaveBeenCalledWith('dark');
    });

    it('boots without touching ThemeManager when nothing was buffered', async () => {
      const kit = install(makeKit());
      const editor = new Blok({});

      await editor.isReady;

      // A replay that fires unconditionally would push `null`/`undefined` over
      // the mode ThemeManager.prepare() resolved from config.
      expect(kit.themeManager.setMode).not.toHaveBeenCalled();
    });

    it('resolves ready when a pre-ready set never finds a ThemeManager', async () => {
      install(makeKit({ themeManager: false }));

      const editor = new Blok({});

      pendingOf(editor).theme.set('dark');

      await expect(editor.isReady).resolves.toBe(editor);
    });
  });

  // -------------------------------------------------------------------------
  // Width API
  // -------------------------------------------------------------------------

  describe('width API', () => {
    it('reads the live mode from UI rather than the buffer default', () => {
      const kit = install(makeKit());

      kit.ui.getWidthMode.mockReturnValue('full');

      const editor = new Blok({});

      expect(pendingOf(editor).width.get()).toBe('full');
    });

    it('replays a pre-ready set once UI appears', async () => {
      const kit = install(makeKit({ ui: false }));
      const editor = new Blok({});

      pendingOf(editor).width.set('full');
      kit.modules.UI = kit.ui;

      await editor.isReady;

      expect(kit.ui.setWidthMode).toHaveBeenCalledTimes(1);
      expect(kit.ui.setWidthMode).toHaveBeenCalledWith('full');
    });

    it('boots without touching the UI width when nothing was buffered', async () => {
      const kit = install(makeKit());
      const editor = new Blok({});

      await editor.isReady;

      expect(kit.ui.setWidthMode).not.toHaveBeenCalled();
    });

    it('resolves ready when a pre-ready set never finds a UI module', async () => {
      install(makeKit({ ui: false }));

      const editor = new Blok({});

      pendingOf(editor).width.set('full');

      await expect(editor.isReady).resolves.toBe(editor);
    });
  });

  // -------------------------------------------------------------------------
  // Placeholder API
  // -------------------------------------------------------------------------

  describe('placeholder API', () => {
    it('reads false for an object config that carries no placeholder', () => {
      install(makeKit());

      const editor = new Blok({ holder: 'blok' });

      expect(pendingOf(editor).placeholder.get()).toBe(false);
    });

    it('reads false for a bare holder-id config', () => {
      install(makeKit());

      const editor = new Blok('blok');

      expect(pendingOf(editor).placeholder.get()).toBe(false);
    });

    it('reads the configured placeholder before anything is set', () => {
      install(makeKit());

      const editor = new Blok({ placeholder: 'Start typing…' });

      expect(pendingOf(editor).placeholder.get()).toBe('Start typing…');
    });

    it('boots without touching BlockManager when nothing was buffered', async () => {
      const kit = install(makeKit());
      const editor = new Blok({});

      await editor.isReady;

      expect(kit.blockManager.setPlaceholder).not.toHaveBeenCalled();
    });

    it('resolves ready when a pre-ready set never finds a BlockManager', async () => {
      install(makeKit({ blockManager: false }));

      const editor = new Blok({});

      pendingOf(editor).placeholder.set('later');

      await expect(editor.isReady).resolves.toBe(editor);
    });
  });

  // -------------------------------------------------------------------------
  // Tokens API
  // -------------------------------------------------------------------------

  describe('tokens API', () => {
    it('exposes get and set on the instance before ready', () => {
      install(makeKit());

      const editor = new Blok({});

      expect(typeof pendingOf(editor).tokens.get).toBe('function');
      expect(typeof pendingOf(editor).tokens.set).toBe('function');
    });

    it('pushes a set straight through to UI when the module already exists', () => {
      const kit = install(makeKit());
      const editor = new Blok({});

      pendingOf(editor).tokens.set({ '--blok-color': 'red' });

      expect(kit.ui.setThemeTokens).toHaveBeenCalledTimes(1);
      expect(kit.ui.setThemeTokens).toHaveBeenCalledWith({ '--blok-color': 'red' });
    });

    it('does not throw when a set happens before the UI module exists', () => {
      install(makeKit({ ui: false }));

      const editor = new Blok({});

      expect(() => pendingOf(editor).tokens.set({ '--blok-color': 'red' })).not.toThrow();
    });

    it('reads the buffered set back before UI exists', () => {
      install(makeKit({ ui: false }));

      const editor = new Blok({});

      pendingOf(editor).tokens.set({ '--blok-color': 'red' });

      expect(pendingOf(editor).tokens.get()).toEqual({ '--blok-color': 'red' });
    });

    it('reads the live UI tokens once the module exists', () => {
      const kit = install(makeKit());

      kit.ui.getThemeTokens.mockReturnValue({ '--blok-color': 'blue' });

      const editor = new Blok({});

      expect(pendingOf(editor).tokens.get()).toEqual({ '--blok-color': 'blue' });
    });

    it('falls back to config.style.tokens with no UI module and nothing buffered', () => {
      install(makeKit({ ui: false }));

      const editor = new Blok({ style: { tokens: { '--blok-color': 'green' } } });

      expect(pendingOf(editor).tokens.get()).toEqual({ '--blok-color': 'green' });
    });

    it('reads an empty set for an object config with no style block', () => {
      install(makeKit({ ui: false }));

      const editor = new Blok({ holder: 'blok' });

      expect(pendingOf(editor).tokens.get()).toEqual({});
    });

    it('reads an empty set for a bare holder-id config', () => {
      install(makeKit({ ui: false }));

      const editor = new Blok('blok');

      expect(pendingOf(editor).tokens.get()).toEqual({});
    });

    it('replays a pre-ready set once UI appears', async () => {
      const kit = install(makeKit({ ui: false }));
      const editor = new Blok({});

      pendingOf(editor).tokens.set({ '--blok-color': 'red' });
      kit.modules.UI = kit.ui;

      await editor.isReady;

      expect(kit.ui.setThemeTokens).toHaveBeenCalledTimes(1);
      expect(kit.ui.setThemeTokens).toHaveBeenCalledWith({ '--blok-color': 'red' });
    });

    it('boots without replacing UI tokens when nothing was buffered', async () => {
      const kit = install(makeKit());
      const editor = new Blok({});

      await editor.isReady;

      expect(kit.ui.setThemeTokens).not.toHaveBeenCalled();
    });

    it('resolves ready when a pre-ready set never finds a UI module', async () => {
      install(makeKit({ ui: false }));

      const editor = new Blok({});

      pendingOf(editor).tokens.set({ '--blok-color': 'red' });

      await expect(editor.isReady).resolves.toBe(editor);
    });
  });

  // -------------------------------------------------------------------------
  // i18n API
  // -------------------------------------------------------------------------

  describe('i18n API', () => {
    it('routes every read through the I18n module', () => {
      install(makeKit());

      const editor = new Blok({});
      const { i18n } = pendingOf(editor);

      expect(i18n.t('a.b', { n: 1 })).toBe('t:a.b');
      expect(i18n.has('a.b')).toBe(true);
      expect(i18n.getEnglishTranslation('a.b')).toBe('english');
      expect(i18n.getLocale()).toBe('fr');
      expect(i18n.getDirection()).toBe('rtl');
    });

    it('passes the key and vars through to the module', () => {
      const kit = install(makeKit());
      const editor = new Blok({});

      pendingOf(editor).i18n.t('a.b', { n: 1 });

      expect(kit.i18n.t).toHaveBeenCalledWith('a.b', { n: 1 });
    });

    it('falls back to safe defaults while the I18n module does not exist', () => {
      install(makeKit({ i18n: false }));

      const editor = new Blok({});
      const { i18n } = pendingOf(editor);

      expect(i18n.t('a.b')).toBe('a.b');
      expect(i18n.has('a.b')).toBe(false);
      expect(i18n.getEnglishTranslation('a.b')).toBe('');
      expect(i18n.getLocale()).toBe('en');
      expect(i18n.getDirection()).toBe('ltr');
    });

    it('forwards update to the module after the editor is ready', async () => {
      const kit = install(makeKit());
      const editor = new Blok({});

      await pendingOf(editor).i18n.update({ locale: 'fr' });

      expect(kit.i18n.update).toHaveBeenCalledWith({ locale: 'fr' });
    });

    it('resolves update to nothing when no I18n module exists', async () => {
      install(makeKit({ i18n: false }));

      const editor = new Blok({});

      await expect(pendingOf(editor).i18n.update({ locale: 'fr' })).resolves.toBeUndefined();
    });
  });

  // -------------------------------------------------------------------------
  // Readiness registry wiring
  // -------------------------------------------------------------------------

  describe('readiness registry', () => {
    it('settles the registered instance once the ready chain settles', async () => {
      install(makeKit());

      const editor = new Blok({});

      expect(h.registerInstance.mock.calls[0][0]).toBe(editor);
      expect(h.settleReady).not.toHaveBeenCalled();

      await editor.isReady;

      expect(h.settleReady).toHaveBeenCalled();
    });

    it('drops the instance from the registry when destroy runs', async () => {
      install(makeKit());

      const editor = new Blok({});

      await editor.isReady;
      editor.destroy();

      expect(h.unregisterInstance.mock.calls[0][0]).toBe(editor);
    });
  });

  // -------------------------------------------------------------------------
  // destroy() before isReady resolved
  // -------------------------------------------------------------------------

  describe('destroy before ready', () => {
    it('marks modules destroyed, destroys them, drops their listeners and the tooltip', async () => {
      const kit = install(makeKit());
      const editor = new Blok({});
      const ready = editor.isReady;

      editor.destroy();

      await ready;

      expect(kit.probe.markDestroyed).toHaveBeenCalledTimes(1);
      expect(kit.probe.destroy).toHaveBeenCalledTimes(1);
      expect(kit.probe.listeners.removeAll).toHaveBeenCalledTimes(1);
      expect(h.destroyTooltip).toHaveBeenCalled();
    });

    it('marks every module destroyed before destroying any of them', async () => {
      const order: string[] = [];
      const kit = install(makeKit());

      kit.probe.markDestroyed.mockImplementation(() => order.push('mark'));
      kit.probe.destroy.mockImplementation(() => order.push('destroy'));

      const editor = new Blok({});
      const ready = editor.isReady;

      editor.destroy();

      await ready;

      expect(order).toEqual([ 'mark', 'destroy' ]);
    });

    it('clears every own field off the instance', async () => {
      install(makeKit());

      const editor = new Blok({});
      const ready = editor.isReady;

      editor.destroy();

      await ready;

      expect(Object.keys(editor)).toEqual([]);
      expect(Object.getPrototypeOf(editor)).toBeNull();
    });

    it('never exports the API when destroy landed first', async () => {
      install(makeKit());

      const editor = new Blok({});
      const ready = editor.isReady;

      editor.destroy();

      await ready;

      expect(Object.prototype.hasOwnProperty.call(editor, 'configuration')).toBe(false);
    });

    // Settling the registry marks the entry booted and hangs a render-state
    // MutationObserver off the wrapper, so an entry left behind here outlives
    // the editor and holds every later `whenAllReady` aggregate open.
    it('drops the instance from the registry', async () => {
      install(makeKit());

      const editor = new Blok({});
      const ready = editor.isReady;

      editor.destroy();

      await ready;

      expect(h.unregisterInstance.mock.calls[0][0]).toBe(editor);
    });
  });

  // -------------------------------------------------------------------------
  // Boot rejected (persistence.load() failed) — the editor is already live
  // -------------------------------------------------------------------------

  describe('boot failure', () => {
    /** Makes the next MockCore hand Blok a promise the test rejects by hand. */
    const failingBoot = (): (error: Error) => void => {
      let reject: (error: Error) => void = () => {};

      h.coreState.isReady = new Promise<void>((_resolve, r) => { reject = r; });

      return reject;
    };

    it('installs the real teardown so a later destroy() releases everything', async () => {
      const kit = install(makeKit());
      const reject = failingBoot();
      const editor = new Blok({});
      const settled = editor.isReady.catch((error: unknown) => error);

      reject(new Error('offline'));
      await settled;

      editor.destroy();

      expect(kit.probe.markDestroyed).toHaveBeenCalledTimes(1);
      expect(kit.probe.destroy).toHaveBeenCalledTimes(1);
      expect(kit.probe.listeners.removeAll).toHaveBeenCalledTimes(1);
      expect(h.destroyTooltip).toHaveBeenCalled();
      expect(h.unregisterInstance.mock.calls[0][0]).toBe(editor);
    });

    it('tears down without a second call when destroy() landed before the rejection', async () => {
      const kit = install(makeKit());
      const reject = failingBoot();
      const editor = new Blok({});
      const settled = editor.isReady.catch((error: unknown) => error);

      editor.destroy();
      reject(new Error('offline'));
      await settled;

      expect(kit.probe.destroy).toHaveBeenCalledTimes(1);
      expect(h.unregisterInstance.mock.calls[0][0]).toBe(editor);
    });

    it('never exports the API', async () => {
      install(makeKit());
      const reject = failingBoot();
      const editor = new Blok({});
      const settled = editor.isReady.catch((error: unknown) => error);

      reject(new Error('offline'));
      await settled;

      expect(Object.prototype.hasOwnProperty.call(editor, 'configuration')).toBe(false);
    });

    it('still rejects isReady with the boot error', async () => {
      install(makeKit());
      const reject = failingBoot();
      const editor = new Blok({});
      const failure = new Error('offline');
      const settled = expect(editor.isReady).rejects.toBe(failure);

      reject(failure);
      await settled;
    });
  });

  // -------------------------------------------------------------------------
  // destroy() after isReady resolved
  // -------------------------------------------------------------------------

  describe('destroy after ready', () => {
    it('marks modules destroyed, destroys them and drops their listeners', async () => {
      const kit = install(makeKit());
      const editor = new Blok({});

      await editor.isReady;
      editor.destroy();

      expect(kit.probe.markDestroyed).toHaveBeenCalledTimes(1);
      expect(kit.probe.destroy).toHaveBeenCalledTimes(1);
      expect(kit.probe.listeners.removeAll).toHaveBeenCalledTimes(1);
    });

    it('marks every module destroyed before destroying any of them', async () => {
      const order: string[] = [];
      const kit = install(makeKit());

      kit.probe.markDestroyed.mockImplementation(() => order.push('mark'));
      kit.probe.destroy.mockImplementation(() => order.push('destroy'));

      const editor = new Blok({});

      await editor.isReady;
      editor.destroy();

      expect(order).toEqual([ 'mark', 'destroy' ]);
    });

    it('clears every own field off the instance', async () => {
      install(makeKit());

      const editor = new Blok({});

      await editor.isReady;
      editor.destroy();

      expect(Object.keys(editor)).toEqual([]);
      expect(Object.getPrototypeOf(editor)).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // exportAPI — configuration
  // -------------------------------------------------------------------------

  describe('exported configuration', () => {
    it('exports the object configuration the caller handed in', async () => {
      install(makeKit());

      const config: BlokConfig = { holder: 'blok' };
      const editor = new Blok(config);

      await editor.isReady;

      expect(exportedOf(editor).configuration).toEqual(config);
    });

    it('prefers the configuration Core normalized when the caller passed a holder id', async () => {
      install(makeKit());

      h.coreState.configuration = { holder: 'blok' };

      const editor = new Blok('blok');

      await editor.isReady;

      // A string config is not an object, so Core's normalized config wins —
      // exporting the raw holder id would hand consumers a string where the
      // published type promises BlokConfig.
      expect(exportedOf(editor).configuration).toBe(h.coreState.instances[0].configuration);
    });

    it('omits the configuration key entirely when neither side has one', async () => {
      install(makeKit());

      h.coreState.configuration = undefined;

      const editor = new Blok();

      await editor.isReady;

      expect(Object.prototype.hasOwnProperty.call(editor, 'configuration')).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // exportAPI — eventsDispatcher
  // -------------------------------------------------------------------------

  describe('eventsDispatcher', () => {
    it('is an own, enumerable, non-writable, configurable property of the instance', async () => {
      const kit = install(makeKit());
      const editor = new Blok({});

      await editor.isReady;

      const descriptor = Object.getOwnPropertyDescriptor(editor, 'eventsDispatcher');

      expect(descriptor?.value).toBe(kit.eventsMethods);
      expect(descriptor?.enumerable).toBe(true);
      expect(descriptor?.writable).toBe(false);
      expect(descriptor?.configurable).toBe(true);
    });

    it('is also an own property of the API methods the instance inherits from', async () => {
      const kit = install(makeKit());
      const editor = new Blok({});

      await editor.isReady;

      const proto = Object.getPrototypeOf(editor) as Record<string, unknown>;
      const descriptor = Object.getOwnPropertyDescriptor(proto, 'eventsDispatcher');

      expect(proto).toBe(kit.apiMethods);
      expect(descriptor?.value).toBe(kit.eventsMethods);
    });

    it('leaves a dispatcher already defined on shared API methods alone', async () => {
      const first = install(makeKit());
      const firstEditor = new Blok({});

      await firstEditor.isReady;

      const second = install(makeKit({ apiMethods: first.apiMethods }));
      const secondEditor = new Blok({});

      await secondEditor.isReady;

      // Redefining would repoint a live editor's dispatcher at another
      // editor's event bus.
      expect(first.apiMethods.eventsDispatcher).toBe(first.eventsMethods);
      expect(second.eventsMethods).not.toBe(first.eventsMethods);
    });

    it('leaves the instance an instance of Blok', async () => {
      install(makeKit());

      const editor = new Blok({});

      await editor.isReady;

      expect(editor).toBeInstanceOf(Blok);
    });
  });

  // -------------------------------------------------------------------------
  // exportAPI — module aliases
  // -------------------------------------------------------------------------

  describe('module aliases', () => {
    it('lower-cases an all-caps module name whole and only the head of a mixed one', async () => {
      const kit = install(makeKit());
      const editor = new Blok({});

      await editor.isReady;

      const aliases = exportedOf(editor).module;

      expect(aliases.ui).toBe(kit.ui);
      expect(aliases.blockManager).toBe(kit.blockManager);
      // Trailing caps must survive: EventsAPI is not all-caps, so only its
      // first character is lowered.
      expect(aliases.eventsAPI).toBe(kit.modules.EventsAPI);
    });

    it('reads through to the live module instance rather than a snapshot', async () => {
      const kit = install(makeKit());
      const editor = new Blok({});

      await editor.isReady;

      const replacement = { name: 'replacement' };

      kit.modules.BlockManager = replacement;

      expect(exportedOf(editor).module.blockManager).toBe(replacement);
    });

    it('exposes each alias as an enumerable, configurable property', async () => {
      install(makeKit());

      const editor = new Blok({});

      await editor.isReady;

      const aliases = exportedOf(editor).module;
      const descriptor = Object.getOwnPropertyDescriptor(aliases, 'ui');

      expect(descriptor?.enumerable).toBe(true);
      expect(descriptor?.configurable).toBe(true);
      expect(Object.keys(aliases)).toContain('ui');
    });
  });

  // -------------------------------------------------------------------------
  // exportAPI — toolbar back-references
  // -------------------------------------------------------------------------

  describe('toolbar back-references', () => {
    it('wires BlockSettings and InlineToolbar onto the Toolbar module', async () => {
      const kit = install(makeKit());
      const editor = new Blok({});

      await editor.isReady;

      expect(kit.toolbar.blockSettings).toBe(kit.blockSettings);
      expect(kit.toolbar.inlineToolbar).toBe(kit.inlineToolbar);
    });

    it('does not write a missing BlockSettings onto the Toolbar module', async () => {
      const kit = install(makeKit({ blockSettings: false }));
      const editor = new Blok({});

      await editor.isReady;

      expect(kit.toolbarWrites.blockSettings).toEqual([]);
    });

    it('does not write a missing InlineToolbar onto the Toolbar module', async () => {
      const kit = install(makeKit({ inlineToolbar: false }));
      const editor = new Blok({});

      await editor.isReady;

      expect(kit.toolbarWrites.inlineToolbar).toEqual([]);
    });

    it('boots with no Toolbar module at all', async () => {
      install(makeKit({ toolbar: false }));

      const editor = new Blok({});

      await expect(editor.isReady).resolves.toBe(editor);
    });
  });

  // -------------------------------------------------------------------------
  // exportAPI — isMobile
  // -------------------------------------------------------------------------

  describe('isMobile', () => {
    it('reads through to the UI API on every access', async () => {
      const kit = install(makeKit());
      const editor = new Blok({});

      await editor.isReady;

      expect(exportedOf(editor).isMobile).toBe(true);

      kit.uiMethods.isMobile = false;

      expect(exportedOf(editor).isMobile).toBe(false);
    });

    it('is an enumerable accessor, not a frozen snapshot', async () => {
      install(makeKit());

      const editor = new Blok({});

      await editor.isReady;

      const descriptor = Object.getOwnPropertyDescriptor(editor, 'isMobile');

      expect(typeof descriptor?.get).toBe('function');
      expect(descriptor?.enumerable).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // Hash navigation
  // -------------------------------------------------------------------------

  describe('hash navigation', () => {
    it('scrolls the hash target into view, offset by scrollY and the configured top offset', async () => {
      install(makeKit());
      setHash('#blk-1');
      setScrollY(50);
      blockElement('blk-1', 100);

      const editor = new Blok({ scrollToBlock: { topOffset: 20 } });

      await editor.isReady;

      expect(scrollTo).toHaveBeenCalledWith({
        top: 130,
        behavior: 'smooth',
      });
    });

    it('treats a missing scrollToBlock config as a zero top offset', async () => {
      install(makeKit());
      setHash('#blk-1');
      setScrollY(50);
      blockElement('blk-1', 100);

      const editor = new Blok({ holder: 'blok' });

      await editor.isReady;

      expect(scrollTo).toHaveBeenCalledWith({
        top: 150,
        behavior: 'smooth',
      });
    });

    it('selects the addressed block, highlights its arrival and announces it', async () => {
      const kit = install(makeKit());
      const block = { id: 'blk-1' } as unknown as Block;

      kit.blockManager.getBlockById.mockReturnValue(block);
      setHash('#blk-1');

      const el = blockElement('blk-1', 100);
      const editor = new Blok({});

      await editor.isReady;

      expect(kit.blockManager.getBlockById).toHaveBeenCalledWith('blk-1');
      expect(kit.blockSelection.selectBlock).toHaveBeenCalledWith(block);
      // Identity, not deep equality: two empty divs compare equal structurally,
      // so a mutant handing over the wrong element would still pass.
      expect(h.highlightBlockArrival.mock.calls[0][0]).toBe(el);
      expect(kit.i18n.t).toHaveBeenCalledWith('a11y.navigatedToBlock');
      expect(h.announce).toHaveBeenCalledWith('t:a11y.navigatedToBlock');
    });

    it('does not select anything when the hash addresses a loose anchor', async () => {
      const kit = install(makeKit());
      const holder = document.createElement('div');
      const heading = document.createElement('h2');

      heading.id = 'section-two';
      holder.appendChild(heading);
      document.body.appendChild(holder);
      kit.ui.nodes.holder = holder;

      setHash('#section-two');

      const editor = new Blok({});

      await editor.isReady;

      expect(h.highlightBlockArrival).toHaveBeenCalled();
      expect(kit.blockManager.getBlockById).not.toHaveBeenCalled();
    });

    it('does not select a block id BlockManager no longer knows', async () => {
      const kit = install(makeKit());

      kit.blockManager.getBlockById.mockReturnValue(undefined);
      setHash('#blk-1');
      blockElement('blk-1', 100);

      const editor = new Blok({});

      await editor.isReady;

      expect(kit.blockManager.getBlockById).toHaveBeenCalledWith('blk-1');
      expect(kit.blockSelection.selectBlock).not.toHaveBeenCalled();
    });

    it('parks an unresolved hash on Renderer, stripped of its leading marker', async () => {
      const kit = install(makeKit());

      setHash('#ghost');

      const editor = new Blok({});

      await editor.isReady;

      expect(kit.renderer.pendingHashScroll).toBe('ghost');
      expect(scrollTo).not.toHaveBeenCalled();
    });

    it('parks nothing and scrolls nowhere when there is no hash', async () => {
      const kit = install(makeKit());

      setHash('');

      const editor = new Blok({});

      await editor.isReady;

      expect(kit.renderer.pendingHashScroll).toBeNull();
      expect(scrollTo).not.toHaveBeenCalled();
    });

    it('parks nothing once the hash has been scrolled to', async () => {
      const kit = install(makeKit());

      setHash('#blk-1');
      blockElement('blk-1', 100);

      const editor = new Blok({});

      await editor.isReady;

      expect(scrollTo).toHaveBeenCalled();
      expect(kit.renderer.pendingHashScroll).toBeNull();
    });

    it('boots with an unresolved hash and no Renderer module', async () => {
      install(makeKit({ renderer: false }));

      setHash('#ghost');

      const editor = new Blok({});

      await expect(editor.isReady).resolves.toBe(editor);
    });

    it('boots with a hash and no UI module to scope the anchor lookup to', async () => {
      const kit = install(makeKit({ ui: false }));

      setHash('#ghost');

      const editor = new Blok({});

      await expect(editor.isReady).resolves.toBe(editor);
      expect(kit.renderer.pendingHashScroll).toBe('ghost');
    });

    it('boots with a resolved hash and no I18n module to announce through', async () => {
      install(makeKit({ i18n: false }));

      setHash('#blk-1');
      blockElement('blk-1', 100);

      const editor = new Blok({});

      await expect(editor.isReady).resolves.toBe(editor);
      expect(scrollTo).toHaveBeenCalled();
      expect(h.announce).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // onReady
  // -------------------------------------------------------------------------

  describe('onReady', () => {
    it('receives the ready instance', async () => {
      install(makeKit());

      const onReady = vi.fn();
      const editor = new Blok({ onReady });

      await editor.isReady;

      expect(onReady).toHaveBeenCalledTimes(1);
      expect(onReady.mock.calls[0][0]).toBe(editor);
    });

    it('is not called when destroy landed before ready', async () => {
      install(makeKit());

      const onReady = vi.fn();
      const editor = new Blok({ onReady });
      const ready = editor.isReady;

      editor.destroy();

      await ready;

      expect(onReady).not.toHaveBeenCalled();
    });
  });
});
