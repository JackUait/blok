import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ApiMethodCard } from './ApiMethodCard';
import type { ApiMethod } from './api-data';

// Mock the sub-components
vi.mock('./ApiMethodDemo', () => ({
  ApiMethodDemo: ({ demo }: { demo?: unknown }) => (
    <div data-testid="api-method-demo">{demo ? 'Demo Section' : 'No Demo'}</div>
  ),
}));

vi.mock('../common/CodeBlock', () => ({
  CodeBlock: ({ code }: { code: string }) => <div data-testid="code-block">{code}</div>,
}));

describe('ApiMethodCard', () => {
  const mockMethod: ApiMethod = {
    name: 'blocks.move(toIndex, fromIndex?)',
    returnType: 'void',
    description: 'Moves a block to a new position.',
    example: '// Move current block to top\neditor.blocks.move(0);',
  };

  it('should render method name and return type', () => {
    render(<ApiMethodCard method={mockMethod} />);

    expect(screen.getByText('blocks.move(toIndex, fromIndex?)')).toBeInTheDocument();
    expect(screen.getByText('void')).toBeInTheDocument();
  });

  it('should render method description', () => {
    render(<ApiMethodCard method={mockMethod} />);

    expect(screen.getByText('Moves a block to a new position.')).toBeInTheDocument();
  });

  it('should render code example when provided', () => {
    render(<ApiMethodCard method={mockMethod} />);

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

    render(<ApiMethodCard method={methodWithoutExample} />);

    expect(screen.queryByTestId('code-block')).not.toBeInTheDocument();
  });

  it('should render demo section when demo config is provided', () => {
    const methodWithDemo: ApiMethod = {
      ...mockMethod,
      demo: {
        actions: [
          {
            label: 'Move first to last',
            execute: vi.fn(),
          },
        ],
      },
    };

    render(<ApiMethodCard method={methodWithDemo} />);

    expect(screen.getByTestId('api-method-demo')).toBeInTheDocument();
    expect(screen.getByText('Demo Section')).toBeInTheDocument();
  });

  it('should not render demo section when demo config is not provided', () => {
    render(<ApiMethodCard method={mockMethod} />);

    expect(screen.getByTestId('api-method-demo')).toBeInTheDocument();
    expect(screen.getByText('No Demo')).toBeInTheDocument();
  });

  it('should render the card element', () => {
    render(<ApiMethodCard method={mockMethod} />);

    expect(screen.getByTestId('api-method-card')).toBeInTheDocument();
  });

  it('should render side-by-side layout when demo is provided', () => {
    const methodWithDemo: ApiMethod = {
      ...mockMethod,
      demo: {
        actions: [
          {
            label: 'Move first to last',
            execute: vi.fn(),
          },
        ],
      },
    };

    render(<ApiMethodCard method={methodWithDemo} />);

    const card = screen.getByTestId('api-method-card');
    expect(card).toHaveAttribute('data-has-demo', 'true');
  });
});
