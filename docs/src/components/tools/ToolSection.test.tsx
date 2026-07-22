// docs/src/components/tools/ToolSection.test.tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { I18nProvider } from '../../contexts/I18nContext';
import { FrameworkProvider } from '../../contexts/FrameworkContext';
import { ToolSection } from './ToolSection';
import type { ToolSection as ToolSectionType } from './tools-data';
import { ROUTE_METADATA, getRouteMetadata } from '../../seo/route-metadata';
import { applyTypography } from '../../utils/typography';

const mockSection: ToolSectionType = {
  id: 'test-tool',
  exportName: 'TestTool',
  type: 'block',
  title: 'Test Tool',
  description: 'A test tool description.',
  importExample: `import { TestTool } from '@bloklabs/core/tools';`,
  configOptions: [
    { option: 'foo', type: 'string', default: '""', description: 'Foo option' },
  ],
  saveDataShape: `interface TestData { text: string; }`,
  saveDataExample: `{ "type": "test-tool", "data": { "text": "hi" } }`,
  usageExample: `new Blok({ tools: { test: TestTool } });`,
};

const renderSection = (section: ToolSectionType) =>
  render(
    <MemoryRouter>
      <I18nProvider>
        <FrameworkProvider>
          <ToolSection section={section} />
        </FrameworkProvider>
      </I18nProvider>
    </MemoryRouter>
  );

describe('ToolSection', () => {
  it('heads a ru page with the localized H1, not the bare section title', () => {
    // getRouteMetadata resolves the locale from the path, so an unprefixed
    // `/docs/table` always returns English — which is why this used to be gated
    // off for every non-en locale. The gate outlived /ru/**: the ru JSON-LD
    // headline already carries the descriptive Russian copy, so leaving the
    // visible H1 on the bare section title made structured data contradict the
    // page it describes, which Google treats as a violation.
    const metadata = getRouteMetadata('/ru/docs/table');

    if (metadata === undefined) {
      throw new Error('ru copy for /docs/table is missing — this test would prove nothing');
    }

    render(
      <MemoryRouter initialEntries={['/ru/docs/table']}>
        <I18nProvider locale="ru">
          <FrameworkProvider>
            <ToolSection section={{ ...mockSection, id: 'table', title: 'Таблица' }} />
          </FrameworkProvider>
        </I18nProvider>
      </MemoryRouter>
    );

    // <Typo> inserts locale-aware non-breaking spaces, so compare against the
    // form the component legitimately renders.
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(applyTypography(metadata.h1, 'ru'));
  });

  it('renders the section with testid', () => {
    renderSection(mockSection);
    expect(screen.getByTestId('tools-section-test-tool')).toBeInTheDocument();
  });

  it('renders the tool title', () => {
    renderSection(mockSection);
    expect(screen.getByRole('heading', { name: /Test Tool/i })).toBeInTheDocument();
  });

  it('does not render a type badge tag', () => {
    renderSection(mockSection);
    expect(screen.queryByTestId('tools-section-badge')).not.toBeInTheDocument();
  });

  it('renders the description', () => {
    renderSection(mockSection);
    expect(screen.getByText('A test tool description.')).toBeInTheDocument();
  });

  it('renders the import example code block with correct code', () => {
    renderSection(mockSection);
    const copyButtons = screen.getAllByTestId('code-copy-button');
    const importButton = copyButtons.find((btn) =>
      btn.getAttribute('data-code')?.includes('TestTool')
    );
    expect(importButton).toBeDefined();
    expect(importButton?.getAttribute('data-code')).toContain('TestTool');
  });

  it('renders config options table when configOptions is non-empty', () => {
    renderSection(mockSection);
    expect(screen.getByText('foo')).toBeInTheDocument();
    expect(screen.getByText('Foo option')).toBeInTheDocument();
  });

  it('renders the save data shape code block', () => {
    renderSection(mockSection);
    const copyButtons = screen.getAllByTestId('code-copy-button');
    const shapeButton = copyButtons.find((btn) =>
      btn.getAttribute('data-code')?.includes('TestData')
    );
    expect(shapeButton).toBeDefined();
  });

  it('renders the usage example code block', () => {
    renderSection(mockSection);
    const copyButtons = screen.getAllByTestId('code-copy-button');
    const usageButton = copyButtons.find((btn) =>
      btn.getAttribute('data-code')?.includes('new Blok')
    );
    expect(usageButton).toBeDefined();
  });

  it('does not render config table when configOptions is empty', () => {
    const noConfig = { ...mockSection, configOptions: [] };
    renderSection(noConfig);
    // The config heading should not be present
    expect(screen.queryByText('Configuration')).not.toBeInTheDocument();
  });

  describe('SEO heading copy', () => {
    it('renders the route metadata h1 instead of the bare tool name', () => {
      renderSection({ ...mockSection, id: 'table', title: 'Table' });

      const heading = screen.getByRole('heading', { level: 1 });
      expect(heading).toHaveTextContent(ROUTE_METADATA['/docs/table'].h1);
      expect(heading).not.toHaveTextContent(/^Table$/);
    });

    it('falls back to the tool title when the route has no metadata', () => {
      renderSection(mockSection);

      expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Test Tool');
    });
  });
});
