import React, { forwardRef, useImperativeHandle, useEffect } from 'react';
import { usePopoverSearch, type UsePopoverSearchOptions } from './hooks/usePopoverSearch';
import { IconSearch } from '../icons';
import { twMerge } from '../utils/tw';
import type { SearchableItem } from '../utils/popover/components/search-input/search-input.types';

/**
 * CSS classes for SearchInputComponent
 * Matches vanilla search-input.const.ts styles
 */
const css = {
  wrapper: 'bg-[#F8F8F8] border border-[rgba(226,226,229,0.20)] rounded p-0.5 grid grid-cols-[auto_auto_1fr] grid-rows-[auto]',
  icon: 'w-toolbox-btn h-toolbox-btn flex items-center justify-center mr-2 [&_svg]:w-icon [&_svg]:h-icon [&_svg]:text-gray-text',
  input: "text-sm outline-none font-medium font-inherit border-0 bg-transparent m-0 p-0 leading-[22px] min-w-[calc(100%-theme('spacing.6')-10px)] placeholder:text-gray-text placeholder:font-medium",
};

/**
 * Props for SearchInputComponent
 * @internal
 */
export interface SearchInputComponentProps {
  /**
   * Items to search through
   */
  items: SearchableItem[];

  /**
   * Placeholder text for the input
   */
  placeholder?: string;

  /**
   * Callback when search query changes
   */
  onSearch?: UsePopoverSearchOptions['onSearch'];

  /**
   * Additional CSS class for wrapper
   */
  className?: string;

  /**
   * Whether to auto-focus on mount
   */
  autoFocus?: boolean;
}

/**
 * Imperative handle exposed by SearchInputComponent
 * @internal
 */
export interface SearchInputComponentHandle {
  /**
   * Get the wrapper element
   */
  getElement: () => HTMLDivElement | null;

  /**
   * Focus the input
   */
  focus: () => void;

  /**
   * Clear the search query
   */
  clear: () => void;

  /**
   * Get current query value
   */
  getQuery: () => string;
}

/**
 * SearchInputComponent - React component for popover search
 *
 * Replaces vanilla SearchInput class with a React component.
 * Uses usePopoverSearch hook for state management.
 *
 * @internal
 */
export const SearchInputComponent = forwardRef<SearchInputComponentHandle, SearchInputComponentProps>(
  (
    {
      items,
      placeholder,
      onSearch,
      className,
      autoFocus = false,
    },
    ref
  ) => {
    const wrapperRef = React.useRef<HTMLDivElement>(null);

    const {
      query,
      inputRef,
      focus,
      clear,
      handleChange,
    } = usePopoverSearch({
      items,
      onSearch,
    });

    /**
     * Auto-focus on mount if requested
     */
    useEffect(() => {
      if (autoFocus) {
        // Delay focus to ensure DOM is ready
        requestAnimationFrame(() => {
          focus();
        });
      }
    }, [autoFocus, focus]);

    /**
     * Expose imperative handle
     */
    useImperativeHandle(ref, () => ({
      getElement: () => wrapperRef.current,
      focus,
      clear,
      getQuery: () => query,
    }), [focus, clear, query]);

    return (
      <div
        ref={wrapperRef}
        className={twMerge(css.wrapper, className)}
        data-blok-testid="popover-search-field"
      >
        <div
          className={css.icon}
          // eslint-disable-next-line react/no-danger
          dangerouslySetInnerHTML={{ __html: IconSearch }}
        />
        <input
          ref={inputRef}
          type="search"
          className={css.input}
          placeholder={placeholder}
          value={query}
          onChange={handleChange}
          tabIndex={-1}
          data-blok-flipper-navigation-target="true"
          data-blok-testid="popover-search-input"
        />
      </div>
    );
  }
);

SearchInputComponent.displayName = 'SearchInputComponent';
