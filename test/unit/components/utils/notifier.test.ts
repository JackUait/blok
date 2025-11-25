import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { NotifierOptions } from '../../../../src/components/utils/codex-notifier/types';

import Notifier from '../../../../src/components/utils/notifier';

type ShowMock = ReturnType<typeof vi.fn>;

type CodexNotifierModule = {
  show: ShowMock;
};

type NotifierInternals = {
  loadNotifierModule: () => Promise<CodexNotifierModule>;
  getNotifierModule: () => CodexNotifierModule | null;
  setNotifierModule: (module: CodexNotifierModule | null) => void;
  getLoadingPromise: () => Promise<CodexNotifierModule> | null;
  setLoadingPromise: (promise: Promise<CodexNotifierModule> | null) => void;
};

const hoisted = vi.hoisted(() => {
  const showSpy = vi.fn();
  const moduleExports: Record<string, unknown> = {};

  const overwriteModuleExports = (exports: unknown): void => {
    for (const key of Object.keys(moduleExports)) {
      delete moduleExports[key];
    }

    if (typeof exports === 'object' && exports !== null) {
      Object.assign(moduleExports, exports as Record<string, unknown>);
    }
  };

  const setDefaultExports = (): void => {
    overwriteModuleExports({
      default: {
        show: showSpy,
      },
    });
  };

  setDefaultExports();

  return {
    showSpy,
    getModuleExports: () => moduleExports,
    setModuleExports: (exports: unknown) => {
      overwriteModuleExports(exports);
    },
    resetModuleExports: () => {
      setDefaultExports();
    },
  };
});

const { showSpy, getModuleExports, setModuleExports, resetModuleExports } = hoisted;

vi.mock('../../../../src/components/utils/codex-notifier/index', () => getModuleExports());

const exposeInternals = (notifier: Notifier): NotifierInternals => {
  const loadModule = (Reflect.get(notifier as object, 'loadNotifierModule') as () => Promise<CodexNotifierModule>).bind(notifier);

  return {
    loadNotifierModule: loadModule,
    getNotifierModule: () => Reflect.get(notifier as object, 'notifierModule') as CodexNotifierModule | null,
    setNotifierModule: (module) => {
      Reflect.set(notifier as object, 'notifierModule', module);
    },
    getLoadingPromise: () => Reflect.get(notifier as object, 'loadingPromise') as Promise<CodexNotifierModule> | null,
    setLoadingPromise: (promise) => {
      Reflect.set(notifier as object, 'loadingPromise', promise);
    },
  };
};

const createNotifierWithInternals = (): { notifier: Notifier; internals: NotifierInternals } => {
  const notifier = new Notifier();

  return {
    notifier,
    internals: exposeInternals(notifier),
  };
};

describe('Notifier utility', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetModuleExports();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('loadNotifierModule', () => {
    it('loads codex-notifier lazily and caches the resolved module', async () => {
      const { internals } = createNotifierWithInternals();
      const moduleInstance: CodexNotifierModule = { show: showSpy };

      setModuleExports({ default: moduleInstance });

      const loadedModule = await internals.loadNotifierModule();

      expect(loadedModule).toBe(moduleInstance);
      expect(internals.getNotifierModule()).toBe(moduleInstance);
    });

    it('returns cached module when it is already available', async () => {
      const { internals } = createNotifierWithInternals();
      const cachedModule: CodexNotifierModule = { show: vi.fn() };

      internals.setNotifierModule(cachedModule);

      setModuleExports({ default: { show: showSpy } });

      const loadedModule = await internals.loadNotifierModule();

      expect(loadedModule).toBe(cachedModule);
      expect(internals.getNotifierModule()).toBe(cachedModule);
    });

    it('reuses the same promise while loading is in progress', async () => {
      const { internals } = createNotifierWithInternals();
      const moduleInstance: CodexNotifierModule = { show: showSpy };

      setModuleExports({ default: moduleInstance });

      const firstPromise = internals.loadNotifierModule();
      const secondPromise = internals.loadNotifierModule();

      expect(secondPromise).toBe(firstPromise);
      await expect(firstPromise).resolves.toBe(moduleInstance);
    });

    it('rejects when module does not expose show and resets loading promise', async () => {
      const { internals } = createNotifierWithInternals();

      setModuleExports({ default: {} });

      await expect(internals.loadNotifierModule()).rejects.toThrow('codex-notifier module does not expose a "show" method.');
      expect(internals.getLoadingPromise()).toBeNull();
      expect(internals.getNotifierModule()).toBeNull();
    });
  });

  describe('show', () => {
    it('delegates the call to codex-notifier show once loaded', async () => {
      const { notifier, internals } = createNotifierWithInternals();
      const options = { message: 'Hello' } as NotifierOptions;
      const moduleInstance: CodexNotifierModule = { show: showSpy };

      setModuleExports({ default: moduleInstance });

      notifier.show(options);

      const loadingPromise = internals.getLoadingPromise();

      expect(loadingPromise).not.toBeNull();
      await loadingPromise;

      expect(showSpy).toHaveBeenCalledTimes(1);
      expect(showSpy).toHaveBeenCalledWith(options);
    });

    it('logs an error when loading codex-notifier fails', async () => {
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
      const { notifier, internals } = createNotifierWithInternals();

      setModuleExports({ default: {} });

      notifier.show({ message: 'Oops' } as NotifierOptions);

      const loadingPromise = internals.getLoadingPromise();

      expect(loadingPromise).not.toBeNull();
      await expect(loadingPromise).rejects.toThrow('codex-notifier module does not expose a "show" method.');

      expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
      const [message, errorInstance] = consoleErrorSpy.mock.calls[0];

      expect(message).toBe('[Editor.js] Failed to display notification. Reason:');
      expect(errorInstance).toBeInstanceOf(Error);
      expect((errorInstance as Error).message).toBe('codex-notifier module does not expose a "show" method.');
    });
  });
});
