import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { Search } from './Search';

describe('Search', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should not render when open is false', () => {
    const { queryByPlaceholderText } = render(
      <MemoryRouter>
        <Search open={false} onClose={vi.fn()} />
      </MemoryRouter>
    );
    expect(queryByPlaceholderText('Search documentation...')).not.toBeInTheDocument();
  });

  it('should render when open is true', () => {
    render(
      <MemoryRouter>
        <Search open={true} onClose={vi.fn()} />
      </MemoryRouter>
    );
    expect(screen.getByPlaceholderText('Search documentation...')).toBeInTheDocument();
  });

  it('should close when backdrop is clicked', () => {
    const onClose = vi.fn();
    const { rerender } = render(
      <MemoryRouter>
        <Search open={true} onClose={onClose} />
      </MemoryRouter>
    );

    const backdrop = screen.getByTestId('search-backdrop');
    expect(backdrop).toBeInTheDocument();

    fireEvent.click(backdrop);

    // Verify behavior - after onClose is called, parent should close the search
    rerender(
      <MemoryRouter>
        <Search open={false} onClose={onClose} />
      </MemoryRouter>
    );
    expect(screen.queryByPlaceholderText('Search documentation...')).not.toBeInTheDocument();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('should close when clicking outside the dialog (on container)', () => {
    const onClose = vi.fn();
    const { rerender } = render(
      <MemoryRouter>
        <Search open={true} onClose={onClose} />
      </MemoryRouter>
    );

    const container = screen.getByTestId('search-container');
    expect(container).toBeInTheDocument();

    // Click on the container (outside the dialog)
    fireEvent.click(container);

    // Verify behavior - search is closed after clicking container
    rerender(
      <MemoryRouter>
        <Search open={false} onClose={onClose} />
      </MemoryRouter>
    );
    expect(screen.queryByPlaceholderText('Search documentation...')).not.toBeInTheDocument();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('should not call onClose when clicking inside the dialog', () => {
    const onClose = vi.fn();
    render(
      <MemoryRouter>
        <Search open={true} onClose={onClose} />
      </MemoryRouter>
    );

    const input = screen.getByPlaceholderText('Search documentation...');
    fireEvent.click(input);

    expect(onClose).not.toHaveBeenCalled();
    // Verify the search is still open
    expect(screen.getByPlaceholderText('Search documentation...')).toBeInTheDocument();
  });

  it('should close when Escape key is pressed', () => {
    const onClose = vi.fn();
    const { rerender } = render(
      <MemoryRouter>
        <Search open={true} onClose={onClose} />
      </MemoryRouter>
    );

    expect(screen.getByPlaceholderText('Search documentation...')).toBeInTheDocument();

    fireEvent.keyDown(window, { key: 'Escape' });

    // Verify behavior - search is closed after Escape
    rerender(
      <MemoryRouter>
        <Search open={false} onClose={onClose} />
      </MemoryRouter>
    );
    expect(screen.queryByPlaceholderText('Search documentation...')).not.toBeInTheDocument();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('should focus input when opened', () => {
    render(
      <MemoryRouter>
        <Search open={true} onClose={vi.fn()} />
      </MemoryRouter>
    );
    const input = screen.getByPlaceholderText('Search documentation...');
    expect(input).toHaveFocus();
  });
});
