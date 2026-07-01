import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { ApiMethodCard } from './ApiMethodCard';
import { I18nProvider } from '../../contexts/I18nContext';
import { FrameworkProvider } from '../../contexts/FrameworkContext';
import type { ApiMethod } from './api-data';

vi.mock('../common/CodeBlock', () => ({
  CodeBlock: ({ code }: { code: string }) => <div data-blok-testid="code-block">{code}</div>,
}));

// ApiMethodCard adapts its example to the active framework, which lives in the
// URL, so a router plus both context providers are required.
const Providers = ({ children }: { children: ReactNode }) => (
  <MemoryRouter>
    <I18nProvider>
      <FrameworkProvider>{children}</FrameworkProvider>
    </I18nProvider>
  </MemoryRouter>
);

const renderCard = (method: ApiMethod, sectionId: string): ReturnType<typeof render> =>
  render(
    <Providers>
      <ApiMethodCard method={method} sectionId={sectionId} />
    </Providers>,
  );

const wrap = (children: ReactNode): ReturnType<typeof render> =>
  render(<Providers>{children}</Providers>);

describe('ApiMethodCard', () => {
  const mockMethod: ApiMethod = {
    name: 'blocks.move(toIndex, fromIndex?)',
    returnType: 'void',
    description: 'Moves a block to a new position.',
    example: '// Move current block to top\neditor.blocks.move(0);',
  };

  it('should render method name and return type', () => {
    renderCard(mockMethod, 'blocks-api');

    expect(screen.getByText('blocks.move(toIndex, fromIndex?)')).toBeInTheDocument();
    expect(screen.getByText('void')).toBeInTheDocument();
  });

  it('should render the method name as a heading level 3 (h1 page title -> h2 group label -> h3 method name)', () => {
    renderCard(mockMethod, 'blocks-api');

    const heading = screen.getByRole('heading', { level: 3, name: 'blocks.move(toIndex, fromIndex?)' });
    expect(heading).toBeInTheDocument();
  });

  it('should render method description', () => {
    renderCard(mockMethod, 'blocks-api');

    expect(screen.getByText('Moves a block to a new position.')).toBeInTheDocument();
  });

  it('should render code example when provided', () => {
    renderCard(mockMethod, 'blocks-api');

    const codeBlock = screen.getByTestId('code-block');
    expect(codeBlock).toBeInTheDocument();
    expect(codeBlock).toHaveTextContent('editor.blocks.move(0);');
  });

  it('should not render code example when not provided', () => {
    const methodWithoutExample: ApiMethod = {
      name: 'blocks.clear()',
      returnType: 'Promise<void>',
      description: 'Remove all blocks.',
    };

    renderCard(methodWithoutExample, 'blocks-api');

    expect(screen.queryByTestId('code-block')).not.toBeInTheDocument();
  });

  it('should render a "when to use" note when provided', () => {
    const methodWithNote: ApiMethod = {
      ...mockMethod,
      note: 'Indexes are post-removal: subtract 1 for a forward move.',
    };

    renderCard(methodWithNote, 'blocks-api');

    const note = screen.getByTestId('api-method-note');
    expect(note).toBeInTheDocument();
    expect(note).toHaveTextContent('Indexes are post-removal');
    expect(screen.getByText('When to use')).toBeInTheDocument();
  });

  it('should not render a note block when no note is provided', () => {
    renderCard(mockMethod, 'blocks-api');

    expect(screen.queryByTestId('api-method-note')).not.toBeInTheDocument();
  });

  it('should render inline code chips inside the note', () => {
    const methodWithNote: ApiMethod = {
      ...mockMethod,
      note: 'Pairs with `getCurrentBlockIndex()`.',
    };

    const { container } = renderCard(methodWithNote, 'blocks-api');

    const codeChip = container.querySelector('[data-blok-testid="api-method-note"] code');
    expect(codeChip).not.toBeNull();
    expect(codeChip).toHaveTextContent('getCurrentBlockIndex()');
  });

  it('should render the card element', () => {
    wrap(<ApiMethodCard method={mockMethod} sectionId="blocks-api" />);

    expect(screen.getByTestId('api-method-card')).toBeInTheDocument();
  });

  it('should not draw its own bordered/card box around the whole method (a divider separates methods instead)', () => {
    wrap(<ApiMethodCard method={mockMethod} sectionId="blocks-api" />);

    const card = screen.getByTestId('api-method-card');
    expect(card.className).not.toMatch(/bg-card/);
    expect(card.className).not.toMatch(/shadow/);
  });

  it('should assign correct id to the method card', () => {
    renderCard(mockMethod, 'blocks-api');

    const card = screen.getByTestId('api-method-card');
    expect(card).toHaveAttribute('id', 'blocks-api-blocks-move');
  });

  it('should generate clean anchor id from method with parentheses', () => {
    const simpleMethod: ApiMethod = {
      name: 'save()',
      returnType: 'Promise<void>',
      description: 'Saves content.',
    };

    renderCard(simpleMethod, 'core');

    const card = screen.getByTestId('api-method-card');
    expect(card).toHaveAttribute('id', 'core-save');
  });

  describe('parameters table', () => {
    const methodWithParams: ApiMethod = {
      ...mockMethod,
      params: [
        { name: 'toIndex', type: 'number', required: true, description: 'Target index.' },
        { name: 'fromIndex', type: 'number', required: false, default: 'current index', description: 'Source index.' },
      ],
    };

    it('should render a parameters table when params are provided', () => {
      renderCard(methodWithParams, 'blocks-api');

      const params = screen.getByTestId('api-method-params');
      expect(params).toBeInTheDocument();
      expect(params).toHaveTextContent('toIndex');
      expect(params).toHaveTextContent('fromIndex');
      expect(params).toHaveTextContent('Target index.');
      expect(params).toHaveTextContent('current index');
    });

    it('should not render a parameters table when no params are provided', () => {
      renderCard(mockMethod, 'blocks-api');

      expect(screen.queryByTestId('api-method-params')).not.toBeInTheDocument();
    });

    it('should show a dash for an optional param with no default', () => {
      const method: ApiMethod = {
        ...mockMethod,
        params: [{ name: 'config', type: 'ToolConfig', required: false, description: 'Tool config.' }],
      };

      renderCard(method, 'blocks-api');

      const params = screen.getByTestId('api-method-params');
      const row = within(params).getByText('config').closest('tr');
      expect(row).not.toBeNull();
      expect(row).toHaveTextContent('—');
    });
  });

  describe('errors list', () => {
    const methodWithErrors: ApiMethod = {
      ...mockMethod,
      errors: [
        {
          condition: 'No block exists with the given id.',
          message: 'Block with id "<id>" not found',
          resolution: 'Confirm the id with getById() first.',
        },
      ],
    };

    it('should render an errors section when errors are provided', () => {
      renderCard(methodWithErrors, 'blocks-api');

      const errors = screen.getByTestId('api-method-errors');
      expect(errors).toBeInTheDocument();
      expect(errors).toHaveTextContent('No block exists with the given id.');
      expect(errors).toHaveTextContent('Block with id "<id>" not found');
      expect(errors).toHaveTextContent('Confirm the id with getById() first.');
    });

    it('should not render an errors section when no errors are provided', () => {
      renderCard(mockMethod, 'blocks-api');

      expect(screen.queryByTestId('api-method-errors')).not.toBeInTheDocument();
    });
  });

  describe('deprecation', () => {
    it('should render a Deprecated badge when deprecatedSince is set', () => {
      const deprecatedMethod: ApiMethod = {
        ...mockMethod,
        deprecatedSince: '0.23.5',
      };

      renderCard(deprecatedMethod, 'readonly-api');

      expect(screen.getByTestId('api-method-deprecated-badge')).toBeInTheDocument();
      expect(screen.getByTestId('api-method-deprecated')).toHaveTextContent('0.23.5');
    });

    it('should not render a Deprecated badge when deprecatedSince is not set', () => {
      renderCard(mockMethod, 'blocks-api');

      expect(screen.queryByTestId('api-method-deprecated-badge')).not.toBeInTheDocument();
      expect(screen.queryByTestId('api-method-deprecated')).not.toBeInTheDocument();
    });

    it('should link replacedBy to the in-page anchor of the replacement method', () => {
      const deprecatedMethod: ApiMethod = {
        name: 'readOnly.toggle(state?)',
        returnType: 'Promise<boolean>',
        description: 'Toggle read-only state.',
        deprecatedSince: '0.23.5',
        replacedBy: 'readOnly.set',
      };

      renderCard(deprecatedMethod, 'readonly-api');

      const link = screen.getByRole('link', { name: 'readOnly.set' });
      expect(link).toHaveAttribute('href', '#readonly-api-readonly-set');
    });
  });
});
