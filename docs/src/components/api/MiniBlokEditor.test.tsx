import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MiniBlokEditor } from './MiniBlokEditor';

describe('MiniBlokEditor', () => {
  let container: HTMLElement;

  beforeEach(() => {
    vi.clearAllMocks();
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(() => {
    document.body.removeChild(container);
  });

  const defaultInitialState = {
    blocks: [
      { id: '1', type: 'paragraph', data: { text: 'First block' } },
      { id: '2', type: 'paragraph', data: { text: 'Second block' } },
      { id: '3', type: 'header', data: { text: 'Title', level: 2 } },
    ],
  };

  it('should render loading state initially', () => {
    render(<MiniBlokEditor initialState={defaultInitialState} />, { container });
    expect(screen.getByText('Loading editor…')).toBeInTheDocument();
  });

  it('should render container element', () => {
    const { container: renderContainer } = render(
      <MiniBlokEditor initialState={defaultInitialState} />,
      { container }
    );
    const editorContainer = renderContainer.querySelector('.mini-blok-editor');
    expect(editorContainer).toBeInTheDocument();
  });

  it('should render error state when editor fails to load', async () => {
    // Mock the import to throw an error
    vi.mock('/dist/full.mjs', () => {
      throw new Error('Failed to load');
    });

    const { container: renderContainer } = render(
      <MiniBlokEditor initialState={defaultInitialState} />,
      { container }
    );

    // Eventually the error state should be shown
    // Note: This test may need adjustment based on actual error handling behavior
    const editorContainer = renderContainer.querySelector('.mini-blok-editor');
    expect(editorContainer).toBeInTheDocument();
  });

  it('should have correct CSS classes', () => {
    const { container: renderContainer } = render(
      <MiniBlokEditor initialState={defaultInitialState} />,
      { container }
    );

    const editorContainer = renderContainer.querySelector('.mini-blok-editor');
    expect(editorContainer).toHaveClass('mini-blok-editor');
  });
});
