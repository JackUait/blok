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
  it('should render a section element with correct id', () => {
    render(<ApiSection section={mockSection} />);

    const section = document.getElementById('test-section');
    expect(section).toBeInTheDocument();
  });

  it('should render the badge when provided', () => {
    render(<ApiSection section={mockSection} />);

    expect(screen.getByText('Test')).toBeInTheDocument();
  });

  it('should render the title', () => {
    render(<ApiSection section={mockSection} />);

    expect(screen.getByText('Test Section')).toBeInTheDocument();
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

    // CodeBlock renders asynchronously, so check for the wrapper
    const codeBlock = document.querySelector('.api-method-card .code-block');
    expect(codeBlock).toBeInTheDocument();
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
    const { container } = render(<ApiSection section={mockConfigSection} />);

    const table = container.querySelector('.api-table');
    expect(table).toBeInTheDocument();

    const headers = container.querySelectorAll('th');
    expect(Array.from(headers).some((h) => h.textContent === 'Option')).toBe(true);
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

    const { container } = render(<ApiSection section={nonConfigSection} />);

    const headers = container.querySelectorAll('th');
    expect(Array.from(headers).some((h) => h.textContent === 'Option')).toBe(false);
    expect(Array.from(headers).some((h) => h.textContent === 'Property')).toBe(true);
  });

  it('should render quick-start content for customType quick-start', () => {
    render(<ApiSection section={mockQuickStartSection} />);

    expect(screen.getByText('Install Blok')).toBeInTheDocument();
    expect(screen.getByText('Import and configure')).toBeInTheDocument();
    expect(screen.getByText('Save content')).toBeInTheDocument();
  });

  it('should render 3 steps for quick-start section', () => {
    const { container } = render(<ApiSection section={mockQuickStartSection} />);

    const steps = container.querySelectorAll('.api-quickstart-step');
    expect(steps.length).toBe(3);
  });

  it('should have api-section class', () => {
    const { container } = render(<ApiSection section={mockSection} />);

    const section = container.querySelector('.api-section');
    expect(section).toBeInTheDocument();
  });

  it('should have api-section-header div', () => {
    const { container } = render(<ApiSection section={mockSection} />);

    const header = container.querySelector('.api-section-header');
    expect(header).toBeInTheDocument();
  });

  it('should have api-section-badge div when badge is provided', () => {
    const { container } = render(<ApiSection section={mockSection} />);

    const badge = container.querySelector('.api-section-badge');
    expect(badge).toBeInTheDocument();
  });

  it('should have api-section-title h1', () => {
    const { container } = render(<ApiSection section={mockSection} />);

    const title = container.querySelector('.api-section-title');
    expect(title?.tagName.toLowerCase()).toBe('h1');
  });

  it('should have api-section-description p', () => {
    const { container } = render(<ApiSection section={mockSection} />);

    const description = container.querySelector('.api-section-description');
    expect(description?.tagName.toLowerCase()).toBe('p');
  });

  it('should have api-block div for methods', () => {
    const { container } = render(<ApiSection section={mockSection} />);

    const block = container.querySelector('.api-block');
    expect(block).toBeInTheDocument();
  });

  it('should have api-block-title h3', () => {
    const { container } = render(<ApiSection section={mockSection} />);

    const blockTitle = container.querySelector('.api-block-title');
    expect(blockTitle?.tagName.toLowerCase()).toBe('h3');
  });

  it('should have api-method-card div', () => {
    const { container } = render(<ApiSection section={mockSection} />);

    const method = container.querySelector('.api-method-card');
    expect(method).toBeInTheDocument();
  });

  it('should have api-method-header div', () => {
    const { container } = render(<ApiSection section={mockSection} />);

    const header = container.querySelector('.api-method-header');
    expect(header).toBeInTheDocument();
  });

  it('should have api-method-name span', () => {
    const { container } = render(<ApiSection section={mockSection} />);

    const methodName = container.querySelector('.api-method-name');
    expect(methodName).toBeInTheDocument();
  });

  it('should have api-method-return span', () => {
    const { container } = render(<ApiSection section={mockSection} />);

    const methodReturn = container.querySelector('.api-method-return');
    expect(methodReturn).toBeInTheDocument();
  });

  it('should have api-method-description p', () => {
    const { container } = render(<ApiSection section={mockSection} />);

    const description = container.querySelector('.api-method-description');
    expect(description?.tagName.toLowerCase()).toBe('p');
  });
});
