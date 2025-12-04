import { useState, useCallback, useRef, useMemo, type RefObject } from 'react';
import type { SearchableItem } from '../../utils/popover/components/search-input/search-input.types';

/**
 * Return value from usePopoverSearch hook
 * @internal
 */
export interface UsePopoverSearchReturn {
  /**
   * Current search query
   */
  query: string;

  /**
   * Set the search query
   */
  setQuery: (query: string) => void;

  /**
   * Filtered items based on search query
   */
  filteredItems: SearchableItem[];

  /**
   * Ref to the input element for focus management
   */
  inputRef: RefObject<HTMLInputElement>;

  /**
   * Focus the search input
   */
  focus: () => void;

  /**
   * Clear the search query
   */
  clear: () => void;

  /**
   * Handle input change event
   */
  handleChange: (event: React.ChangeEvent<HTMLInputElement>) => void;
}

/**
 * Options for usePopoverSearch hook
 * @internal
 */
export interface UsePopoverSearchOptions {
  /**
   * Items to filter
   */
  items: SearchableItem[];

  /**
   * Callback when search query changes
   */
  onSearch?: (data: { query: string; items: SearchableItem[] }) => void;
}

/**
 * Hook for managing popover search state
 *
 * Replaces vanilla SearchInput class with React state management.
 * Handles search query state, filtering logic, and input focus.
 *
 * @param options - Hook configuration
 * @returns Search state and handlers
 * @internal
 */
export const usePopoverSearch = ({
  items,
  onSearch,
}: UsePopoverSearchOptions): UsePopoverSearchReturn => {
  const [query, setQueryState] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const onSearchRef = useRef(onSearch);

  // Keep callback ref in sync
  onSearchRef.current = onSearch;

  /**
   * Filter items based on current query
   */
  const filteredItems = useMemo(() => {
    if (!query) {
      return items;
    }

    const lowerQuery = query.toLowerCase();

    return items.filter(item => {
      const text = item.title?.toLowerCase() ?? '';

      return text.includes(lowerQuery);
    });
  }, [items, query]);

  /**
   * Set query and trigger callback
   */
  const setQuery = useCallback((newQuery: string) => {
    if (newQuery === query) {
      return;
    }

    setQueryState(newQuery);

    // Calculate filtered items for callback
    const lowerQuery = newQuery.toLowerCase();
    const filtered = newQuery
      ? items.filter(item => {
          const text = item.title?.toLowerCase() ?? '';

          return text.includes(lowerQuery);
        })
      : items;

    onSearchRef.current?.({ query: newQuery, items: filtered });
  }, [items, query]);

  /**
   * Handle input change event
   */
  const handleChange = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    setQuery(event.target.value);
  }, [setQuery]);

  /**
   * Focus the input element
   */
  const focus = useCallback(() => {
    inputRef.current?.focus();
  }, []);

  /**
   * Clear the search query
   */
  const clear = useCallback(() => {
    setQuery('');
  }, [setQuery]);

  return {
    query,
    setQuery,
    filteredItems,
    inputRef,
    focus,
    clear,
    handleChange,
  };
};
