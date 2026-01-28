import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { search, getSearchIndex } from '@/utils/search';
import type { SearchResult } from '@/types/search';
import { ModuleIcon } from './ModuleIcon';
import buttonStyles from './SearchButton.module.css';
import dialogStyles from './SearchDialog.module.css';
import resultsStyles from './SearchResults.module.css';

// Combined styles object consolidating the split CSS modules
const styles = { ...buttonStyles, ...dialogStyles, ...resultsStyles };

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
      for (let len = qw.length - 1; len >= 3; len--) {
        const prefix = qw.slice(0, len).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        patterns.push(`\\b${prefix}\\b`);
      }
    }
  }
  
  const pattern = `(${patterns.join('|')})`;
  const splitRegex = new RegExp(pattern, 'gi');
  const parts = text.split(splitRegex);
  
  // Use a fresh regex for testing each part (avoid global state issues)
  const testRegex = new RegExp(pattern, 'i');
  
  return parts.map((part, index) => 
    testRegex.test(part) ? (
      <mark key={index} className={styles['search-highlight']}>{part}</mark>
    ) : (
      part
    )
  );
};

const CLOSE_ANIMATION_MS = 200;

export const Search: React.FC<SearchProps> = ({ open, onClose }) => {
  const navigate = useNavigate();
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
    if (!open) {
      setQuery('');
      setDebouncedQuery('');
      setResults([]);
      setSelectedIndex(0);
      setIsClosing(false);
      setIsKeyboardNavMode(false);
      if (keyboardNavTimerRef.current) {
        clearTimeout(keyboardNavTimerRef.current);
        keyboardNavTimerRef.current = null;
      }
    }
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
  useEffect(() => {
    if (open) {
      const originalOverflow = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
      return () => {
        document.body.style.overflow = originalOverflow;
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
    if (debouncedQuery.trim()) {
      const searchResults = search(debouncedQuery, getSearchIndex());

      // Group results by module, keeping items sorted by rank within each module
      const moduleOrder = ['Guide', 'Core', 'API Modules', 'Data', 'Page'];
      const groupedByModule = new Map<string, SearchResult[]>();

      for (const result of searchResults) {
        if (!groupedByModule.has(result.module)) {
          groupedByModule.set(result.module, []);
        }
        groupedByModule.get(result.module)!.push(result);
      }

      // Flatten results grouped by module, maintaining module order
      const orderedResults: SearchResult[] = [];
      for (const module of moduleOrder) {
        const moduleResults = groupedByModule.get(module);
        if (moduleResults) {
          orderedResults.push(...moduleResults);
        }
      }

      // Add any remaining modules not in the predefined order
      for (const [module, moduleResults] of groupedByModule) {
        if (!moduleOrder.includes(module)) {
          orderedResults.push(...moduleResults);
        }
      }

      setResults(orderedResults);
      setSelectedIndex(0);
    } else {
      setResults([]);
    }
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
      const bufferElement = allResults[bufferTopIndex] as HTMLElement;
      if (bufferElement) {
        const bufferRect = bufferElement.getBoundingClientRect();
        const scrollOffset = bufferRect.top - containerRect.top + container.scrollTop - 10;
        container.scrollTo({ top: Math.max(0, scrollOffset), behavior: 'auto' });
        // Ensure input stays focused after scroll (some browsers lose focus on scrollTo)
        inputRef.current?.focus();
      }
      return;
    }

    // Check if selected element is near bottom edge
    if (elementBottom > containerHeight - bufferPixels) {
      const bufferBottomIndex = Math.min(allResults.length - 1, selectedIndex + bufferSize);
      const bufferElement = allResults[bufferBottomIndex] as HTMLElement;
      if (bufferElement) {
        const bufferRect = bufferElement.getBoundingClientRect();
        const scrollOffset = bufferRect.bottom - containerRect.top + container.scrollTop - containerHeight + 10;
        container.scrollTo({ top: scrollOffset, behavior: 'auto' });
        // Ensure input stays focused after scroll (some browsers lose focus on scrollTo)
        inputRef.current?.focus();
      }
    }
  }, [selectedIndex, results.length]);

  useEffect(() => {
    scrollSelectedIntoView();
  }, [scrollSelectedIntoView]);

  if (!open) return null;

  const handleDialogClick = (e: React.MouseEvent) => {
    e.stopPropagation();
  };

  const backdropClasses = `${styles['search-backdrop']} ${isClosing ? styles['search-backdrop-closing'] : ''}`;
  const dialogClasses = `${styles['search-dialog']} ${isClosing ? styles['search-dialog-closing'] : ''}`;

  return (
    <>
      <div className={backdropClasses} onClick={handleClose} data-blok-testid="search-backdrop" />
      <div className={styles['search-container']} onClick={handleClose} data-blok-testid="search-container">
        <div className={dialogClasses} ref={dialogRef} onClick={handleDialogClick} data-blok-testid="search-dialog">
          <div className={styles['search-input-wrapper']}>
            <svg
              className={styles['search-icon']}
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
              className={styles['search-input']}
              placeholder="Search docs..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={handleKeyDown}
              autoComplete="off"
            />
            {query && (
              <button
                className={styles['search-clear']}
                onClick={() => setQuery('')}
                type="button"
                aria-label="Clear search"
              >
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
            <kbd className={styles['search-shortcut']}>ESC</kbd>
          </div>

          <div className={styles['search-results']} ref={resultsRef}>
            {results.length === 0 ? (
              <div className={styles['search-empty']}>
                {query.trim() ? (
                  <>
                    <div className={styles['search-empty-icon']}>
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
                    <p className={styles['search-empty-title']}>No results found</p>
                    <p className={styles['search-empty-description']}>
                      Try different keywords or browse the documentation sections
                    </p>
                  </>
                ) : (
                  <>
                    <div className={styles['search-empty-icon']}>
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
                    <p className={styles['search-empty-title']}>Search Blok docs</p>
                    <p className={styles['search-empty-description']}>
                      Find API methods, configuration options, tools, and more
                    </p>
                  </>
                )}
              </div>
            ) : (
              <>
                <div className={styles['search-results-header']}>
                  <span className={styles['search-results-count']}>
                    {results.length} result{results.length !== 1 ? 's' : ''}
                  </span>
                </div>
                {results.map((result, index) => {
                  const showModuleHeader = index === 0 || result.module !== results[index - 1].module;

                  return (
                    <div key={result.id}>
                      {showModuleHeader && (
                        <div className={styles['search-module-header']} data-blok-testid="search-module-header">
                          <ModuleIcon module={result.module} />
                          <span className={styles['search-module-title']}>
                            {result.module}
                          </span>
                        </div>
                      )}
                      <button
                        className={`${styles['search-result']} ${
                          index === selectedIndex ? styles.selected : ''
                        }`}
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
                        <span className={styles['search-result-number']}>{index + 1}</span>
                        <div className={styles['search-result-content']}>
                          <span className={styles['search-result-title']}>
                            {highlightMatch(result.title, query)}
                          </span>
                          <p className={styles['search-result-description']}>
                            {highlightMatch(result.description || '', query)}
                          </p>
                        </div>
                        <div className={styles['search-result-arrow']}>
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

          <div className={styles['search-footer']}>
            <span className={styles['search-footer-hint']}>
              <kbd>↑↓</kbd> navigate
              <span className={styles['search-footer-separator']} />
              <kbd>↵</kbd> select
            </span>
          </div>
        </div>
      </div>
    </>
  );
};
