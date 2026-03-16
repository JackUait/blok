import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ThemeManager, resetActiveInstances } from '../../../../src/components/modules/themeManager';
import { EventsDispatcher } from '../../../../src/components/utils/events';
import type { BlokConfig } from '../../../../types';
import type { BlokEventMap } from '../../../../src/components/events';
import type { BlokModules } from '../../../../src/types-internal/blok-modules';

/**
 * Stub for matchMedia — defaults to light (matches = false).
 * Call `trigger(true)` to simulate OS switching to dark.
 */
function createMatchMediaStub(initialDark = false) {
  let listener: ((e: MediaQueryListEvent) => void) | null = null;
  const mql = {
    matches: initialDark,
    media: '(prefers-color-scheme: dark)',
    addEventListener: vi.fn((_event: string, cb: (e: MediaQueryListEvent) => void) => {
      listener = cb;
    }),
    removeEventListener: vi.fn((_event: string, cb: (e: MediaQueryListEvent) => void) => {
      if (listener === cb) {
        listener = null;
      }
    }),
    // Not used but required by the type
    addListener: vi.fn(),
    removeListener: vi.fn(),
    onchange: null,
    dispatchEvent: vi.fn(),
  } as unknown as MediaQueryList;

  return {
    mql,
    matchMedia: vi.fn().mockReturnValue(mql),
    trigger(dark: boolean) {
      mql.matches = dark;
      if (listener) {
        listener({ matches: dark } as MediaQueryListEvent);
      }
    },
  };
}

function createThemeManager(
  config: Partial<BlokConfig> = {},
  initialDark = false
): {
  manager: ThemeManager;
  stub: ReturnType<typeof createMatchMediaStub>;
} {
  const stub = createMatchMediaStub(initialDark);

  vi.stubGlobal('matchMedia', stub.matchMedia);

  const eventsDispatcher = new EventsDispatcher<BlokEventMap>();
  const manager = new ThemeManager({
    config: config as BlokConfig,
    eventsDispatcher,
  });

  // Wire state (simulate Core.configureModules) — ThemeManager has no module dependencies
  manager.state = {} as unknown as BlokModules;

  return { manager, stub };
}

