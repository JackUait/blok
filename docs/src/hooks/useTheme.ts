import { useState, useEffect, useCallback, useRef } from 'react';

export type Theme = 'light' | 'dark';
export type ResolvedTheme = 'light' | 'dark';

const STORAGE_KEY = 'blok-docs-theme';
const VALID_THEMES: Theme[] = ['light', 'dark'];
/** Broadcast between useTheme instances so every consumer re-renders in sync. */
const THEME_CHANGE_EVENT = 'blok-docs:theme-change';

/**
 * Hook to manage light/dark theme with system preference detection
 * and localStorage persistence.
 *
 * Behavior:
 * - On first visit, theme is set to match system preference
 * - User can explicitly set theme to light or dark
 * - System theme changes only affect theme if user hasn't explicitly set a preference
 */
export const useTheme = () => {
  const [systemTheme, setSystemTheme] = useState<ResolvedTheme>(() => {
    if (typeof window === 'undefined') return 'light';
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  });

  const [theme, setThemeState] = useState<Theme>(() => {
    if (typeof window === 'undefined') return systemTheme;

    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored && VALID_THEMES.includes(stored as Theme)) {
      return stored as Theme;
    }
    // No stored value - initialize to system preference
    return systemTheme;
  });

  // Apply theme to document
  useEffect(() => {
    const root = document.documentElement;

    // Set data-theme attribute for CSS
    root.setAttribute('data-theme', theme);

    // Also add class for CSS selectors
    root.classList.remove('light', 'dark');
    root.classList.add(theme);
  }, [theme]);

  // Sync with other useTheme instances (Nav toggle, settings panel, editor):
  // every explicit change is broadcast as a window event, so each instance's
  // local state follows no matter which component made the change.
  useEffect(() => {
    const handleThemeEvent = (event: Event) => {
      setThemeState((event as CustomEvent<Theme>).detail);
    };

    window.addEventListener(THEME_CHANGE_EVENT, handleThemeEvent);
    return () => window.removeEventListener(THEME_CHANGE_EVENT, handleThemeEvent);
  }, []);

  // Listen for system theme changes
  useEffect(() => {
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');

    const handleChange = (e: MediaQueryListEvent) => {
      const newSystemTheme = e.matches ? 'dark' : 'light';
      setSystemTheme(newSystemTheme);
      // Always update theme when system theme changes
      setThemeState(newSystemTheme);
    };

    mediaQuery.addEventListener('change', handleChange);
    return () => mediaQuery.removeEventListener('change', handleChange);
  }, []);

  const themeRef = useRef(theme);
  themeRef.current = theme;

  // Set theme, persist to localStorage, and broadcast to other instances
  const setTheme = useCallback((newTheme: Theme) => {
    setThemeState(newTheme);
    window.localStorage.setItem(STORAGE_KEY, newTheme);
    window.dispatchEvent(new CustomEvent<Theme>(THEME_CHANGE_EVENT, { detail: newTheme }));
  }, []);

  // Toggle between light and dark
  const toggleTheme = useCallback(() => {
    setTheme(themeRef.current === 'light' ? 'dark' : 'light');
  }, [setTheme]);

  return {
    theme,
    resolvedTheme: theme,
    setTheme,
    toggleTheme,
  };
};
