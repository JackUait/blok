import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { ApiSection } from './ApiSection';
import type { ApiSection as ApiSectionType } from './api-data';
import { I18nProvider } from '../../contexts/I18nContext';
import { FrameworkProvider } from '../../contexts/FrameworkContext';

/**
 * ApiSection reads the active framework, which now lives in the URL, so a router
 * plus both context providers are required.
 */
const Providers = ({ children }: { children: ReactNode }) => (
  <MemoryRouter>
    <I18nProvider>
      <FrameworkProvider>{children}</FrameworkProvider>
    </I18nProvider>
  </MemoryRouter>
);

const mockSection: ApiSectionType = {
  id: 'test-section',
  badge: 'Test',
  title: 'Test Section',
  description: 'This is a test section',
  methods: [
    {
      name: 'testMethod()',
      returnType: 'string',
      description: 'A test method',
      example: "const result = editor.testMethod();",
    },
  ],
  properties: [
    {
      name: 'testProperty',
      type: 'boolean',
      description: 'A test property',
    },
  ],
};

const mockConfigSection: ApiSectionType = {
  id: 'config',
  title: 'Configuration',
  description: 'Configuration options',
  example: `import { Blok, type BlokConfig } from '@blok/core';

const config: BlokConfig = {
  holder: 'editor',
  tools: { paragraph: Paragraph },
};

const editor = new Blok(config);`,
  table: [
    {
      option: 'holder',
      type: 'string',
      default: "'blok'",
      description: 'Container element',
    },
    {
      option: 'tools',
      type: 'object',
      default: '{}',
      description: 'Available tools',
    },
  ],
};

const mockQuickStartSection: ApiSectionType = {
  id: 'quick-start',
  badge: 'Guide',
  title: 'Quick Start',
  description: 'Get started quickly',
  customType: 'quick-start',
};

