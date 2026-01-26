import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ApiSection } from './ApiSection';
import type { ApiSection as ApiSectionType } from './api-data';

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
    render(<ApiSection section={mockSection} />);

    // Title includes anchor link, check the heading contains the section title text
    const title = screen.getByRole('heading', { level: 1 });
    expect(title).toHaveTextContent('Test Section');
  });

  it('should render the badge when provided', () => {
    render(<ApiSection section={mockSection} />);

    expect(screen.getByText('Test')).toBeInTheDocument();
  });

  it('should render the description', () => {
    render(<ApiSection section={mockSection} />);

    expect(screen.getByText('This is a test section')).toBeInTheDocument();
  });

  it('should render methods when provided', () => {
    render(<ApiSection section={mockSection} />);

    expect(screen.getByText('Methods')).toBeInTheDocument();
    expect(screen.getByText('testMethod()')).toBeInTheDocument();
    expect(screen.getByText('string')).toBeInTheDocument();
    expect(screen.getByText('A test method')).toBeInTheDocument();
  });

  it('should render method example when provided', () => {
    render(<ApiSection section={mockSection} />);

    // CodeBlock renders with a copy button that can be queried by testid
    const copyButton = screen.getByTestId('code-copy-button');
    expect(copyButton).toBeInTheDocument();
    expect(copyButton).toHaveAttribute('data-code', 'const result = editor.testMethod();');
  });

  it('should render properties when provided', () => {
    render(<ApiSection section={mockSection} />);

    expect(screen.getByText('Properties')).toBeInTheDocument();
    expect(screen.getByText('testProperty')).toBeInTheDocument();
    expect(screen.getByText('boolean')).toBeInTheDocument();
    expect(screen.getByText('A test property')).toBeInTheDocument();
  });

  it('should render table for config sections', () => {
    render(<ApiSection section={mockConfigSection} />);

    expect(screen.getByText('holder')).toBeInTheDocument();
    expect(screen.getByText('tools')).toBeInTheDocument();
  });

  it('should render table with Option column for config sections', () => {
    render(<ApiSection section={mockConfigSection} />);

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

    render(<ApiSection section={nonConfigSection} />);

    // Check that Option header does not exist for non-config sections
    const optionHeader = screen.queryByRole('columnheader', { name: 'Option' });
    expect(optionHeader).not.toBeInTheDocument();

    // Property header should exist instead
    const propertyHeader = screen.getByRole('columnheader', { name: 'Property' });
    expect(propertyHeader).toBeInTheDocument();
  });

  it('should render quick-start content for customType quick-start', () => {
    render(<ApiSection section={mockQuickStartSection} />);

    expect(screen.getByText('Install Blok')).toBeInTheDocument();
    expect(screen.getByText('Import and configure')).toBeInTheDocument();
    expect(screen.getByText('Save content')).toBeInTheDocument();
  });

  it('should render 3 steps for quick-start section', () => {
    render(<ApiSection section={mockQuickStartSection} />);

    // Quick start has 3 h3 headings for the steps
    const headings = screen.getAllByRole('heading', { level: 3 });
    expect(headings).toHaveLength(3);
    expect(headings[0]).toHaveTextContent('Install Blok');
    expect(headings[1]).toHaveTextContent('Import and configure');
    expect(headings[2]).toHaveTextContent('Save content');
  });

  it('should render section with heading level 1 for title', () => {
    render(<ApiSection section={mockSection} />);

    const title = screen.getByRole('heading', { level: 1 });
    expect(title).toHaveTextContent('Test Section');
  });

  it('should render section heading with badge', () => {
    render(<ApiSection section={mockSection} />);

    const badge = screen.getByText('Test');
    expect(badge).toBeInTheDocument();
  });

  it('should render methods block with heading level 3', () => {
    render(<ApiSection section={mockSection} />);

    const methodsHeading = screen.getByRole('heading', { level: 3, name: 'Methods' });
    expect(methodsHeading).toBeInTheDocument();
  });

  it('should render properties block with heading level 3', () => {
    const propsOnlySection: ApiSectionType = {
      id: 'props-only',
      title: 'Props Only',
      properties: mockSection.properties,
    };

    render(<ApiSection section={propsOnlySection} />);

    const propertiesHeading = screen.getByRole('heading', { level: 3, name: 'Properties' });
    expect(propertiesHeading).toBeInTheDocument();
  });

  it('should render method name and return type together', () => {
    render(<ApiSection section={mockSection} />);

    expect(screen.getByText('testMethod()')).toBeInTheDocument();
    expect(screen.getByText('string')).toBeInTheDocument();
  });

  it('should render method description', () => {
    render(<ApiSection section={mockSection} />);

    expect(screen.getByText('A test method')).toBeInTheDocument();
  });

  it('should render property table with proper columns', () => {
    render(<ApiSection section={mockSection} />);

    const table = screen.getByRole('table');
    expect(table).toBeInTheDocument();

    expect(screen.getByRole('columnheader', { name: 'Property' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Type' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Description' })).toBeInTheDocument();
  });

  it('should render config table with proper columns', () => {
    render(<ApiSection section={mockConfigSection} />);

    expect(screen.getByRole('columnheader', { name: 'Option' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Type' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Default' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Description' })).toBeInTheDocument();
  });

  it('should render code block for method examples', () => {
    render(<ApiSection section={mockSection} />);

    // Check for the CodeBlock wrapper using testid
    const codeBlock = screen.getByTestId('code-block');
    expect(codeBlock).toBeInTheDocument();
  });

  it('should render anchor link for the section title', () => {
    render(<ApiSection section={mockSection} />);

    const anchorLink = screen.getByRole('link', { name: /Link to Test Section/ });
    expect(anchorLink).toBeInTheDocument();
    expect(anchorLink).toHaveAttribute('href', '#test-section');
    expect(anchorLink).toHaveClass('api-anchor-link');
  });

  it('should render anchor link for methods', () => {
    render(<ApiSection section={mockSection} />);

    const methodAnchor = screen.getByRole('link', { name: /Link to testMethod/ });
    expect(methodAnchor).toBeInTheDocument();
    expect(methodAnchor).toHaveAttribute('href', '#test-section-testmethod');
  });

  it('should render anchor links for properties', () => {
    render(<ApiSection section={mockSection} />);

    const propAnchor = screen.getByRole('link', { name: /Link to testProperty/ });
    expect(propAnchor).toBeInTheDocument();
    expect(propAnchor).toHaveAttribute('href', '#test-section-prop-testproperty');
    expect(propAnchor).toHaveClass('api-anchor-link--table');
  });

  it('should render property rows with id for anchor navigation', () => {
    render(<ApiSection section={mockSection} />);

    const propRow = document.getElementById('test-section-prop-testproperty');
    expect(propRow).toBeInTheDocument();
    expect(propRow?.tagName.toLowerCase()).toBe('tr');
  });

  it('should render anchor links for config options', () => {
    render(<ApiSection section={mockConfigSection} />);

    const holderAnchor = screen.getByRole('link', { name: /Link to holder/ });
    expect(holderAnchor).toBeInTheDocument();
    expect(holderAnchor).toHaveAttribute('href', '#config-holder');

    const toolsAnchor = screen.getByRole('link', { name: /Link to tools/ });
    expect(toolsAnchor).toBeInTheDocument();
    expect(toolsAnchor).toHaveAttribute('href', '#config-tools');
  });

  it('should render config option rows with id for anchor navigation', () => {
    render(<ApiSection section={mockConfigSection} />);

    const holderRow = document.getElementById('config-holder');
    expect(holderRow).toBeInTheDocument();
    expect(holderRow?.tagName.toLowerCase()).toBe('tr');

    const toolsRow = document.getElementById('config-tools');
    expect(toolsRow).toBeInTheDocument();
  });
});
