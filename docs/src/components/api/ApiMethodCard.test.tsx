import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
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
});
