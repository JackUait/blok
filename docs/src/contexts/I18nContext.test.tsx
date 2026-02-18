import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import type { ReactNode } from 'react';
import { I18nProvider, useI18n } from './I18nContext';

const wrapper = ({ children }: { children: ReactNode }) => (
  <I18nProvider>{children}</I18nProvider>
);

describe('I18nContext', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
  });

  describe('useI18n', () => {
    it('should throw error when used outside provider', () => {
      expect(() => {
        renderHook(() => useI18n());
      }).toThrow('useI18n must be used within an I18nProvider');
    });

    it('should provide default locale as English', () => {
      const { result } = renderHook(() => useI18n(), { wrapper });
      expect(result.current.locale).toBe('en');
    });

    it('should translate English keys correctly', () => {
      const { result } = renderHook(() => useI18n(), { wrapper });
      expect(result.current.t('nav.search')).toBe('Search');
      expect(result.current.t('nav.docs')).toBe('Docs');
    });

    it('should change locale when setLocale is called', () => {
      const { result } = renderHook(() => useI18n(), { wrapper });
      
      act(() => {
        result.current.setLocale('ru');
      });
      
      expect(result.current.locale).toBe('ru');
    });

    it('should translate Russian keys after locale change', () => {
      const { result } = renderHook(() => useI18n(), { wrapper });
      
      act(() => {
        result.current.setLocale('ru');
      });
      
      expect(result.current.t('nav.search')).toBe('Поиск');
      expect(result.current.t('nav.docs')).toBe('Документация');
    });

    it('should persist locale to localStorage', () => {
      const { result } = renderHook(() => useI18n(), { wrapper });
      
      act(() => {
        result.current.setLocale('ru');
      });
      
      expect(localStorage.getItem('blok-docs-locale')).toBe('ru');
    });

    it('should provide locale names', () => {
      const { result } = renderHook(() => useI18n(), { wrapper });
      
      expect(result.current.localeNames).toEqual({
        en: 'English',
        ru: 'Русский',
      });
    });

    it('should return key itself when translation is not found', () => {
      const { result } = renderHook(() => useI18n(), { wrapper });
      expect(result.current.t('nonexistent.key')).toBe('nonexistent.key');
    });
  });
});
