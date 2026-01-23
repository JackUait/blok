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

export const Search: React.FC<SearchProps> = ({ open, onClose }) => {
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const resultsRef = useRef<HTMLDivElement>(null);

  // Focus input when opened
  useEffect(() => {
    if (open && inputRef.current) {
      inputRef.current.focus();
    }
  }, [open]);

  // Reset state when closing
  useEffect(() => {
    if (!open) {
      setQuery('');
      setResults([]);
      setSelectedIndex(0);
    }
  }, [open]);

  // Handle global keyboard shortcut
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Cmd/Ctrl + K to open search
      if ((e.metaKey || e.ctrlKey) && e.key === SEARCH_SHORTCUT) {
        e.preventDefault();
        if (!open) {
          // We need to trigger opening through the parent component
          // This is handled by the Nav component
        } else {
          onClose();
        }
      }

      // Escape to close
      if (e.key === 'Escape' && open) {
        onClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [open, onClose]);

  // Search functionality
  useEffect(() => {
    if (query.trim()) {
      const searchResults = search(query, getSearchIndex());
      setResults(searchResults.slice(0, 8)); // Limit to 8 results
      setSelectedIndex(0);
    } else {
      setResults([]);
    }
  }, [query]);

  // Handle keyboard navigation within results
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (results.length === 0) return;

      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault();
          setSelectedIndex((i) => (i + 1) % results.length);
          break;
        case 'ArrowUp':
          e.preventDefault();
          setSelectedIndex(
            (i) => (i - 1 + results.length) % results.length
          );
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

  // Scroll selected result into view
  useEffect(() => {
    if (resultsRef.current) {
      const selectedElement = resultsRef.current.children[
        selectedIndex
      ] as HTMLElement;
      selectedElement?.scrollIntoView({ block: 'nearest' });
    }
  }, [selectedIndex]);

  // Handle result click
  const handleResultClick = (result: SearchResult) => {
    const url = result.hash ? `${result.path}#${result.hash}` : result.path;
    navigate(url);
    onClose();
  };

  if (!open) return null;

  const handleDialogClick = (e: React.MouseEvent) => {
    e.stopPropagation();
  };

  return (
    <>
      <div className={styles['search-backdrop']} onClick={onClose} data-search-backdrop />
      <div className={styles['search-container']} onClick={onClose} data-search-container>
        <div className={styles['search-dialog']} ref={dialogRef} onClick={handleDialogClick}>
          <div className={styles['search-input-wrapper']}>
            <svg
              className={styles['search-icon']}
              width="20"
              height="20"
              viewBox="0 0 20 20"
              fill="none"
            >
              <path
                d="M9 17A8 8 0 1 0 9 1a8 8 0 0 0 0 16zM19 19l-4.35-4.35"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            <input
              ref={inputRef}
              type="text"
              className={styles['search-input']}
              placeholder="Search documentation..."
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
                        width="20"
                        height="20"
                        viewBox="0 0 20 20"
                        fill="none"
                      >
                        <circle
                          cx="10"
                          cy="10"
                          r="8"
                          stroke="currentColor"
                          strokeWidth="2"
                        />
                        <path
                          d="M6 10h8"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                        />
                      </svg>
                    </div>
                    <p className={styles['search-empty-title']}>No results found</p>
                    <p className={styles['search-empty-description']}>
                      Try different keywords or check the documentation
                    </p>
                  </>
                ) : (
                  <>
                    <div className={styles['search-empty-icon']}>
                      <svg
                        width="20"
                        height="20"
                        viewBox="0 0 20 20"
                        fill="none"
                      >
                        <circle
                          cx="10"
                          cy="10"
                          r="8"
                          stroke="currentColor"
                          strokeWidth="2"
                        />
                        <path
                          d="M9 17A8 8 0 1 0 9 1a8 8 0 0 0 0 16zM19 19l-4.35-4.35"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      </svg>
                    </div>
                    <p className={styles['search-empty-title']}>Search documentation</p>
                    <p className={styles['search-empty-description']}>
                      Type to search API methods, configuration options, and more
                    </p>
                    <div className={styles['search-shortcuts']}>
                      <div className={styles['search-shortcut-item']}>
                        <kbd>↑↓</kbd>
                        <span>Navigate</span>
                      </div>
                      <div className={styles['search-shortcut-item']}>
                        <kbd>↵</kbd>
                        <span>Select</span>
                      </div>
                      <div className={styles['search-shortcut-item']}>
                        <kbd>esc</kbd>
                        <span>Close</span>
                      </div>
                    </div>
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
                  >
                    <div className={styles['search-result-content']}>
                      <div className={styles['search-result-header']}>
                        <span className={styles['search-result-title']}>
                          {result.title}
                        </span>
                        <span className={styles['search-result-category']}>
                          {SEARCH_CATEGORIES[result.category as keyof typeof SEARCH_CATEGORIES] || result.category}
                        </span>
                      </div>
                      {result.description && (
                        <p className={styles['search-result-description']}>
                          {result.description}
                        </p>
                      )}
                    </div>
                    <svg
                      className={styles['search-result-arrow']}
                      width="16"
                      height="16"
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
                  </button>
                ))}
              </>
            )}
          </div>

          <div className={styles['search-footer']}>
            <span className={styles['search-footer-hint']}>
              <kbd>↑↓</kbd> to navigate
              <span className={styles['search-footer-separator']} />
              <kbd>↵</kbd> to select
              <span className={styles['search-footer-separator']} />
              <kbd>esc</kbd> to close
            </span>
          </div>
        </div>
      </div>
    </>
  );
};
