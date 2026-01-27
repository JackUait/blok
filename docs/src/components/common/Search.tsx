import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { search, getSearchIndex } from '@/utils/search';
import type { SearchResult } from '@/types/search';
import { SEARCH_CATEGORIES } from '@/types/search';
import styles from './Search.module.css';

interface SearchProps {
  open: boolean;
  onClose: () => void;
}

const SEARCH_SHORTCUT = 'k';
const SEARCH_DEBOUNCE_MS = 150;

// Category icons for search results
const getCategoryIcon = (category: string) => {
  switch (category) {
    case 'api':
      return (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="16 18 22 12 16 6" />
          <polyline points="8 6 2 12 8 18" />
        </svg>
      );
    case 'config':
      return (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
        </svg>
      );
    case 'tool':
      return (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
          <line x1="3" y1="9" x2="21" y2="9" />
          <line x1="9" y1="21" x2="9" y2="9" />
        </svg>
      );
    case 'event':
      return (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
        </svg>
      );
    default:
      return (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
          <polyline points="14 2 14 8 20 8" />
          <line x1="16" y1="13" x2="8" y2="13" />
          <line x1="16" y1="17" x2="8" y2="17" />
        </svg>
      );
  }
};

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
  const inputRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const resultsRef = useRef<HTMLDivElement>(null);
  const isKeyboardNavRef = useRef(false);

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
    }
  }, [open]);

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
      const slicedResults = searchResults.slice(0, 10);
      
      setResults(slicedResults);
      setSelectedIndex(0);
    } else {
      setResults([]);
    }
  }, [debouncedQuery]);

  // Handle keyboard navigation within results
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (results.length === 0) return;

      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault();
          isKeyboardNavRef.current = true;
          setSelectedIndex((i) => Math.min(i + 1, results.length - 1));
          break;
        case 'ArrowUp':
          e.preventDefault();
          isKeyboardNavRef.current = true;
          setSelectedIndex((i) => Math.max(i - 1, 0));
          break;
        case 'Enter':
          e.preventDefault();
          if (results[selectedIndex]) {
            handleResultClick(results[selectedIndex]);
          }
          break;
      }
    },
    [results, selectedIndex]
  );

  // Scroll selected result into view with buffer (only for keyboard navigation)
  useEffect(() => {
    if (!resultsRef.current || results.length === 0) return;
    
    // Only scroll for keyboard navigation, not mouse hover
    if (!isKeyboardNavRef.current) return;
    isKeyboardNavRef.current = false;

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
      }
    }
  }, [selectedIndex, results.length]);

  // Handle result click
  const handleResultClick = (result: SearchResult) => {
    const url = result.hash ? `${result.path}#${result.hash}` : result.path;
    navigate(url);
    handleClose();
  };

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
                {results.map((result, index) => (
                  <button
                    key={result.id}
                    className={`${styles['search-result']} ${
                      index === selectedIndex ? styles.selected : ''
                    }`}
                    onClick={() => handleResultClick(result)}
                    type="button"
                    onMouseEnter={() => setSelectedIndex(index)}
                    data-search-result-index={index}
                  >
                    <span className={styles['search-result-number']}>{index + 1}</span>
                    <div className={styles['search-result-icon']}>
                      {getCategoryIcon(result.category)}
                    </div>
                    <div className={styles['search-result-content']}>
                      <div className={styles['search-result-header']}>
                        <span className={styles['search-result-title']}>
                          {highlightMatch(result.title, query)}
                        </span>
                        <span className={styles['search-result-category']}>
                          {SEARCH_CATEGORIES[result.category as keyof typeof SEARCH_CATEGORIES] || result.category}
                        </span>
                      </div>
                      {result.description && (
                        <p className={styles['search-result-description']}>
                          {highlightMatch(result.description, query)}
                        </p>
                      )}
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
                ))}
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
