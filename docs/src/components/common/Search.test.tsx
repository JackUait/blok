import { useRef, useState } from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { I18nProvider } from '../../contexts/I18nContext';
import { Search } from './Search';
import * as searchUtils from '@/utils/search';
import { ANALYTICS_EVENTS } from '@/lib/analytics';
import type { SearchResult } from '@/types/search';

type GtagWindow = Window & { gtag?: (...args: unknown[]) => void };

const gtagMock = vi.fn();

const gtagCallsFor = (eventName: string): unknown[][] =>
  gtagMock.mock.calls.filter(call => call[0] === 'event' && call[1] === eventName);

const buildResults = (count: number, idPrefix = 'r'): SearchResult[] =>
  Array.from({ length: count }, (_, i) => ({
    id: `${idPrefix}-${i}`,
    title: `Result ${i}`,
    description: 'desc',
    category: 'api',
    module: 'Core',
    kind: 'method',
    section: 'Section',
    path: '/docs',
    hash: `${idPrefix}-${i}`,
    rank: 1,
  }));

/** Renders a real trigger button alongside Search, wired via triggerRef, so
    close-then-restore-focus behavior can be exercised end-to-end. */
const SearchWithTrigger: React.FC<{ initialOpen?: boolean }> = ({ initialOpen = true }) => {
  const [open, setOpen] = useState(initialOpen);
  const triggerRef = useRef<HTMLButtonElement>(null);
  return (
    <>
      <button ref={triggerRef} type="button">
        Open search
      </button>
      <Search open={open} onClose={() => setOpen(false)} triggerRef={triggerRef} />
    </>
  );
};

vi.mock('@/utils/search', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/utils/search')>();
  return {
    ...actual,
    search: vi.fn(actual.search),
    getSearchIndex: vi.fn(actual.getSearchIndex),
  };
});

