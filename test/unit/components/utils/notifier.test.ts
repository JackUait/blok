import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { NotifierOptions } from '../../../../src/components/utils/notifier/types';

import { Notifier } from '../../../../src/components/utils/notifier';

type ShowMock = ReturnType<typeof vi.fn>;

type NotifierModule = {
  show: ShowMock;
};

type NotifierInternals = {
  loadNotifierModule: () => Promise<NotifierModule>;
  getNotifierModule: () => NotifierModule | null;
  setNotifierModule: (module: NotifierModule | null) => void;
  getLoadingPromise: () => Promise<NotifierModule> | null;
  setLoadingPromise: (promise: Promise<NotifierModule> | null) => void;
};

const hoisted = vi.hoisted(() => {
  const showSpy = vi.fn();
  const moduleExports: Record<string, unknown> = {};

  const overwriteModuleExports = (exports: unknown): void => {
    for (const key of Object.keys(moduleExports)) {
      delete moduleExports[key];
    }

    // Always set __esModule first
    moduleExports.__esModule = true;

    if (typeof exports === 'object' && exports !== null) {
      Object.assign(moduleExports, exports as Record<string, unknown>);
    }
  };

  const setDefaultExports = (): void => {
    overwriteModuleExports({
      __esModule: true,
      show: showSpy,
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

vi.mock('../../../../src/components/utils/notifier/index', () => getModuleExports());

const exposeInternals = (notifier: Notifier): NotifierInternals => {
  const loadModule = (Reflect.get(notifier as object, 'loadNotifierModule') as () => Promise<NotifierModule>).bind(notifier);

  return {
    loadNotifierModule: loadModule,
    getNotifierModule: () => Reflect.get(notifier as object, 'notifierModule') as NotifierModule | null,
    setNotifierModule: (module) => {
      Reflect.set(notifier as object, 'notifierModule', module);
    },
    getLoadingPromise: () => Reflect.get(notifier as object, 'loadingPromise') as Promise<NotifierModule> | null,
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
    it('loads notifier lazily and caches the resolved module', async () => {
      const { internals } = createNotifierWithInternals();

      setModuleExports({ show: showSpy });

      const loadedModule = await internals.loadNotifierModule();

      expect(loadedModule.show).toBe(showSpy);
      expect(internals.getNotifierModule()).toBe(loadedModule);
    });

    it('returns cached module when it is already available', async () => {
      const { internals } = createNotifierWithInternals();
      const cachedModule: NotifierModule = { show: vi.fn() };

      internals.setNotifierModule(cachedModule);

      setModuleExports({ show: showSpy });

      const loadedModule = await internals.loadNotifierModule();

      expect(loadedModule).toBe(cachedModule);
      expect(internals.getNotifierModule()).toBe(cachedModule);
    });

    it('reuses the same promise while loading is in progress', async () => {
      const { internals } = createNotifierWithInternals();

      setModuleExports({ show: showSpy });

      const firstPromise = internals.loadNotifierModule();
      const secondPromise = internals.loadNotifierModule();

      expect(secondPromise).toBe(firstPromise);

      const result = await firstPromise;

      expect(result.show).toBe(showSpy);
    });

    it('rejects when module does not expose show and resets loading promise', async () => {
      const { internals } = createNotifierWithInternals();

      setModuleExports({});

      await expect(internals.loadNotifierModule()).rejects.toThrow('notifier module does not expose a "show" method.');
      expect(internals.getLoadingPromise()).toBeNull();
      expect(internals.getNotifierModule()).toBeNull();
    });
  });

  describe('show', () => {
    it('delegates the call to notifier show once loaded', async () => {
      const { notifier, internals } = createNotifierWithInternals();
      const options = { message: 'Hello' } as NotifierOptions;
      const moduleInstance: NotifierModule = { show: showSpy };

      setModuleExports(moduleInstance);

      notifier.show(options);

      const loadingPromise = internals.getLoadingPromise();

      expect(loadingPromise).not.toBeNull();
      await loadingPromise;

      expect(showSpy).toHaveBeenCalledTimes(1);
      expect(showSpy).toHaveBeenCalledWith(options);
    });

    it('logs an error when loading notifier fails', async () => {
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
      const { notifier, internals } = createNotifierWithInternals();

      setModuleExports({});

      notifier.show({ message: 'Oops' } as NotifierOptions);

      const loadingPromise = internals.getLoadingPromise();

      expect(loadingPromise).not.toBeNull();
      await expect(loadingPromise).rejects.toThrow('notifier module does not expose a "show" method.');

      expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
      const [message, errorInstance] = consoleErrorSpy.mock.calls[0];

      expect(message).toBe('[Blok] Failed to display notification. Reason:');
      expect(errorInstance).toBeInstanceOf(Error);
      expect((errorInstance as Error).message).toBe('notifier module does not expose a "show" method.');
    });
  });
});
