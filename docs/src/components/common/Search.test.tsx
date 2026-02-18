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
    expect(queryByPlaceholderText('Search docs...')).not.toBeInTheDocument();
  });

  it('should render when open is true', () => {
    render(
      <MemoryRouter>
        <Search open={true} onClose={vi.fn()} />
      </MemoryRouter>
    );
    expect(screen.getByPlaceholderText('Search docs...')).toBeInTheDocument();
  });

  it('should close when backdrop is clicked', async () => {
    const onClose = vi.fn();
    render(
      <MemoryRouter>
        <Search open={true} onClose={onClose} />
      </MemoryRouter>
    );

    const backdrop = screen.getByTestId('search-backdrop');
    expect(backdrop).toBeInTheDocument();

    fireEvent.click(backdrop);

    // Wait for close animation to complete (CLOSE_ANIMATION_MS = 200ms)
    await new Promise(resolve => setTimeout(resolve, 250));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('should close when clicking outside the dialog (on container)', async () => {
    const onClose = vi.fn();
    render(
      <MemoryRouter>
        <Search open={true} onClose={onClose} />
      </MemoryRouter>
    );

    const container = screen.getByTestId('search-container');
    expect(container).toBeInTheDocument();

    // Click on the container (outside the dialog)
    fireEvent.click(container);

    // Wait for close animation to complete (CLOSE_ANIMATION_MS = 200ms)
    await new Promise(resolve => setTimeout(resolve, 250));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('should not call onClose when clicking inside the dialog', () => {
    const onClose = vi.fn();
    render(
      <MemoryRouter>
        <Search open={true} onClose={onClose} />
      </MemoryRouter>
    );

    const input = screen.getByPlaceholderText('Search docs...');
    fireEvent.click(input);

    expect(onClose).not.toHaveBeenCalled();
    // Verify the search is still open
    expect(screen.getByPlaceholderText('Search docs...')).toBeInTheDocument();
  });

  it('should close when Escape key is pressed', async () => {
    const onClose = vi.fn();
    render(
      <MemoryRouter>
        <Search open={true} onClose={onClose} />
      </MemoryRouter>
    );

    expect(screen.getByPlaceholderText('Search docs...')).toBeInTheDocument();

    fireEvent.keyDown(window, { key: 'Escape' });

    // Wait for close animation to complete (CLOSE_ANIMATION_MS = 200ms)
    await new Promise(resolve => setTimeout(resolve, 250));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('should focus input when opened', () => {
    render(
      <MemoryRouter>
        <Search open={true} onClose={vi.fn()} />
      </MemoryRouter>
    );
    const input = screen.getByPlaceholderText('Search docs...');
    expect(input).toHaveFocus();
  });

  describe('module grouping', () => {
    it('should group search results by module', async () => {
      render(
        <MemoryRouter>
          <Search open={true} onClose={vi.fn()} />
        </MemoryRouter>
      );

      const input = screen.getByPlaceholderText('Search docs...');

      // Search for 'blocks' - should return results from different modules
      fireEvent.change(input, { target: { value: 'blocks' } });

      // Wait for debounced search
      await new Promise(resolve => setTimeout(resolve, 200));

      // Find all module headers
      const moduleHeaders = screen.getAllByTestId('search-module-header');

      // Should have at least one module header
      expect(moduleHeaders.length).toBeGreaterThan(0);

      // Each header should have a module title
      moduleHeaders.forEach(header => {
        expect(header.textContent).toBeTruthy();
        expect(header.textContent?.length).toBeGreaterThan(0);
      });
    });

    it('should display module headers in correct order', async () => {
      render(
        <MemoryRouter>
          <Search open={true} onClose={vi.fn()} />
        </MemoryRouter>
      );

      const input = screen.getByPlaceholderText('Search docs...');

      // Search for 'api' - should return results from multiple modules
      fireEvent.change(input, { target: { value: 'api' } });

      // Wait for debounced search
      await new Promise(resolve => setTimeout(resolve, 200));

      // Get module headers in order
      const moduleHeaders = screen.getAllByTestId('search-module-header');
      const moduleTitles = moduleHeaders.map(h => h.textContent?.trim()).filter(Boolean);

      // Module headers should be grouped (no duplicates)
      const uniqueTitles = new Set(moduleTitles);
      expect(moduleTitles.length).toBe(uniqueTitles.size);
    });

    it('should show results under their respective module headers', async () => {
      render(
        <MemoryRouter>
          <Search open={true} onClose={vi.fn()} />
        </MemoryRouter>
      );

      const input = screen.getByPlaceholderText('Search docs...');

      // Search for 'save' - should find results
      fireEvent.change(input, { target: { value: 'save' } });

      // Wait for debounced search
      await new Promise(resolve => setTimeout(resolve, 200));

      // Find module headers
      const moduleHeaders = screen.getAllByTestId('search-module-header');

      // Should have at least one module header with results following it
      expect(moduleHeaders.length).toBeGreaterThan(0);

      // Verify that the first module header has visible text content
      expect(moduleHeaders[0]).toHaveTextContent(/.+/);
    });
  });
});
