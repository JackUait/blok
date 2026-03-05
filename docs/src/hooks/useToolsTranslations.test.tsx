// docs/src/hooks/useToolsTranslations.test.tsx
import { describe, it, expect } from 'vitest';
import { renderHook } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { I18nProvider } from '../contexts/I18nContext';
import { useToolsTranslations } from './useToolsTranslations';
import { TOOL_SECTIONS } from '../components/tools/tools-data';

const wrapper = ({ children }: { children: React.ReactNode }) => (
  <MemoryRouter>
    <I18nProvider>{children}</I18nProvider>
  </MemoryRouter>
);

describe('useToolsTranslations', () => {
  it('returns toolSections with correct count', () => {
    const { result } = renderHook(() => useToolsTranslations(), { wrapper });
    expect(result.current.toolSections).toHaveLength(TOOL_SECTIONS.length);
  });

  it('returns sidebarSections with two groups', () => {
    const { result } = renderHook(() => useToolsTranslations(), { wrapper });
    expect(result.current.sidebarSections).toHaveLength(2);
  });

  it('block tools sidebar section has correct number of links', () => {
    const { result } = renderHook(() => useToolsTranslations(), { wrapper });
    const blockSection = result.current.sidebarSections[0];
    const expectedCount = TOOL_SECTIONS.filter((s) => s.type === 'block').length;
    expect(blockSection.links).toHaveLength(expectedCount);
  });

  it('inline tools sidebar section has correct number of links', () => {
    const { result } = renderHook(() => useToolsTranslations(), { wrapper });
    const inlineSection = result.current.sidebarSections[1];
    const expectedCount = TOOL_SECTIONS.filter((s) => s.type === 'inline').length;
    expect(inlineSection.links).toHaveLength(expectedCount);
  });

  it('returns a non-empty filterLabel', () => {
    const { result } = renderHook(() => useToolsTranslations(), { wrapper });
    expect(result.current.filterLabel.length).toBeGreaterThan(0);
  });

  it('every section has a non-empty title', () => {
    const { result } = renderHook(() => useToolsTranslations(), { wrapper });
    for (const section of result.current.toolSections) {
      expect(section.title.length).toBeGreaterThan(0);
    }
  });
});