describe('Search', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    // clearAllMocks does NOT drain a pending mockReturnValueOnce queue, so an
    // unconsumed stub would leak into the next test and silently change its
    // results. Reset each mock and reinstate the real implementation so every
    // test starts from the same state regardless of ordering.
    const actual = await vi.importActual<typeof import('@/utils/search')>('@/utils/search');
    vi.mocked(searchUtils.search).mockReset().mockImplementation(actual.search);
    vi.mocked(searchUtils.getSearchIndex).mockReset().mockImplementation(actual.getSearchIndex);
    localStorage.clear();
    (window as GtagWindow).gtag = gtagMock;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
    delete (window as GtagWindow).gtag;
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

  it('should render as an inline panel (no modal backdrop)', () => {
    render(
      <I18nProvider>
        <MemoryRouter>
          <Search open={true} onClose={vi.fn()} />
        </MemoryRouter>
      </I18nProvider>
    );

    expect(screen.queryByTestId('search-backdrop')).not.toBeInTheDocument();
    expect(screen.getByTestId('search-dialog')).toBeInTheDocument();
  });

  it('should close when pointer goes down outside the panel', async () => {
    const onClose = vi.fn();
    render(
      <I18nProvider>
        <MemoryRouter>
          <Search open={true} onClose={onClose} />
        </MemoryRouter>
      </I18nProvider>
    );

    // Pointer down outside the inline panel closes it
    fireEvent.mouseDown(document.body);

    // Wait for close animation to complete (CLOSE_ANIMATION_MS = 420ms)
    await new Promise(resolve => setTimeout(resolve, 480));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('should not call onClose when pointer goes down inside the panel', () => {
    const onClose = vi.fn();
    render(
      <I18nProvider>
        <MemoryRouter>
          <Search open={true} onClose={onClose} />
        </MemoryRouter>
      </I18nProvider>
    );

    const input = screen.getByPlaceholderText('Search docs...');
    fireEvent.mouseDown(input);

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

    // Wait for close animation to complete (CLOSE_ANIMATION_MS = 420ms)
    await new Promise(resolve => setTimeout(resolve, 480));
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

  describe('accessibility', () => {
    it('renders the panel as an accessible modal dialog when open', () => {
      render(
        <I18nProvider>
          <MemoryRouter>
            <Search open={true} onClose={vi.fn()} />
          </MemoryRouter>
        </I18nProvider>
      );

      const dialog = screen.getByTestId('search-dialog');
      expect(dialog).toHaveAttribute('role', 'dialog');
      expect(dialog).toHaveAttribute('aria-modal', 'true');
    });

    it('renders a visible focus ring on the search input', () => {
      render(
        <I18nProvider>
          <MemoryRouter>
            <Search open={true} onClose={vi.fn()} />
          </MemoryRouter>
        </I18nProvider>
      );

      const input = screen.getByPlaceholderText('Search docs...');
      expect(input.className).toMatch(/focus-visible:ring-ring/);
    });

    it('marks sibling content inert while open', () => {
      render(
        <I18nProvider>
          <MemoryRouter>
            <div>
              <div data-blok-testid="page-sibling">sidebar content</div>
              <div className="relative">
                <Search open={true} onClose={vi.fn()} />
              </div>
            </div>
          </MemoryRouter>
        </I18nProvider>
      );

      expect(screen.getByTestId('page-sibling')).toHaveAttribute('inert');
    });

    it('removes inert from sibling content once closed', () => {
      const { rerender } = render(
        <I18nProvider>
          <MemoryRouter>
            <div>
              <div data-blok-testid="page-sibling">sidebar content</div>
              <div className="relative">
                <Search open={true} onClose={vi.fn()} />
              </div>
            </div>
          </MemoryRouter>
        </I18nProvider>
      );

      expect(screen.getByTestId('page-sibling')).toHaveAttribute('inert');

      rerender(
        <I18nProvider>
          <MemoryRouter>
            <div>
              <div data-blok-testid="page-sibling">sidebar content</div>
              <div className="relative">
                <Search open={false} onClose={vi.fn()} />
              </div>
            </div>
          </MemoryRouter>
        </I18nProvider>
      );

      expect(screen.getByTestId('page-sibling')).not.toHaveAttribute('inert');
    });

    it('traps Tab focus within the panel while open', async () => {
      vi.mocked(searchUtils.search).mockReturnValue(buildResults(2));

      render(
        <I18nProvider>
          <MemoryRouter>
            <Search open={true} onClose={vi.fn()} />
          </MemoryRouter>
        </I18nProvider>
      );

      const input = screen.getByPlaceholderText('Search docs...');
      fireEvent.change(input, { target: { value: 'result' } });

      const resultLinks = await waitFor(() => {
        const links = screen.getAllByRole('link', { name: /Result \d/ });
        expect(links.length).toBeGreaterThan(0);
        return links;
      });

      const lastResult = resultLinks[resultLinks.length - 1];
      lastResult.focus();
      expect(lastResult).toHaveFocus();

      fireEvent.keyDown(window, { key: 'Tab' });

      expect(input).toHaveFocus();
    });

    it('returns focus to the trigger element after closing', async () => {
      render(
        <I18nProvider>
          <MemoryRouter>
            <SearchWithTrigger />
          </MemoryRouter>
        </I18nProvider>
      );

      fireEvent.keyDown(window, { key: 'Escape' });

      await waitFor(
        () => {
          expect(screen.getByRole('button', { name: 'Open search' })).toHaveFocus();
        },
        { timeout: 1500 }
      );
    });

    it('returns focus to the trigger element after selecting a result', async () => {
      vi.mocked(searchUtils.search).mockReturnValue(buildResults(1));

      render(
        <I18nProvider>
          <MemoryRouter>
            <SearchWithTrigger />
          </MemoryRouter>
        </I18nProvider>
      );

      const input = screen.getByPlaceholderText('Search docs...');
      fireEvent.change(input, { target: { value: 'result' } });

      const resultLink = await waitFor(() => screen.getByRole('link', { name: /Result 0/ }));
      fireEvent.click(resultLink);

      await waitFor(
        () => {
          expect(screen.getByRole('button', { name: 'Open search' })).toHaveFocus();
        },
        { timeout: 1500 }
      );
    });
  });

  describe('result count pluralization', () => {
    it('should show singular "result" when there is exactly 1 result', async () => {
      const singleResult: SearchResult = {
        id: 'test-single',
        title: 'Single Result',
        description: 'Only one',
        category: 'api',
        module: 'Core',
        kind: 'method',
        section: 'Blok Class',
        path: '/docs',
        hash: 'test-single',
        rank: 1,
      };
      vi.mocked(searchUtils.search).mockReturnValue([singleResult]);

      render(
        <I18nProvider>
          <MemoryRouter>
            <Search open={true} onClose={vi.fn()} />
          </MemoryRouter>
        </I18nProvider>
      );

      const input = screen.getByPlaceholderText('Search docs...');
      fireEvent.change(input, { target: { value: 'single' } });

      await waitFor(() => {
        const countEl = screen.getByTestId('search-results-count');
        expect(countEl.textContent).toBe('1 result');
      });
    });

    it('should show plural "results" when there are multiple results', async () => {
      render(
        <I18nProvider>
          <MemoryRouter>
            <Search open={true} onClose={vi.fn()} />
          </MemoryRouter>
        </I18nProvider>
      );

      const input = screen.getByPlaceholderText('Search docs...');

      // Search for a broad term that should return multiple results
      fireEvent.change(input, { target: { value: 'blocks' } });

      await waitFor(() => {
        const countEl = screen.getByTestId('search-results-count');
        const text = countEl.textContent ?? '';
        const count = parseInt(text, 10);
        expect(count).toBeGreaterThan(1);
        expect(text).toMatch(/results$/);
      });
    });

    describe('Russian plural forms', () => {
      it.each([
        [1, 'результат'],
        [2, 'результата'],
        [5, 'результатов'],
      ])('shows "%i %s" for the matching count', async (count, expectedWord) => {
        vi.mocked(searchUtils.search).mockReturnValue(buildResults(count));

        render(
          <I18nProvider locale="ru">
            <MemoryRouter>
              <Search open={true} onClose={vi.fn()} />
            </MemoryRouter>
          </I18nProvider>
        );

        const input = screen.getByPlaceholderText('Поиск по документации...');
        fireEvent.change(input, { target: { value: 'результат' } });

        await waitFor(() => {
          const countEl = screen.getByTestId('search-results-count');
          expect(countEl.textContent).toBe(`${count} ${expectedWord}`);
        });
      });
    });
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

  describe('locale switching', () => {
    it('shows Russian placeholder when locale is ru', () => {
      render(
        <I18nProvider locale="ru">
          <MemoryRouter>
            <Search open={true} onClose={vi.fn()} />
          </MemoryRouter>
        </I18nProvider>
      );

      expect(screen.getByPlaceholderText('Поиск по документации...')).toBeInTheDocument();
    });
  });

  describe('analytics', () => {
    const renderSearch = (open = true) =>
      render(
        <I18nProvider>
          <MemoryRouter>
            <Search open={open} onClose={vi.fn()} />
          </MemoryRouter>
        </I18nProvider>
      );

    it('tracks search_open exactly once when the dialog opens', () => {
      const { rerender } = renderSearch();

      expect(gtagCallsFor(ANALYTICS_EVENTS.searchOpen)).toHaveLength(1);

      // A re-render with the same `open` value must not re-fire the event.
      rerender(
        <I18nProvider>
          <MemoryRouter>
            <Search open={true} onClose={vi.fn()} />
          </MemoryRouter>
        </I18nProvider>
      );

      expect(gtagCallsFor(ANALYTICS_EVENTS.searchOpen)).toHaveLength(1);
    });

    it('does not track search_open while the dialog is closed', () => {
      renderSearch(false);

      expect(gtagCallsFor(ANALYTICS_EVENTS.searchOpen)).toHaveLength(0);
    });

    it('tracks search_query once for the settled query, not per keystroke', async () => {
      vi.mocked(searchUtils.search).mockReturnValue(buildResults(3));

      renderSearch();

      const input = screen.getByPlaceholderText('Search docs...');
      fireEvent.change(input, { target: { value: 'Re' } });
      fireEvent.change(input, { target: { value: 'Res' } });
      fireEvent.change(input, { target: { value: 'Result' } });

      await waitFor(
        () => {
          expect(gtagCallsFor(ANALYTICS_EVENTS.searchQuery)).toHaveLength(1);
        },
        { timeout: 3000 }
      );

      expect(gtagMock).toHaveBeenCalledWith('event', ANALYTICS_EVENTS.searchQuery, {
        query: 'result',
        results_count: 3,
      });
    });

    it('tracks search_no_results when a settled query yields nothing', async () => {
      vi.mocked(searchUtils.search).mockReturnValue([]);

      renderSearch();

      fireEvent.change(screen.getByPlaceholderText('Search docs...'), {
        target: { value: 'zzzznothing' },
      });

      await waitFor(
        () => {
          expect(gtagMock).toHaveBeenCalledWith(
            'event',
            ANALYTICS_EVENTS.searchNoResults,
            { query: 'zzzznothing' }
          );
        },
        { timeout: 3000 }
      );

      expect(gtagMock).toHaveBeenCalledWith('event', ANALYTICS_EVENTS.searchQuery, {
        query: 'zzzznothing',
        results_count: 0,
      });
    });

    it('tracks search_result_select when a result is clicked', async () => {
      vi.mocked(searchUtils.search).mockReturnValue(buildResults(2));

      renderSearch();

      fireEvent.change(screen.getByPlaceholderText('Search docs...'), {
        target: { value: 'Result' },
      });

      const link = await screen.findByRole(
        'link',
        { name: /Result 1/ },
        { timeout: 3000 }
      );
      fireEvent.click(link);

      expect(gtagMock).toHaveBeenCalledWith(
        'event',
        ANALYTICS_EVENTS.searchResultSelect,
        {
          query: 'result',
          result_title: 'Result 1',
          result_path: '/docs',
          result_module: 'Core',
          result_index: 1,
        }
      );
    });

    it('tracks search_result_select when a result is chosen with Enter', async () => {
      vi.mocked(searchUtils.search).mockReturnValue(buildResults(2));

      renderSearch();

      const input = screen.getByPlaceholderText('Search docs...');
      fireEvent.change(input, { target: { value: 'Result' } });

      await screen.findByRole('link', { name: /Result 0/ }, { timeout: 3000 });
      fireEvent.keyDown(input, { key: 'Enter' });

      expect(gtagMock).toHaveBeenCalledWith(
        'event',
        ANALYTICS_EVENTS.searchResultSelect,
        {
          query: 'result',
          result_title: 'Result 0',
          result_path: '/docs',
          result_module: 'Core',
          result_index: 0,
        }
      );
    });
  });
  describe('crawlable results', () => {
    const renderSearch = () =>
      render(
        <I18nProvider>
          <MemoryRouter>
            <Search open onClose={vi.fn()} />
          </MemoryRouter>
        </I18nProvider>
      );

    it('renders each result as a real anchor carrying its destination', async () => {
      vi.mocked(searchUtils.search).mockReturnValue(buildResults(2));

      renderSearch();
      fireEvent.change(screen.getByPlaceholderText('Search docs...'), {
        target: { value: 'Result' },
      });

      const link = await screen.findByRole('link', { name: /Result 1/ }, { timeout: 3000 });
      expect(link).toHaveAttribute('href', '/docs#r-1');
    });

    it('omits the hash from the href when a result has none', async () => {
      vi.mocked(searchUtils.search).mockReturnValue([
        { ...buildResults(1)[0], hash: undefined },
      ]);

      renderSearch();
      fireEvent.change(screen.getByPlaceholderText('Search docs...'), {
        target: { value: 'Result' },
      });

      const link = await screen.findByRole('link', { name: /Result 0/ }, { timeout: 3000 });
      expect(link).toHaveAttribute('href', '/docs');
    });
  });
});