describe('ThemeManager', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetActiveInstances();
    document.documentElement.removeAttribute('data-blok-theme');
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    document.documentElement.removeAttribute('data-blok-theme');
  });

  describe('prepare()', () => {
    it('should default to auto mode when config.theme is not set', () => {
      const { manager } = createThemeManager({});
      manager.prepare();
      expect(manager.getMode()).toBe('auto');
    });

    it('should remove data-blok-theme attribute in auto mode', () => {
      document.documentElement.setAttribute('data-blok-theme', 'dark');
      const { manager } = createThemeManager({});
      manager.prepare();
      expect(document.documentElement.hasAttribute('data-blok-theme')).toBe(false);
    });

    it('should set data-blok-theme="light" when config.theme is light', () => {
      const { manager } = createThemeManager({ theme: 'light' });
      manager.prepare();
      expect(document.documentElement.getAttribute('data-blok-theme')).toBe('light');
    });

    it('should set data-blok-theme="dark" when config.theme is dark', () => {
      const { manager } = createThemeManager({ theme: 'dark' });
      manager.prepare();
      expect(document.documentElement.getAttribute('data-blok-theme')).toBe('dark');
    });

    it('should set up matchMedia listener in auto mode', () => {
      const { manager, stub } = createThemeManager({});
      manager.prepare();
      expect(stub.mql.addEventListener).toHaveBeenCalledWith('change', expect.any(Function));
    });

    it('should not set up matchMedia listener in explicit mode', () => {
      const { manager, stub } = createThemeManager({ theme: 'dark' });
      manager.prepare();
      expect(stub.mql.addEventListener).not.toHaveBeenCalled();
    });

    it('should not fire onThemeChange on initialization', () => {
      const onThemeChange = vi.fn();
      const { manager } = createThemeManager({ onThemeChange });
      manager.prepare();
      expect(onThemeChange).not.toHaveBeenCalled();
    });
  });

  describe('getMode()', () => {
    it('should return the current mode', () => {
      const { manager } = createThemeManager({ theme: 'dark' });
      manager.prepare();
      expect(manager.getMode()).toBe('dark');
    });
  });

  describe('getResolved()', () => {
    it('should return "light" in auto mode when OS prefers light', () => {
      const { manager } = createThemeManager({}, false);
      manager.prepare();
      expect(manager.getResolved()).toBe('light');
    });

    it('should return "dark" in auto mode when OS prefers dark', () => {
      const { manager } = createThemeManager({}, true);
      manager.prepare();
      expect(manager.getResolved()).toBe('dark');
    });

    it('should return "dark" when mode is explicitly dark', () => {
      const { manager } = createThemeManager({ theme: 'dark' });
      manager.prepare();
      expect(manager.getResolved()).toBe('dark');
    });

    it('should return "light" when mode is explicitly light', () => {
      const { manager } = createThemeManager({ theme: 'light' });
      manager.prepare();
      expect(manager.getResolved()).toBe('light');
    });
  });

  describe('setMode()', () => {
    it('should update the attribute when switching from auto to dark', () => {
      const { manager } = createThemeManager({});
      manager.prepare();
      manager.setMode('dark');
      expect(document.documentElement.getAttribute('data-blok-theme')).toBe('dark');
    });

    it('should remove the attribute when switching to auto', () => {
      const { manager } = createThemeManager({ theme: 'dark' });
      manager.prepare();
      manager.setMode('auto');
      expect(document.documentElement.hasAttribute('data-blok-theme')).toBe(false);
    });

    it('should fire onThemeChange when resolved theme changes', () => {
      const onThemeChange = vi.fn();
      const { manager } = createThemeManager({ onThemeChange }, false);
      manager.prepare();
      manager.setMode('dark');
      expect(onThemeChange).toHaveBeenCalledWith('dark');
    });

    it('should not fire onThemeChange when resolved theme stays the same', () => {
      const onThemeChange = vi.fn();
      const { manager } = createThemeManager({ theme: 'dark', onThemeChange });
      manager.prepare();
      manager.setMode('dark');
      expect(onThemeChange).not.toHaveBeenCalled();
    });

    it('should not fire onThemeChange when switching light to auto with OS preferring light', () => {
      const onThemeChange = vi.fn();
      const { manager } = createThemeManager({ theme: 'light', onThemeChange }, false);
      manager.prepare();
      manager.setMode('auto');
      expect(onThemeChange).not.toHaveBeenCalled();
    });

    it('should add matchMedia listener when switching to auto', () => {
      const { manager, stub } = createThemeManager({ theme: 'dark' });
      manager.prepare();
      manager.setMode('auto');
      expect(stub.mql.addEventListener).toHaveBeenCalledWith('change', expect.any(Function));
    });

    it('should remove matchMedia listener when switching away from auto', () => {
      const { manager, stub } = createThemeManager({});
      manager.prepare();
      manager.setMode('dark');
      expect(stub.mql.removeEventListener).toHaveBeenCalledWith('change', expect.any(Function));
    });
  });

  describe('matchMedia listener in auto mode', () => {
    it('should fire onThemeChange when OS preference changes', () => {
      const onThemeChange = vi.fn();
      const { manager, stub } = createThemeManager({ onThemeChange }, false);
      manager.prepare();
      stub.trigger(true);
      expect(onThemeChange).toHaveBeenCalledWith('dark');
    });

    it('should update getResolved() when OS preference changes', () => {
      const { manager, stub } = createThemeManager({}, false);
      manager.prepare();
      expect(manager.getResolved()).toBe('light');
      stub.trigger(true);
      expect(manager.getResolved()).toBe('dark');
    });
  });

  describe('destroy()', () => {
    it('should remove matchMedia listener', () => {
      const { manager, stub } = createThemeManager({});
      manager.prepare();
      manager.destroy();
      expect(stub.mql.removeEventListener).toHaveBeenCalledWith('change', expect.any(Function));
    });

    it('should remove data-blok-theme attribute when last instance is destroyed', () => {
      const { manager } = createThemeManager({ theme: 'dark' });
      manager.prepare();
      manager.destroy();
      expect(document.documentElement.hasAttribute('data-blok-theme')).toBe(false);
    });

    it('should NOT remove attribute when other instances are still active', () => {
      const { manager: managerA } = createThemeManager({ theme: 'dark' });
      managerA.prepare();
      const { manager: managerB } = createThemeManager({ theme: 'dark' });
      managerB.prepare();

      managerA.destroy();
      // managerB is still active — attribute should remain
      expect(document.documentElement.getAttribute('data-blok-theme')).toBe('dark');

      managerB.destroy();
      // Both destroyed — attribute should be removed
      expect(document.documentElement.hasAttribute('data-blok-theme')).toBe(false);
    });
  });
});
