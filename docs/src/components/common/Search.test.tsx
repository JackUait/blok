import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { Search } from './Search';

describe('Search', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should not render when open is false', () => {
    const { container } = render(
      <MemoryRouter>
        <Search open={false} onClose={vi.fn()} />
      </MemoryRouter>
    );
    expect(container.querySelector('.search-backdrop')).not.toBeInTheDocument();
  });

  it('should render when open is true', () => {
    render(
      <MemoryRouter>
        <Search open={true} onClose={vi.fn()} />
      </MemoryRouter>
    );
    expect(screen.getByPlaceholderText('Search documentation...')).toBeInTheDocument();
  });

  it('should call onClose when backdrop is clicked', () => {
    const onClose = vi.fn();
    const { container } = render(
      <MemoryRouter>
        <Search open={true} onClose={onClose} />
      </MemoryRouter>
    );

    const backdrop = container.querySelector('[data-search-backdrop]') as HTMLElement;
    fireEvent.click(backdrop);

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('should call onClose when clicking outside the dialog (on container)', () => {
    const onClose = vi.fn();
    const { container } = render(
      <MemoryRouter>
        <Search open={true} onClose={onClose} />
      </MemoryRouter>
    );

    const searchContainer = container.querySelector('[data-search-container]') as HTMLElement;
    expect(searchContainer).toBeInTheDocument();

    // Click on the container (outside the dialog)
    fireEvent.click(searchContainer);

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
  });

  it('should call onClose when Escape key is pressed', () => {
    const onClose = vi.fn();
    render(
      <MemoryRouter>
        <Search open={true} onClose={onClose} />
      </MemoryRouter>
    );

    fireEvent.keyDown(window, { key: 'Escape' });

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('should focus input when opened', () => {
    render(
      <MemoryRouter>
        <Search open={true} onClose={vi.fn()} />
      </MemoryRouter>
    );
    const input = screen.getByPlaceholderText('Search documentation...');
    expect(document.activeElement).toBe(input);
  });
});
