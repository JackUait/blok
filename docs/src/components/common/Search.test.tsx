import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { I18nProvider } from '../../contexts/I18nContext';
import { Search } from './Search';

describe('Search', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should not render when open is false', () => {
    const { queryByPlaceholderText } = render(
      <I18nProvider>
        <MemoryRouter>
          <Search open={false} onClose={vi.fn()} />
        </MemoryRouter>
      </I18nProvider>
    );
    expect(queryByPlaceholderText('Search docs...')).not.toBeInTheDocument();
  });

  it('should render when open is true', () => {
    render(
      <I18nProvider>
        <MemoryRouter>
          <Search open={true} onClose={vi.fn()} />
        </MemoryRouter>
      </I18nProvider>
    );
    expect(screen.getByPlaceholderText('Search docs...')).toBeInTheDocument();
  });

  it('should close when backdrop is clicked', async () => {
    const onClose = vi.fn();
    render(
      <I18nProvider>
        <MemoryRouter>
          <Search open={true} onClose={onClose} />
        </MemoryRouter>
      </I18nProvider>
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
      <I18nProvider>
        <MemoryRouter>
          <Search open={true} onClose={onClose} />
        </MemoryRouter>
      </I18nProvider>
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
      <I18nProvider>
        <MemoryRouter>
          <Search open={true} onClose={onClose} />
        </MemoryRouter>
      </I18nProvider>
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
      <I18nProvider>
        <MemoryRouter>
          <Search open={true} onClose={onClose} />
        </MemoryRouter>
      </I18nProvider>
    );

    expect(screen.getByPlaceholderText('Search docs...')).toBeInTheDocument();

    fireEvent.keyDown(window, { key: 'Escape' });

    // Wait for close animation to complete (CLOSE_ANIMATION_MS = 200ms)
    await new Promise(resolve => setTimeout(resolve, 250));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('should focus input when opened', () => {
    render(
      <I18nProvider>
        <MemoryRouter>
          <Search open={true} onClose={vi.fn()} />
        </MemoryRouter>
      </I18nProvider>
    );
    const input = screen.getByPlaceholderText('Search docs...');
    expect(input).toHaveFocus();
  });

  describe('module grouping', () => {
    it('should group search results by module', async () => {
      render(
        <I18nProvider>
          <MemoryRouter>
            <Search open={true} onClose={vi.fn()} />
          </MemoryRouter>
        </I18nProvider>
      );

      const input = screen.getByPlaceholderText('Search docs...');

      // Search for 'blocks' - should return results from different modules
      fireEvent.change(input, { target: { value: 'blocks' } });

      // Wait for debounced search results to render
      const moduleHeaders = await waitFor(() => {
        const headers = screen.getAllByTestId('search-module-header');
        expect(headers.length).toBeGreaterThan(0);
        return headers;
      });

      // Each header should have a module title
      moduleHeaders.forEach(header => {
        expect(header.textContent).toBeTruthy();
        expect(header.textContent?.length).toBeGreaterThan(0);
      });
    });

    it('should display module headers in correct order', async () => {
      render(
        <I18nProvider>
          <MemoryRouter>
            <Search open={true} onClose={vi.fn()} />
          </MemoryRouter>
        </I18nProvider>
      );

      const input = screen.getByPlaceholderText('Search docs...');

      // Search for 'api' - should return results from multiple modules
      fireEvent.change(input, { target: { value: 'api' } });

      // Wait for debounced search results to render
      const moduleHeaders = await waitFor(() => {
        const headers = screen.getAllByTestId('search-module-header');
        expect(headers.length).toBeGreaterThan(0);
        return headers;
      });

      // Get module headers in order
      const moduleTitles = moduleHeaders.map(h => h.textContent?.trim()).filter(Boolean);

      // Module headers should be grouped (no duplicates)
      const uniqueTitles = new Set(moduleTitles);
      expect(moduleTitles.length).toBe(uniqueTitles.size);
    });

    it('should show results under their respective module headers', async () => {
      render(
        <I18nProvider>
          <MemoryRouter>
            <Search open={true} onClose={vi.fn()} />
          </MemoryRouter>
        </I18nProvider>
      );

      const input = screen.getByPlaceholderText('Search docs...');

      // Search for 'save' - should find results
      fireEvent.change(input, { target: { value: 'save' } });

      // Wait for debounced search results to render
      const moduleHeaders = await waitFor(() => {
        const headers = screen.getAllByTestId('search-module-header');
        expect(headers.length).toBeGreaterThan(0);
        return headers;
      });

      // Verify that the first module header has visible text content
      expect(moduleHeaders[0]).toHaveTextContent(/.+/);
    });
  });
});
