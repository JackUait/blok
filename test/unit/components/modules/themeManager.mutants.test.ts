import { describe, it, expect, beforeEach, afterEach, vi, type Mock } from 'vitest';

import type { BlokEventMap } from '../../../../src/components/events';
import { ThemeManager, resetActiveInstances } from '../../../../src/components/modules/themeManager';
import { EventsDispatcher } from '../../../../src/components/utils/events';
import type { BlokModules } from '../../../../src/types-internal/blok-modules';
import type { BlokConfig } from '../../../../types';
import type { ResolvedTheme } from '../../../../types/api/theme';

/**
 * No mutant of this file is left alive, so there is no equivalence proof to record.
 *
 * The environment guards (`typeof document === 'undefined'`,
 * `typeof window === 'undefined'`) are inert under jsdom, so the only way to
 * see them is to take the global away with `vi.stubGlobal`. The stub is lifted
 * again before any expectation runs, because the assertion machinery itself
 * needs those globals.
 */

const ATTR = 'data-blok-theme';

interface MediaStub {
  mql: MediaQueryList;
  matchMedia: Mock<(query: string) => MediaQueryList>;
  addEventListener: Mock<(type: string, listener: (event: MediaQueryListEvent) => void) => void>;
  removeEventListener: Mock<(type: string, listener: (event: MediaQueryListEvent) => void) => void>;
  trigger: (dark: boolean) => void;
}

const createMediaStub = (initialDark: boolean): MediaStub => {
  let listener: ((event: MediaQueryListEvent) => void) | null = null;
  let matches = initialDark;

  const addEventListener = vi.fn((_type: string, callback: (event: MediaQueryListEvent) => void) => {
    listener = callback;
  });
  const removeEventListener = vi.fn((_type: string, callback: (event: MediaQueryListEvent) => void) => {
    if (listener === callback) {
      listener = null;
    }
  });

  const mql = {
    get matches(): boolean {
      return matches;
    },
    media: '(prefers-color-scheme: dark)',
    addEventListener,
    removeEventListener,
    onchange: null,
  } as unknown as MediaQueryList;

  return {
    mql,
    matchMedia: vi.fn(() => mql),
    addEventListener,
    removeEventListener,
    trigger: (dark: boolean): void => {
      matches = dark;
      listener?.({ matches: dark } as MediaQueryListEvent);
    },
  };
};

describe('ThemeManager — recorded mutants', () => {
  let onThemeChange: Mock<(theme: ResolvedTheme) => void>;

  const createManager = (config: BlokConfig, initialDark = false): { manager: ThemeManager; stub: MediaStub } => {
    const stub = createMediaStub(initialDark);

    vi.stubGlobal('matchMedia', stub.matchMedia);

    const manager = new ThemeManager({
      config,
      eventsDispatcher: new EventsDispatcher<BlokEventMap>(),
    });

    manager.state = {} as unknown as BlokModules;

    return { manager, stub };
  };

  beforeEach(() => {
    vi.clearAllMocks();
    resetActiveInstances();
    document.documentElement.removeAttribute(ATTR);
    onThemeChange = vi.fn();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    resetActiveInstances();
    document.documentElement.removeAttribute(ATTR);
  });

  describe('defaults before prepare', () => {
    it('starts in auto mode resolved to light', () => {
      const { manager } = createManager({});

      expect(manager.getMode()).toBe('auto');
      expect(manager.getResolved()).toBe('light');
    });
  });

  describe('attribute ownership', () => {
    it('takes over an attribute a single instance finds already set', () => {
      document.documentElement.setAttribute(ATTR, 'light');

      const { manager } = createManager({ theme: 'dark' });

      manager.prepare();

      expect(document.documentElement.getAttribute(ATTR)).toBe('dark');
    });

    it('lets a second instance claim the attribute through setMode', () => {
      const first = createManager({ theme: 'light' });
      const second = createManager({ theme: 'dark' });

      first.manager.prepare();
      second.manager.prepare();

      expect(document.documentElement.getAttribute(ATTR)).toBe('light');

      second.manager.setMode('dark');

      expect(document.documentElement.getAttribute(ATTR)).toBe('dark');
    });
  });

  describe('OS listener wiring', () => {
    it('never consults matchMedia while in an explicit mode', () => {
      const { manager, stub } = createManager({ theme: 'dark' });

      manager.prepare();
      stub.matchMedia.mockClear();

      manager.setMode('dark');

      expect(stub.matchMedia).not.toHaveBeenCalled();
    });

    it('leaves an already-attached listener alone when the mode is not auto', () => {
      const { manager, stub } = createManager({ theme: 'dark' });

      // setMode attaches the listener; the later prepare() re-reads config.theme
      // and leaves auto mode without detaching it.
      manager.setMode('auto');
      manager.prepare();
      stub.removeEventListener.mockClear();

      manager.setMode('light');

      expect(stub.removeEventListener).not.toHaveBeenCalled();
    });

    it('reports the OS switching back to light', () => {
      const { manager, stub } = createManager({ theme: 'auto', onThemeChange }, true);

      manager.prepare();

      expect(manager.getResolved()).toBe('dark');

      stub.trigger(false);

      expect(onThemeChange).toHaveBeenCalledTimes(1);
      expect(onThemeChange).toHaveBeenCalledWith('light');
    });

    it('stays quiet when the OS reports the theme it already had', () => {
      const { manager, stub } = createManager({ theme: 'auto', onThemeChange }, false);

      manager.prepare();
      stub.trigger(false);

      expect(onThemeChange).not.toHaveBeenCalled();
    });
  });

  describe('missing environment', () => {
    it('skips the attribute write when there is no document', () => {
      const { manager } = createManager({ theme: 'auto' });

      vi.stubGlobal('document', undefined);

      let error: unknown = null;

      try {
        manager.setMode('dark');
      } catch (caught) {
        error = caught;
      }

      vi.unstubAllGlobals();

      expect(error).toBeNull();
    });

    it('skips the attribute removal when there is no document', () => {
      const { manager } = createManager({ theme: 'auto' });

      manager.prepare();

      vi.stubGlobal('document', undefined);

      let error: unknown = null;

      try {
        manager.destroy();
      } catch (caught) {
        error = caught;
      }

      vi.unstubAllGlobals();

      expect(error).toBeNull();
    });

    it('falls back to light when matchMedia is not callable', () => {
      const { manager } = createManager({ theme: 'auto' });

      vi.stubGlobal('matchMedia', undefined);

      let error: unknown = null;
      let resolved: ResolvedTheme | null = null;

      try {
        manager.prepare();
        resolved = manager.getResolved();
      } catch (caught) {
        error = caught;
      }

      vi.unstubAllGlobals();

      expect(error).toBeNull();
      expect(resolved).toBe('light');
    });

    it('falls back to light when there is no window', () => {
      const { manager } = createManager({ theme: 'auto' });

      vi.stubGlobal('window', undefined);

      let error: unknown = null;
      let resolved: ResolvedTheme | null = null;

      try {
        manager.prepare();
        resolved = manager.getResolved();
      } catch (caught) {
        error = caught;
      }

      vi.unstubAllGlobals();

      expect(error).toBeNull();
      expect(resolved).toBe('light');
    });
  });
});
