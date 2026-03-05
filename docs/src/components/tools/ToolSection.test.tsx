// docs/src/components/tools/ToolSection.test.tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { I18nProvider } from '../../contexts/I18nContext';
import { ToolSection } from './ToolSection';
import type { ToolSection as ToolSectionType } from './tools-data';

const mockSection: ToolSectionType = {
  id: 'test-tool',
  exportName: 'TestTool',
  type: 'block',
  badge: 'Block Tool',
  title: 'Test Tool',
  description: 'A test tool description.',
  importExample: `import { TestTool } from '@jackuait/blok/tools';`,
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
        <ToolSection section={section} />
      </I18nProvider>
    </MemoryRouter>
  );

describe('ToolSection', () => {
  it('renders the section with testid', () => {
    renderSection(mockSection);
    expect(screen.getByTestId('tools-section-test-tool')).toBeInTheDocument();
  });

  it('renders the tool title', () => {
    renderSection(mockSection);
    expect(screen.getByRole('heading', { name: /Test Tool/i })).toBeInTheDocument();
  });

  it('renders the badge', () => {
    renderSection(mockSection);
    expect(screen.getByText('Block Tool')).toBeInTheDocument();
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
});
