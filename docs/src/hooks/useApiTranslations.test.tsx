import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import type { ReactNode } from 'react';
import { I18nProvider, useI18n } from '../contexts/I18nContext';
import { useApiTranslations } from './useApiTranslations';

const wrapper = ({ children }: { children: ReactNode }) => (
  <I18nProvider>{children}</I18nProvider>
);

describe('useApiTranslations', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
  });

  it('should return translated API sections in English by default', () => {
    const { result } = renderHook(() => useApiTranslations(), { wrapper });
    
    const quickStart = result.current.apiSections.find(s => s.id === 'quick-start');
    expect(quickStart?.title).toBe('Quick Start');
    expect(quickStart?.description).toBe('Get up and running with Blok in just a few simple steps.');
  });

  it('should return translated API sections in Russian when locale is changed', () => {
    const { result: i18nResult } = renderHook(() => useI18n(), { wrapper });
    renderHook(() => useApiTranslations(), { wrapper });
    
    act(() => {
      i18nResult.current.setLocale('ru');
    });
    
    // Re-render to get updated translations
    const { result: updatedResult } = renderHook(() => useApiTranslations(), { wrapper });
    
    const quickStart = updatedResult.current.apiSections.find(s => s.id === 'quick-start');
    expect(quickStart?.title).toBe('Быстрый старт');
  });

  it('should return translated sidebar sections', () => {
    const { result } = renderHook(() => useApiTranslations(), { wrapper });
    
    expect(result.current.sidebarSections[0].title).toBe('Guide');
    expect(result.current.sidebarSections[0].links[0].label).toBe('Quick Start');
  });

  it('should return translated filter label', () => {
    const { result } = renderHook(() => useApiTranslations(), { wrapper });
    
    expect(result.current.filterLabel).toBe('Filter API sections');
  });

  it('should return all expected sidebar section categories', () => {
    const { result } = renderHook(() => useApiTranslations(), { wrapper });
    
    const sectionTitles = result.current.sidebarSections.map(s => s.title);
    expect(sectionTitles).toEqual(['Guide', 'Core', 'API Modules', 'Data']);
  });

  it('should return the correct number of API sections', () => {
    const { result } = renderHook(() => useApiTranslations(), { wrapper });
    
    // Should have sections for all the main APIs
    expect(result.current.apiSections.length).toBeGreaterThan(0);
    
    // Check specific sections exist
    const sectionIds = result.current.apiSections.map(s => s.id);
    expect(sectionIds).toContain('quick-start');
    expect(sectionIds).toContain('core');
    expect(sectionIds).toContain('blocks-api');
  });
});
