import { useState, useEffect, useCallback } from 'react';

export type Theme = 'light' | 'dark' | 'system';
export type ResolvedTheme = 'light' | 'dark';

const STORAGE_KEY = 'blok-docs-theme';
const VALID_THEMES: Theme[] = ['light', 'dark', 'system'];

/**
 * Hook to manage light/dark theme with system preference detection
 * and localStorage persistence.
 */
export const useTheme = () => {
  const [theme, setThemeState] = useState<Theme>(() => {
    if (typeof window === 'undefined') return 'system';
    
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored && VALID_THEMES.includes(stored as Theme)) {
      return stored as Theme;
    }
    return 'system';
  });

  const [systemTheme, setSystemTheme] = useState<ResolvedTheme>(() => {
    if (typeof window === 'undefined') return 'light';
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  });

  // Compute the resolved theme (what the user actually sees)
  const resolvedTheme: ResolvedTheme = theme === 'system' ? systemTheme : theme;

  // Apply theme to document
  useEffect(() => {
    const root = document.documentElement;
    
    // Set data-theme attribute for CSS
    root.setAttribute('data-theme', resolvedTheme);
    
    // Also add class for CSS selectors
    root.classList.remove('light', 'dark');
    root.classList.add(resolvedTheme);
  }, [resolvedTheme]);

  // Listen for system theme changes
  useEffect(() => {
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    
    const handleChange = (e: MediaQueryListEvent) => {
      setSystemTheme(e.matches ? 'dark' : 'light');
    };

    mediaQuery.addEventListener('change', handleChange);
    return () => mediaQuery.removeEventListener('change', handleChange);
  }, []);

  // Set theme and persist to localStorage
  const setTheme = useCallback((newTheme: Theme) => {
    setThemeState(newTheme);
    window.localStorage.setItem(STORAGE_KEY, newTheme);
  }, []);

  // Toggle through themes: system -> light -> dark -> system
  const toggleTheme = useCallback(() => {
    const order: Theme[] = ['system', 'light', 'dark'];
    const currentIndex = order.indexOf(theme);
    const nextIndex = (currentIndex + 1) % order.length;
    setTheme(order[nextIndex]);
  }, [theme, setTheme]);

  return {
    theme,
    resolvedTheme,
    setTheme,
    toggleTheme,
    isSystem: theme === 'system',
  };
};
