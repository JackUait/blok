import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useTheme } from './useTheme';

// Polyfill MediaQueryListEvent for test environment
if (typeof MediaQueryListEvent === 'undefined') {
  global.MediaQueryListEvent = class MediaQueryListEvent extends Event {
    public matches: boolean;
    public media: string;

    constructor(type: string, eventInitDict: MediaQueryListEventInit = {}) {
      super(type);
      this.matches = eventInitDict.matches ?? false;
      this.media = eventInitDict.media ?? '';
    }
  };
}

describe('useTheme', () => {
  const localStorageMock = (() => {
    let store: Record<string, string> = {};
    return {
      getItem: vi.fn((key: string) => store[key] ?? null),
      setItem: vi.fn((key: string, value: string) => {
        store[key] = value;
      }),
      clear: () => {
        store = {};
      },
    };
  })();

  const matchMediaMock = vi.fn();
  let mediaQueryChangeHandler: ((e: MediaQueryListEvent) => void) | null = null;

  beforeEach(() => {
    vi.clearAllMocks();
    localStorageMock.clear();
    mediaQueryChangeHandler = null;
    Object.defineProperty(window, 'localStorage', {
      value: localStorageMock,
      writable: true,
    });
    Object.defineProperty(window, 'matchMedia', {
      value: matchMediaMock,
      writable: true,
    });
    // Default to light mode in system preference
    matchMediaMock.mockReturnValue({
      matches: false,
      addEventListener: vi.fn((_event: string, handler: EventListener) => {
        mediaQueryChangeHandler = handler as (e: MediaQueryListEvent) => void;
      }),
      removeEventListener: vi.fn(() => {
        mediaQueryChangeHandler = null;
      }),
    });
    // Clean up theme state from document
    document.documentElement.removeAttribute('data-theme');
    document.documentElement.removeAttribute('class');
  });

  afterEach(() => {
    vi.restoreAllMocks();
    // Clean up theme state from document
    document.documentElement.removeAttribute('data-theme');
    document.documentElement.removeAttribute('class');
  });

  describe('initialization', () => {
    it('should initialize with dark theme when system prefers dark and no stored value', () => {
      matchMediaMock.mockReturnValue({
        matches: true, // prefers dark
        addEventListener: vi.fn((_event: string, handler: EventListener) => {
          mediaQueryChangeHandler = handler as (e: MediaQueryListEvent) => void;
        }),
        removeEventListener: vi.fn(),
      });

      const { result } = renderHook(() => useTheme());

      // Theme should be dark (the resolved system preference)
      expect(result.current.theme).toBe('dark');
      expect(result.current.resolvedTheme).toBe('dark');
    });

    it('should initialize with light theme when system prefers light and no stored value', () => {
      // matchMediaMock defaults to matches: false (light)

      const { result } = renderHook(() => useTheme());

      expect(result.current.theme).toBe('light');
      expect(result.current.resolvedTheme).toBe('light');
    });

    it('should initialize with stored theme from localStorage', () => {
      localStorageMock.getItem.mockReturnValue('dark');

      const { result } = renderHook(() => useTheme());

      expect(result.current.theme).toBe('dark');
      expect(result.current.resolvedTheme).toBe('dark');
    });

    it('should handle invalid stored theme gracefully by falling back to system preference', () => {
      localStorageMock.getItem.mockReturnValue('invalid-theme');

      const { result } = renderHook(() => useTheme());

      // Should fall back to system preference (light by default)
      expect(result.current.theme).toBe('light');
      expect(result.current.resolvedTheme).toBe('light');
    });
  });

  describe('theme toggling', () => {
    it('should toggle between light and dark modes only', () => {
      const { result } = renderHook(() => useTheme());

      // Start with light (system default)
      expect(result.current.theme).toBe('light');

      act(() => {
        result.current.toggleTheme();
      });

      expect(result.current.theme).toBe('dark');

      act(() => {
        result.current.toggleTheme();
      });

      expect(result.current.theme).toBe('light');

      act(() => {
        result.current.toggleTheme();
      });

      expect(result.current.theme).toBe('dark');
    });

    it('should toggle correctly when starting from dark', () => {
      localStorageMock.getItem.mockReturnValue('dark');

      const { result } = renderHook(() => useTheme());

      expect(result.current.theme).toBe('dark');

      act(() => {
        result.current.toggleTheme();
      });

      expect(result.current.theme).toBe('light');

      act(() => {
        result.current.toggleTheme();
      });

      expect(result.current.theme).toBe('dark');
    });
  });

  describe('theme setting', () => {
    it('should allow setting theme to light or dark', () => {
      const { result } = renderHook(() => useTheme());

      act(() => {
        result.current.setTheme('dark');
      });

      expect(result.current.theme).toBe('dark');
      expect(result.current.resolvedTheme).toBe('dark');

      act(() => {
        result.current.setTheme('light');
      });

      expect(result.current.theme).toBe('light');
      expect(result.current.resolvedTheme).toBe('light');
    });

    it('should persist theme preference to localStorage', () => {
      const { result } = renderHook(() => useTheme());

      act(() => {
        result.current.setTheme('dark');
      });

      expect(localStorageMock.setItem).toHaveBeenCalledWith('blok-docs-theme', 'dark');
    });
  });

  describe('DOM application', () => {
    it('should apply theme attributes and classes to document element', () => {
      const { result } = renderHook(() => useTheme());

      act(() => {
        result.current.setTheme('dark');
      });

      expect(document.documentElement.getAttribute('data-theme')).toBe('dark');

      act(() => {
        result.current.setTheme('light');
      });

      expect(document.documentElement.getAttribute('data-theme')).toBe('light');
    });
  });

  describe('system theme changes', () => {
    it('should update resolved theme when system theme changes from light to dark', () => {
      // Start with light system preference
      matchMediaMock.mockReturnValue({
        matches: false,
        addEventListener: vi.fn((_event: string, handler: EventListener) => {
          mediaQueryChangeHandler = handler as (e: MediaQueryListEvent) => void;
        }),
        removeEventListener: vi.fn(),
      });

      const { result } = renderHook(() => useTheme());

      // Initial state: light
      expect(result.current.theme).toBe('light');
      expect(result.current.resolvedTheme).toBe('light');
      expect(document.documentElement.getAttribute('data-theme')).toBe('light');

      // Simulate system theme change to dark
      act(() => {
        mediaQueryChangeHandler?.(
          new MediaQueryListEvent('change', { matches: true })
        );
      });

      // Theme should update to dark when system changes
      expect(result.current.theme).toBe('dark');
      expect(result.current.resolvedTheme).toBe('dark');
      expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    });

    it('should update resolved theme when system theme changes from dark to light', () => {
      // Start with dark system preference
      matchMediaMock.mockReturnValue({
        matches: true,
        addEventListener: vi.fn((_event: string, handler: EventListener) => {
          mediaQueryChangeHandler = handler as (e: MediaQueryListEvent) => void;
        }),
        removeEventListener: vi.fn(),
      });

      const { result } = renderHook(() => useTheme());

      // Initial state: dark
      expect(result.current.theme).toBe('dark');
      expect(result.current.resolvedTheme).toBe('dark');

      // Simulate system theme change to light
      act(() => {
        mediaQueryChangeHandler?.(
          new MediaQueryListEvent('change', { matches: false })
        );
      });

      // Theme should update to light when system changes
      expect(result.current.theme).toBe('light');
      expect(result.current.resolvedTheme).toBe('light');
    });

    it('should ALWAYS update theme when system theme changes, even after user explicit preference', () => {
      // Start with light system preference
      const { result } = renderHook(() => useTheme());

      // User explicitly sets dark theme
      act(() => {
        result.current.setTheme('dark');
      });

      expect(result.current.theme).toBe('dark');
      expect(result.current.resolvedTheme).toBe('dark');
      expect(localStorageMock.setItem).toHaveBeenCalledWith('blok-docs-theme', 'dark');

      // Simulate system theme change to light
      act(() => {
        mediaQueryChangeHandler?.(
          new MediaQueryListEvent('change', { matches: false })
        );
      });

      // Theme should change to light when system changes
      expect(result.current.theme).toBe('light');
      expect(result.current.resolvedTheme).toBe('light');
    });
  });
});
