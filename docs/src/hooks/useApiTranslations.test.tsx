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

  it('should translate core section method descriptions in Russian', () => {
    const { result: i18nResult } = renderHook(() => useI18n(), { wrapper });
    act(() => { i18nResult.current.setLocale('ru'); });

    const { result } = renderHook(() => useApiTranslations(), { wrapper });
    const coreSection = result.current.apiSections.find(s => s.id === 'core');

    const saveMethod = coreSection?.methods?.find(m => m.name === 'save()');
    expect(saveMethod?.description).toBe('Извлекает содержимое редактора в виде JSON-данных. Основной метод для сохранения контента.');

    const renderMethod = coreSection?.methods?.find(m => m.name === 'render(data)');
    expect(renderMethod?.description).toBe('Отображает содержимое редактора из ранее сохранённых JSON-данных.');

    const focusMethod = coreSection?.methods?.find(m => m.name === 'focus(atEnd?)');
    expect(focusMethod?.description).toBe('Устанавливает фокус на редактор. Опционально позиционирует курсор в конце содержимого.');

    const clearMethod = coreSection?.methods?.find(m => m.name === 'clear()');
    expect(clearMethod?.description).toBe('Удаляет все блоки из редактора.');

    const destroyMethod = coreSection?.methods?.find(m => m.name === 'destroy()');
    expect(destroyMethod?.description).toBe('Уничтожает экземпляр редактора и удаляет все DOM-элементы и обработчики событий.');
  });

  it('should translate core section property descriptions in Russian', () => {
    const { result: i18nResult } = renderHook(() => useI18n(), { wrapper });
    act(() => { i18nResult.current.setLocale('ru'); });

    const { result } = renderHook(() => useApiTranslations(), { wrapper });
    const coreSection = result.current.apiSections.find(s => s.id === 'core');

    const isReadyProp = coreSection?.properties?.find(p => p.name === 'isReady');
    expect(isReadyProp?.description).toBe('Promise, который разрешается, когда редактор готов');

    const blocksProp = coreSection?.properties?.find(p => p.name === 'blocks');
    expect(blocksProp?.description).toBe('Модуль API для работы с блоками');
  });

  it('should translate configuration section table row descriptions in Russian', () => {
    const { result: i18nResult } = renderHook(() => useI18n(), { wrapper });
    act(() => { i18nResult.current.setLocale('ru'); });

    const { result } = renderHook(() => useApiTranslations(), { wrapper });
    const configSection = result.current.apiSections.find(s => s.id === 'config');

    const holderRow = configSection?.table?.find(r => r.option === 'holder');
    expect(holderRow?.description).toBe('Контейнер (ID или элемент DOM)');

    const toolsRow = configSection?.table?.find(r => r.option === 'tools');
    expect(toolsRow?.description).toBe('Доступные блочные и строчные инструменты');

    const readOnlyRow = configSection?.table?.find(r => r.option === 'readOnly');
    expect(readOnlyRow?.description).toBe('Включить режим только для чтения');
  });

  it('should keep English method descriptions unchanged in English locale', () => {
    const { result } = renderHook(() => useApiTranslations(), { wrapper });
    const coreSection = result.current.apiSections.find(s => s.id === 'core');

    const saveMethod = coreSection?.methods?.find(m => m.name === 'save()');
    expect(saveMethod?.description).toBe('Extracts the current editor content as structured JSON data. This is the primary method for persisting editor content.');
  });

  it('should keep English table descriptions unchanged in English locale', () => {
    const { result } = renderHook(() => useApiTranslations(), { wrapper });
    const configSection = result.current.apiSections.find(s => s.id === 'config');

    const holderRow = configSection?.table?.find(r => r.option === 'holder');
    expect(holderRow?.description).toBe('Container element ID or reference');
  });
});