describe('ApiSection', () => {
  it('should render the title', () => {
    render(<Providers><ApiSection section={mockSection} /></Providers>);

    // Title includes anchor link, check the heading contains the section title text
    const title = screen.getByRole('heading', { level: 1 });
    expect(title).toHaveTextContent('Test Section');
  });

  it('should not render the section badge tag', () => {
    render(<Providers><ApiSection section={mockSection} /></Providers>);

    expect(screen.queryByTestId('api-section-badge')).not.toBeInTheDocument();
    expect(screen.queryByText('Test')).not.toBeInTheDocument();
  });

  it('should render the description', () => {
    render(<Providers><ApiSection section={mockSection} /></Providers>);

    expect(screen.getByText('This is a test section')).toBeInTheDocument();
  });

  it('should render methods when provided', () => {
    render(<Providers><ApiSection section={mockSection} /></Providers>);

    expect(screen.getByText('Methods')).toBeInTheDocument();
    expect(screen.getByText('testMethod()')).toBeInTheDocument();
    expect(screen.getByText('string')).toBeInTheDocument();
    expect(screen.getByText('A test method')).toBeInTheDocument();
  });

  it('should render method example when provided', () => {
    render(<Providers><ApiSection section={mockSection} /></Providers>);

    // The method card's CodeBlock exposes a copy button carrying its example.
    // (Method sections also render the framework-aware editor-access note, which
    // has its own code block, so scope the query to the method card.)
    const methodCard = screen.getByTestId('api-method-card');
    const copyButton = within(methodCard).getByTestId('code-copy-button');
    expect(copyButton).toBeInTheDocument();
    expect(copyButton).toHaveAttribute('data-code', 'const result = editor.testMethod();');
  });

  it('should render properties when provided', () => {
    render(<Providers><ApiSection section={mockSection} /></Providers>);

    expect(screen.getByText('Properties')).toBeInTheDocument();
    expect(screen.getByText('testProperty')).toBeInTheDocument();
    expect(screen.getByText('boolean')).toBeInTheDocument();
    expect(screen.getByText('A test property')).toBeInTheDocument();
  });

  it('should render table for config sections', () => {
    render(<Providers><ApiSection section={mockConfigSection} /></Providers>);

    expect(screen.getByText('holder')).toBeInTheDocument();
    expect(screen.getByText('tools')).toBeInTheDocument();
  });

  it('should render table with Option column for config sections', () => {
    render(<Providers><ApiSection section={mockConfigSection} /></Providers>);

    const table = screen.getByRole('table');
    expect(table).toBeInTheDocument();

    // Check that table has an Option column header
    const optionHeader = screen.getByRole('columnheader', { name: 'Option' });
    expect(optionHeader).toBeInTheDocument();
  });

  it('should render table without Option column for non-config sections', () => {
    const nonConfigSection: ApiSectionType = {
      id: 'output-data',
      title: 'OutputData',
      table: [
        {
          option: 'version',
          type: 'string',
          default: '—',
          description: 'Editor version',
        },
      ],
    };

    render(<Providers><ApiSection section={nonConfigSection} /></Providers>);

    // Check that Option header does not exist for non-config sections
    const optionHeader = screen.queryByRole('columnheader', { name: 'Option' });
    expect(optionHeader).not.toBeInTheDocument();

    // Property header should exist instead
    const propertyHeader = screen.getByRole('columnheader', { name: 'Property' });
    expect(propertyHeader).toBeInTheDocument();
  });

  it('should render quick-start content for customType quick-start', () => {
    render(<Providers><ApiSection section={mockQuickStartSection} /></Providers>);

    expect(screen.getByText('Install Blok')).toBeInTheDocument();
    expect(screen.getByText('Import and configure')).toBeInTheDocument();
    expect(screen.getByText('Save content')).toBeInTheDocument();
  });

  it('should render 3 steps for quick-start section', () => {
    render(<Providers><ApiSection section={mockQuickStartSection} /></Providers>);

    // Quick start has 3 h3 headings for the steps
    const headings = screen.getAllByRole('heading', { level: 3 });
    expect(headings).toHaveLength(3);
    expect(headings[0]).toHaveTextContent('Install Blok');
    expect(headings[1]).toHaveTextContent('Import and configure');
    expect(headings[2]).toHaveTextContent('Save content');
  });

  it('should render section with heading level 1 for title', () => {
    render(<Providers><ApiSection section={mockSection} /></Providers>);

    const title = screen.getByRole('heading', { level: 1 });
    expect(title).toHaveTextContent('Test Section');
  });

  it('should render section heading without a badge tag', () => {
    render(<Providers><ApiSection section={mockSection} /></Providers>);

    const title = screen.getByRole('heading', { level: 1 });
    expect(title).toHaveTextContent('Test Section');
    expect(screen.queryByTestId('api-section-badge')).not.toBeInTheDocument();
  });

  it('should render methods block with heading level 2 (no h1->h3 skip)', () => {
    render(<Providers><ApiSection section={mockSection} /></Providers>);

    const methodsHeading = screen.getByRole('heading', { level: 2, name: 'Methods' });
    expect(methodsHeading).toBeInTheDocument();
  });

  it('should render properties block with heading level 2 (no h1->h3 skip)', () => {
    const propsOnlySection: ApiSectionType = {
      id: 'props-only',
      title: 'Props Only',
      properties: mockSection.properties,
    };

    render(<Providers><ApiSection section={propsOnlySection} /></Providers>);

    const propertiesHeading = screen.getByRole('heading', { level: 2, name: 'Properties' });
    expect(propertiesHeading).toBeInTheDocument();
  });

  it('should render exactly one h1, methods/properties as h2, and method names as h3', () => {
    render(<Providers><ApiSection section={mockSection} /></Providers>);

    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(screen.getByRole('heading', { level: 2, name: 'Methods' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: 'Properties' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 3, name: 'testMethod()' })).toBeInTheDocument();
  });

  it('should render method name and return type together', () => {
    render(<Providers><ApiSection section={mockSection} /></Providers>);

    expect(screen.getByText('testMethod()')).toBeInTheDocument();
    expect(screen.getByText('string')).toBeInTheDocument();
  });

  it('should render method description', () => {
    render(<Providers><ApiSection section={mockSection} /></Providers>);

    expect(screen.getByText('A test method')).toBeInTheDocument();
  });

  it('should render property table with proper columns', () => {
    render(<Providers><ApiSection section={mockSection} /></Providers>);

    const table = screen.getByRole('table');
    expect(table).toBeInTheDocument();

    expect(screen.getByRole('columnheader', { name: 'Property' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Type' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Description' })).toBeInTheDocument();
  });

  it('should render config table with proper columns', () => {
    render(<Providers><ApiSection section={mockConfigSection} /></Providers>);

    expect(screen.getByRole('columnheader', { name: 'Option' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Type' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Default' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Description' })).toBeInTheDocument();
  });

  it('should render code block for method examples', () => {
    render(<Providers><ApiSection section={mockSection} /></Providers>);

    // Check for the method card's CodeBlock wrapper (scoped past the
    // editor-access note's own code block).
    const methodCard = screen.getByTestId('api-method-card');
    const codeBlock = within(methodCard).getByTestId('code-block');
    expect(codeBlock).toBeInTheDocument();
  });

  it('should render property rows with id for anchor navigation', () => {
    render(<Providers><ApiSection section={mockSection} /></Providers>);

    const propRow = screen.getByTestId('test-section-prop-testproperty');
    expect(propRow).toBeInTheDocument();
    expect(propRow.tagName.toLowerCase()).toBe('tr');
  });

  it('should render config option rows with id for anchor navigation', () => {
    render(<Providers><ApiSection section={mockConfigSection} /></Providers>);

    const holderRow = screen.getByTestId('config-holder');
    expect(holderRow).toBeInTheDocument();
    expect(holderRow.tagName.toLowerCase()).toBe('tr');

    const toolsRow = screen.getByTestId('config-tools');
    expect(toolsRow).toBeInTheDocument();
  });

  describe('Configuration section clarity', () => {
    it('should display an example showing the BlokConfig interface', () => {
      // Use mockConfigSection which now has an example
      render(<Providers><ApiSection section={mockConfigSection} /></Providers>);

      // Should show a code example demonstrating that these properties
      // are passed to the Blok constructor
      const codeBlock = screen.getByTestId('code-block');
      expect(codeBlock).toBeInTheDocument();

      // The example should show "new Blok" to make it clear
      // these are constructor options
      const copyButton = screen.getByTestId('code-copy-button');
      const code = copyButton.getAttribute('data-code');
      expect(code).toBeDefined();
      expect(code).toContain('new Blok');
      expect(code).toContain('holder:');
    });

    it('should show the TypeScript interface for configuration', () => {
      // Use mockConfigSection which has BlokConfig in the example
      render(<Providers><ApiSection section={mockConfigSection} /></Providers>);

      // Should show BlokConfig interface to clarify what object
      // these properties belong to
      expect(screen.getByText(/BlokConfig/)).toBeInTheDocument();
    });
  });

  describe('framework-aware examples', () => {
    beforeEach(() => localStorage.clear());
    afterEach(() => localStorage.clear());

    const codes = () =>
      screen
        .getAllByTestId('code-copy-button')
        .map((b) => b.getAttribute('data-code') ?? '');

    it('shows vanilla setup snippets by default', () => {
      render(<Providers><ApiSection section={mockQuickStartSection} /></Providers>);
      const joined = codes().join('\n');
      expect(joined).toContain('new Blok(');
      expect(joined).not.toContain('@blok/react');
    });

    it('shows the React adapter setup when React is selected', () => {
      localStorage.setItem('blok-docs-framework', 'react');
      render(<Providers><ApiSection section={mockQuickStartSection} /></Providers>);
      expect(codes().join('\n')).toContain('@blok/react');
    });

    it('shows the Vue adapter setup when Vue is selected', () => {
      localStorage.setItem('blok-docs-framework', 'vue');
      render(<Providers><ApiSection section={mockQuickStartSection} /></Providers>);
      expect(codes().join('\n')).toContain('@blok/vue');
    });

    it('switches the configuration example to the selected framework', () => {
      localStorage.setItem('blok-docs-framework', 'angular');
      render(<Providers><ApiSection section={mockConfigSection} /></Providers>);
      expect(codes().join('\n')).toContain('@blok/angular');
    });

    it('shows the editor-access note on sections that document instance methods', () => {
      render(<Providers><ApiSection section={mockSection} /></Providers>);
      expect(screen.getByTestId('editor-access-note')).toBeInTheDocument();
    });

    it('adapts the editor-access note to the selected framework', () => {
      localStorage.setItem('blok-docs-framework', 'vue');
      render(<Providers><ApiSection section={mockSection} /></Providers>);
      const note = screen.getByTestId('editor-access-note');
      expect(note.textContent).toContain('editor.value');
    });

    it('omits the editor-access note on sections without methods', () => {
      render(<Providers><ApiSection section={mockConfigSection} /></Providers>);
      expect(screen.queryByTestId('editor-access-note')).toBeNull();
    });

    it('shows the #editor container markup before the vanilla mount snippet', () => {
      render(<Providers><ApiSection section={mockQuickStartSection} /></Providers>);
      const joined = codes().join('\n');
      // The container snippet must appear, and before the `new Blok(...)` call
      // that depends on it, so a reader who copy-pastes top-to-bottom ends up
      // with the element on the page before the script that looks it up.
      expect(joined).toContain('<div id="editor"></div>');
      expect(joined.indexOf('<div id="editor"></div>')).toBeLessThan(joined.indexOf('new Blok('));
    });

    it('does not show the #editor container markup for the React adapter', () => {
      localStorage.setItem('blok-docs-framework', 'react');
      render(<Providers><ApiSection section={mockQuickStartSection} /></Providers>);
      expect(codes().join('\n')).not.toContain('<div id="editor"></div>');
    });

    it('does not show the #editor container markup for the Vue adapter', () => {
      localStorage.setItem('blok-docs-framework', 'vue');
      render(<Providers><ApiSection section={mockQuickStartSection} /></Providers>);
      expect(codes().join('\n')).not.toContain('<div id="editor"></div>');
    });

    it('does not show the #editor container markup for the Angular adapter', () => {
      localStorage.setItem('blok-docs-framework', 'angular');
      render(<Providers><ApiSection section={mockQuickStartSection} /></Providers>);
      expect(codes().join('\n')).not.toContain('<div id="editor"></div>');
    });
  });

  describe('Quick Start guidance', () => {
    // Typo() swaps the space after short words (a/an/to/...) for a non-breaking
    // space, so normalize before substring-matching prose copy.
    const normalize = (text: string | null): string => (text ?? '').replace(/ /g, ' ');

    it('renders a narrative lead-in above the numbered steps', () => {
      render(<Providers><ApiSection section={mockQuickStartSection} /></Providers>);
      const target = 'fastest path from an empty project to a working editor';
      expect(
        screen.getByText((_, element) => {
          if (!element) {
            return false;
          }
          const hasText = (el: Element) => normalize(el.textContent).includes(target);
          return hasText(element) && Array.from(element.children).every((child) => !hasText(child));
        }),
      ).toBeInTheDocument();
    });

    it('renders a closing checkpoint after the last step', () => {
      render(<Providers><ApiSection section={mockQuickStartSection} /></Providers>);
      const checkpoint = screen.getByTestId('quick-start-checkpoint');
      expect(checkpoint).toBeInTheDocument();
      expect(normalize(checkpoint.textContent)).toContain(
        'you should now see an empty editor with one paragraph block',
      );
    });

    it('includes the exact missing-container error text in the troubleshooting note', () => {
      render(<Providers><ApiSection section={mockQuickStartSection} /></Providers>);
      const checkpoint = screen.getByTestId('quick-start-checkpoint');
      expect(normalize(checkpoint.textContent)).toContain('element with ID «editor» is missing');
    });

    it('omits the missing-container troubleshooting note for non-vanilla frameworks', () => {
      localStorage.setItem('blok-docs-framework', 'react');
      render(<Providers><ApiSection section={mockQuickStartSection} /></Providers>);
      const checkpoint = screen.getByTestId('quick-start-checkpoint');
      expect(normalize(checkpoint.textContent)).not.toContain('element with ID «editor» is missing');
      // The framework-agnostic success line should still be there.
      expect(normalize(checkpoint.textContent)).toContain(
        'you should now see an empty editor with one paragraph block',
      );
      localStorage.clear();
    });
  });

  describe('page-type badge', () => {
    it('never renders a badge tag, even for a quick-start/tutorial/concepts-style section', () => {
      render(<Providers><ApiSection section={mockQuickStartSection} /></Providers>);

      expect(screen.queryByTestId('api-section-badge')).not.toBeInTheDocument();
    });

    it('does not render a badge for a generic reference section, even with a badge value set', () => {
      render(<Providers><ApiSection section={mockSection} /></Providers>);

      expect(screen.queryByTestId('api-section-badge')).not.toBeInTheDocument();
    });
  });

  describe('breadcrumbs', () => {
    it('renders a breadcrumb trail above the section header', () => {
      render(<Providers><ApiSection section={mockQuickStartSection} /></Providers>);

      expect(screen.getByTestId('api-breadcrumbs')).toBeInTheDocument();
    });
  });

  describe('last updated', () => {
    it('renders the last-updated date when present', () => {
      const sectionWithDate: ApiSectionType = { ...mockSection, lastUpdated: '2026-06-30' };
      render(<Providers><ApiSection section={sectionWithDate} /></Providers>);

      const lastUpdated = screen.getByTestId('api-last-updated');
      expect(lastUpdated).toBeInTheDocument();
      expect(lastUpdated.textContent).toContain('2026');
    });

    it('does not render a last-updated line when absent', () => {
      render(<Providers><ApiSection section={mockSection} /></Providers>);

      expect(screen.queryByTestId('api-last-updated')).not.toBeInTheDocument();
    });
  });

  describe('edit on GitHub', () => {
    it('renders a link to the GitHub source for the page', () => {
      render(<Providers><ApiSection section={mockSection} /></Providers>);

      const link = screen.getByTestId('api-edit-on-github');
      expect(link).toBeInTheDocument();
      expect(link).toHaveAttribute('href', expect.stringContaining('github.com'));
    });
  });

  describe('feedback widget removal', () => {
    it('does not render a "was this helpful" prompt', () => {
      render(<Providers><ApiSection section={mockSection} /></Providers>);

      expect(screen.queryByText('Was this page helpful?')).not.toBeInTheDocument();
      expect(screen.queryByTestId('api-feedback')).not.toBeInTheDocument();
    });
  });
});
