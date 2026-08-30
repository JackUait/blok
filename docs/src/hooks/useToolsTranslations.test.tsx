// docs/src/hooks/useToolsTranslations.test.tsx
import { describe, it, expect, afterEach, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { I18nProvider } from '../contexts/I18nContext';
import { useToolsTranslations } from './useToolsTranslations';
import { TOOL_SECTIONS, TOOLS_SIDEBAR_SECTIONS } from '../components/tools/tools-data';

// getTranslation returns the key itself when a key is missing, so the fallback
// only shows up with a `t` that resolves nothing.
const unresolvedTranslations = vi.hoisted(() => ({ value: false }));

vi.mock('../contexts/I18nContext', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../contexts/I18nContext')>();
  return {
    ...actual,
    useI18n: () => {
      const real = actual.useI18n();
      return unresolvedTranslations.value ? { ...real, t: (key: string) => key } : real;
    },
  };
});

const wrapper = ({ children }: { children: React.ReactNode }) => (
  <MemoryRouter>
    <I18nProvider>{children}</I18nProvider>
  </MemoryRouter>
);

describe('useToolsTranslations', () => {
  afterEach(() => {
    unresolvedTranslations.value = false;
  });

  it('returns toolSections with correct count', () => {
    const { result } = renderHook(() => useToolsTranslations(), { wrapper });
    expect(result.current.toolSections).toHaveLength(TOOL_SECTIONS.length);
  });

  // Only `title` was overlaid for a long time, so /ru/docs/<tool> rendered a
  // Russian heading over an English description and English option table.
  it('overlays the tool description and every config-option description', () => {
    const ruWrapper = ({ children }: { children: React.ReactNode }) => (
      <MemoryRouter initialEntries={['/ru/docs']}>
        <I18nProvider locale="ru">{children}</I18nProvider>
      </MemoryRouter>
    );
    const { result } = renderHook(() => useToolsTranslations(), { wrapper: ruWrapper });

    for (const section of result.current.toolSections) {
      const english = TOOL_SECTIONS.find((tool) => tool.id === section.id);
      expect(english, section.id).toBeDefined();
      expect(section.description, section.id).not.toBe(english?.description);
      expect(section.description, section.id).toMatch(/[\u0400-\u04FF]/);
      for (const [i, option] of section.configOptions.entries()) {
        expect(option.description, `${section.id}.${option.option}`).toMatch(/[\u0400-\u04FF]/);
        expect(option.description, `${section.id}.${option.option}`).not.toBe(
          english?.configOptions[i]?.description,
        );
      }
    }
  });

  it('falls back to the English description when a key is missing', () => {
    unresolvedTranslations.value = true;
    const { result } = renderHook(() => useToolsTranslations(), { wrapper });

    expect(result.current.toolSections[0].description).toBe(TOOL_SECTIONS[0].description);
    expect(result.current.toolSections[0].configOptions[0].description).toBe(
      TOOL_SECTIONS[0].configOptions[0].description,
    );
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

  it('falls back to the hardcoded label when a link has no translation', () => {
    unresolvedTranslations.value = true;

    const { result } = renderHook(() => useToolsTranslations(), { wrapper });
    const labels = result.current.sidebarSections.flatMap((section) =>
      section.links.map((link) => link.label)
    );
    const expected = TOOLS_SIDEBAR_SECTIONS.flatMap((section) =>
      section.links.map((link) => link.label)
    );

    expect(labels).toEqual(expected);
  });

  it('every section has a non-empty title', () => {
    const { result } = renderHook(() => useToolsTranslations(), { wrapper });
    for (const section of result.current.toolSections) {
      expect(section.title.length).toBeGreaterThan(0);
    }
  });
});
