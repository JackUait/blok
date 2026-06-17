import { useState, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { search, getSearchIndex } from '@/utils/search';
import type { SearchResult } from '@/types/search';
import { ModuleIcon } from './ModuleIcon';
import { KeyIcon, ShortcutKeys } from './KeyIcon';
import { useI18n } from '../../contexts/I18nContext';
import { cn } from '@/lib/utils';

interface SearchProps {
  open: boolean;
  onClose: () => void;
}

const SEARCH_SHORTCUT = 'k';
const SEARCH_DEBOUNCE_MS = 150;

// Highlight matching text in search results
// Matches the query term OR words that share a common prefix with it
const highlightMatch = (text: string, query: string): React.ReactNode => {
  const trimmedQuery = query.trim().toLowerCase();
  if (!trimmedQuery) return text;
  
  // Split query into words for multi-word matching
  const queryWords = trimmedQuery.split(/\s+/).filter(w => w.length >= 2);
  if (queryWords.length === 0) return text;
  
  // Build a regex that matches:
  // 1. The exact query words
  // 2. Words that start with query words (prefix match)
  // 3. Words that the query words start with (reverse prefix - query "blocks" highlights "block")
  const patterns: string[] = [];
  for (const qw of queryWords) {
    // Escape special regex characters
    const escaped = qw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    // Match word boundaries: query word followed by optional word chars (prefix match)
    patterns.push(`\\b${escaped}\\w*`);
    // Also match if query is longer: e.g., query "blocks" should highlight "block"
    if (qw.length >= 4) {
      // Try progressively shorter prefixes (minimum 3 chars)
      const prefixPatterns = Array.from(
        { length: qw.length - 3 },
        (_, i) => {
          const prefix = qw.slice(0, qw.length - 1 - i).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          return `\\b${prefix}\\b`;
        }
      );
      patterns.push(...prefixPatterns);
    }
  }
  
  const pattern = `(${patterns.join('|')})`;
  const splitRegex = new RegExp(pattern, 'gi');
  const parts = text.split(splitRegex);
  
  // Use a fresh regex for testing each part (avoid global state issues)
  const testRegex = new RegExp(pattern, 'i');
  
  return parts.map((part, index) => 
    testRegex.test(part) ? (
      <mark key={index} className="rounded bg-primary/15 px-0.5 font-semibold text-primary">{part}</mark>
    ) : (
      part
    )
  );
};

/** Group search results by module, preserving a predefined module order. */
const groupResultsByModule = (searchResults: SearchResult[]): SearchResult[] => {
  const moduleOrder = ['Guide', 'Core', 'API Modules', 'Data', 'Page'];
  const groupedByModule = new Map<string, SearchResult[]>();

  for (const result of searchResults) {
    const existing = groupedByModule.get(result.module);

    if (existing) {
      existing.push(result);
    } else {
      groupedByModule.set(result.module, [result]);
    }
  }

  const orderedResults: SearchResult[] = [];

  for (const module of moduleOrder) {
    const moduleResults = groupedByModule.get(module);

    if (!moduleResults) continue;

    orderedResults.push(...moduleResults);
  }

  for (const [module, moduleResults] of groupedByModule) {
    if (moduleOrder.includes(module)) continue;

    orderedResults.push(...moduleResults);
  }

  return orderedResults;
};

const CLOSE_ANIMATION_MS = 200;

export const Search: React.FC<SearchProps> = ({ open, onClose }) => {
  const navigate = useNavigate();
  const { t } = useI18n();
  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [isClosing, setIsClosing] = useState(false);
  const [isKeyboardNavMode, setIsKeyboardNavMode] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const resultsRef = useRef<HTMLDivElement>(null);
  const keyboardNavTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Focus input when opened
  useEffect(() => {
    if (open && inputRef.current) {
      inputRef.current.focus();
    }
  }, [open]);

  // Reset state when closed
  useEffect(() => {
    if (open) return;

    setQuery('');
    setDebouncedQuery('');
    setResults([]);
    setSelectedIndex(0);
    setIsClosing(false);
    setIsKeyboardNavMode(false);

    if (!keyboardNavTimerRef.current) return;

    clearTimeout(keyboardNavTimerRef.current);
    keyboardNavTimerRef.current = null;
  }, [open]);

  // Cleanup keyboard nav timer on unmount
  useEffect(() => {
    return () => {
      if (keyboardNavTimerRef.current) {
        clearTimeout(keyboardNavTimerRef.current);
      }
    };
  }, []);

  // Animated close handler
  const handleClose = useCallback(() => {
    if (isClosing) return;
    setIsClosing(true);
    setTimeout(() => {
      onClose();
    }, CLOSE_ANIMATION_MS);
  }, [isClosing, onClose]);

  // Disable body scroll when modal is open
  // Set overflow on <html> not <body> — the portal renders fixed children directly
  // inside <body>, and overflow:hidden on body clips its fixed children in some browsers.
  useEffect(() => {
    if (open) {
      const originalOverflow = document.documentElement.style.overflow;
      document.documentElement.style.overflow = 'hidden';
      return () => {
        document.documentElement.style.overflow = originalOverflow;
      };
    }
  }, [open]);

  // Handle global keyboard shortcut
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const isEscapeKey = e.key === 'Escape';
      const isEscapeWithOpen = isEscapeKey && open;
      const isShortcutKey = (e.metaKey || e.ctrlKey) && e.key === SEARCH_SHORTCUT;

      // Handle Escape key separately
      if (isEscapeWithOpen) {
        handleClose();
        return;
      }

      // Cmd/Ctrl + K to open search
      if (!isShortcutKey) {
        return;
      }

      e.preventDefault();
      if (open) {
        handleClose();
      }
      // If not open, we need to trigger opening through the parent component
      // This is handled by the Nav component
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [open, handleClose]);

  // Debounce the search query
  useEffect(() => {
    if (!query.trim()) {
      setDebouncedQuery('');
      return;
    }

    const timer = setTimeout(() => {
      setDebouncedQuery(query);
    }, SEARCH_DEBOUNCE_MS);

    return () => clearTimeout(timer);
  }, [query]);

  // Search functionality with debounced query
  useEffect(() => {
    if (!debouncedQuery.trim()) {
      setResults([]);
      return;
    }

    const searchResults = search(debouncedQuery, getSearchIndex());
    const orderedResults = groupResultsByModule(searchResults);

    setResults(orderedResults);
    setSelectedIndex(0);
  }, [debouncedQuery]);

  // Handle result click
  const handleResultClick = useCallback((result: SearchResult) => {
    const url = result.hash ? `${result.path}#${result.hash}` : result.path;
    navigate(url);
    handleClose();
  }, [navigate, handleClose]);

  // Handle keyboard navigation within results
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (results.length === 0) return;

      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault();
          setIsKeyboardNavMode(true);
          setSelectedIndex((i) => Math.min(i + 1, results.length - 1));
          // Clear any existing timer and set a new one
          if (keyboardNavTimerRef.current) {
            clearTimeout(keyboardNavTimerRef.current);
          }
          keyboardNavTimerRef.current = setTimeout(() => {
            setIsKeyboardNavMode(false);
          }, 500);
          break;
        case 'ArrowUp':
          e.preventDefault();
          setIsKeyboardNavMode(true);
          setSelectedIndex((i) => Math.max(i - 1, 0));
          // Clear any existing timer and set a new one
          if (keyboardNavTimerRef.current) {
            clearTimeout(keyboardNavTimerRef.current);
          }
          keyboardNavTimerRef.current = setTimeout(() => {
            setIsKeyboardNavMode(false);
          }, 500);
          break;
        case 'Enter':
          e.preventDefault();
          if (results[selectedIndex]) {
            handleResultClick(results[selectedIndex]);
          }
          break;
      }
    },
    [results, selectedIndex, handleResultClick]
  );

  // Scroll a buffer element into view within the results container
  const scrollBufferElement = useCallback((
    bufferElement: Element | undefined,
    container: HTMLElement,
    containerRect: DOMRect,
    edge: 'top' | 'bottom'
  ) => {
    if (!bufferElement) return;

    const bufferRect = bufferElement.getBoundingClientRect();

    const scrollOffset = edge === 'top'
      ? bufferRect.top - containerRect.top + container.scrollTop - 10
      : bufferRect.bottom - containerRect.top + container.scrollTop - container.clientHeight + 10;

    const topValue = edge === 'top' ? Math.max(0, scrollOffset) : scrollOffset;
    container.scrollTo({ top: topValue, behavior: 'auto' });
    inputRef.current?.focus();
  }, []);

  // Scroll selected result into view with buffer (only for keyboard navigation)
  const scrollSelectedIntoView = useCallback(() => {
    if (!resultsRef.current || results.length === 0) return;

    const container = resultsRef.current;
    const allResults = Array.from(
      container.querySelectorAll('[data-search-result-index]')
    );
    const selectedElement = allResults[selectedIndex] as HTMLElement | undefined;

    if (!selectedElement) return;

    const bufferSize = 1; // Show 1 item above/below when possible
    const containerRect = container.getBoundingClientRect();
    const selectedRect = selectedElement.getBoundingClientRect();

    // Position relative to container's visible area
    const elementTop = selectedRect.top - containerRect.top;
    const elementBottom = selectedRect.bottom - containerRect.top;
    const containerHeight = container.clientHeight;

    // Buffer zone: roughly 1 item worth of space (~60px for search results)
    const bufferPixels = 70;

    // Check if selected element is near top edge
    if (elementTop < bufferPixels) {
      const bufferTopIndex = Math.max(0, selectedIndex - bufferSize);
      scrollBufferElement(allResults[bufferTopIndex], container, containerRect, 'top');
      return;
    }

    // Check if selected element is near bottom edge
    if (elementBottom <= containerHeight - bufferPixels) return;

    const bufferBottomIndex = Math.min(allResults.length - 1, selectedIndex + bufferSize);
    scrollBufferElement(allResults[bufferBottomIndex], container, containerRect, 'bottom');
  }, [selectedIndex, results.length, scrollBufferElement]);

  useEffect(() => {
    scrollSelectedIntoView();
  }, [scrollSelectedIntoView]);

  if (!open) return null;

  const handleDialogClick = (e: React.MouseEvent) => {
    e.stopPropagation();
  };

  return createPortal(
    <>
      <div
        className={cn(
          'fixed inset-0 z-[100] bg-foreground/40 backdrop-blur-sm',
          isClosing ? 'animate-out fade-out duration-200' : 'animate-in fade-in duration-200'
        )}
        onClick={handleClose}
        data-blok-testid="search-backdrop"
      />
      <div
        className="fixed inset-0 z-[101] flex items-start justify-center overflow-y-auto px-4 pb-10 pt-[12vh]"
        onClick={handleClose}
        data-blok-testid="search-container"
      >
        <div
          className={cn(
            'flex max-h-[70vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-card-hover',
            isClosing
              ? 'animate-out fade-out zoom-out-95 duration-200'
              : 'animate-in fade-in zoom-in-95 duration-200'
          )}
          ref={dialogRef}
          onClick={handleDialogClick}
          data-blok-testid="search-dialog"
        >
          <div className="flex items-center gap-3 border-b border-border px-5 py-4">
            <svg
              className="size-5 shrink-0 text-muted-foreground"
              width="22"
              height="22"
              viewBox="0 0 24 24"
              fill="none"
            >
              <circle
                cx="11"
                cy="11"
                r="7"
                stroke="currentColor"
                strokeWidth="2.5"
              />
              <path
                d="M21 21l-4.35-4.35"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
              />
            </svg>
            <input
              ref={inputRef}
              type="text"
              className="min-w-0 flex-1 bg-transparent text-base text-foreground placeholder:text-muted-foreground focus:outline-none"
              placeholder={t('search.placeholder')}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={handleKeyDown}
              autoComplete="off"
            />
            {query && (
              <button
                className="flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
                onClick={() => setQuery('')}
                type="button"
                aria-label={t('search.clearSearch')}>
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 16 16"
                  fill="none"
                >
                  <path
                    d="M12 4L4 12M4 4l8 8"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                  />
                </svg>
              </button>
            )}
            <KeyIcon className="shrink-0 rounded-md border border-border bg-secondary px-2 py-1 text-muted-foreground">{t('search.escKey')}</KeyIcon>
          </div>

          <div className="flex-1 overflow-y-auto p-2" ref={resultsRef}>
            {results.length === 0 ? (
              <div className="flex flex-col items-center gap-2 px-6 py-12 text-center">
                {query.trim() ? (
                  <>
                    <div className="mb-1 flex size-12 items-center justify-center rounded-full bg-secondary text-muted-foreground">
                      <svg
                        width="32"
                        height="32"
                        viewBox="0 0 24 24"
                        fill="none"
                      >
                        <circle
                          cx="11"
                          cy="11"
                          r="7"
                          stroke="currentColor"
                          strokeWidth="2"
                        />
                        <path
                          d="M21 21l-4.35-4.35"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                        />
                        <path
                          d="M8 11h6"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                        />
                      </svg>
                    </div>
                    <p className="text-base font-semibold text-foreground">{t('search.noResultsTitle')}</p>
                    <p className="text-sm text-muted-foreground">
                      {t('search.noResultsDescription')}
                    </p>
                  </>
                ) : (
                  <>
                    <div className="mb-1 flex size-12 items-center justify-center rounded-full bg-secondary text-muted-foreground">
                      <svg
                        width="32"
                        height="32"
                        viewBox="0 0 24 24"
                        fill="none"
                      >
                        <circle
                          cx="11"
                          cy="11"
                          r="7"
                          stroke="currentColor"
                          strokeWidth="2"
                        />
                        <path
                          d="M21 21l-4.35-4.35"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                        />
                      </svg>
                    </div>
                    <p className="text-base font-semibold text-foreground">{t('search.emptyTitle')}</p>
                    <p className="text-sm text-muted-foreground">
                      {t('search.emptyDescription')}
                    </p>
                  </>
                )}
              </div>
            ) : (
              <>
                <div className="px-3 pb-1 pt-2">
                  <span className="text-xs font-medium text-muted-foreground" data-blok-testid="search-results-count">
                    {results.length} {results.length === 1 ? t('search.result') : t('search.results')}
                  </span>
                </div>
                {results.map((result, index) => {
                  const showModuleHeader = index === 0 || result.module !== results[index - 1].module;

                  return (
                    <div key={result.id}>
                      {showModuleHeader && (
                        <div className="flex items-center gap-2 px-3 pb-1 pt-3 text-xs font-bold uppercase tracking-wide text-muted-foreground" data-blok-testid="search-module-header">
                          <ModuleIcon module={result.module} />
                          <span>
                            {result.module}
                          </span>
                        </div>
                      )}
                      <button
                        className={cn(
                          'flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-colors hover:bg-secondary',
                          index === selectedIndex && 'bg-secondary'
                        )}
                        onClick={() => handleResultClick(result)}
                        type="button"
                        onMouseEnter={() => {
                          if (!isKeyboardNavMode) {
                            setSelectedIndex(index);
                          }
                        }}
                        data-search-result-index={index}
                        data-keyboard-nav={isKeyboardNavMode}
                      >
                        <span className="flex size-6 shrink-0 items-center justify-center rounded-md bg-secondary text-xs font-medium text-muted-foreground">{index + 1}</span>
                        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                          <span className="truncate text-sm font-semibold text-foreground">
                            {highlightMatch(result.title, query)}
                          </span>
                          <p className="truncate text-xs text-muted-foreground">
                            {highlightMatch(result.description || '', query)}
                          </p>
                        </div>
                        <div className="shrink-0 text-muted-foreground">
                          <svg
                            width="14"
                            height="14"
                            viewBox="0 0 16 16"
                            fill="none"
                          >
                            <path
                              d="M6 3l5 5-5 5"
                              stroke="currentColor"
                              strokeWidth="2"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                            />
                          </svg>
                        </div>
                      </button>
                    </div>
                  );
                })}
              </>
            )}
          </div>

          <div className="flex items-center justify-center border-t border-border px-5 py-3">
            <span className="flex items-center gap-2 text-xs text-muted-foreground">
              <ShortcutKeys keys={['↑', '↓']} /> {t('search.navigate')}
              <span className="mx-1 inline-block h-3 w-px bg-border" />
              <KeyIcon>↵</KeyIcon> {t('search.select')}
            </span>
          </div>
        </div>
      </div>
    </>,
    document.body
  );
};
