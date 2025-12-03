import React, {
  forwardRef,
  useImperativeHandle,
  useState,
  useRef,
  useCallback,
  useEffect,
} from 'react';
import { flushSync } from 'react-dom';
import { FlipperProvider, useFlipperContext } from './contexts/FlipperContext';
import { SearchInputComponent, type SearchInputComponentHandle } from './SearchInputComponent';
import { usePopoverPosition } from './hooks/usePopoverPosition';
import { twMerge } from '../utils/tw';
import { css, DATA_ATTR, CSSVariables } from '../utils/popover/popover.const';
import { css as popoverItemCss } from '../utils/popover/components/popover-item';
import * as _ from '../utils';
import type { PopoverMessages } from '@/types/utils/popover/popover';
import type { SearchableItem } from '../utils/popover/components/search-input/search-input.types';

/**
 * Props for PopoverDesktopComponent
 * @internal
 */
export interface PopoverDesktopComponentProps {
  /**
   * Custom CSS class for root element
   */
  customClass?: string;

  /**
   * Popover messages (nothing found, search placeholder)
   */
  messages: PopoverMessages;

  /**
   * Whether popover is searchable
   */
  searchable?: boolean;

  /**
   * Searchable items for search functionality
   */
  searchableItems?: SearchableItem[];

  /**
   * Trigger element for positioning
   */
  trigger?: HTMLElement;

  /**
   * Scope element for boundary detection
   */
  scopeElement?: HTMLElement;

  /**
   * Nesting level (0 = root)
   */
  nestingLevel?: number;

  /**
   * Whether keyboard navigation is enabled
   * @default true
   */
  flippable?: boolean;

  /**
   * Allowed keys for flipper navigation
   */
  allowedKeys?: number[];

  /**
   * Callback when search query changes
   */
  onSearch?: (data: { query: string; items: SearchableItem[] }) => void;

  /**
   * Callback when popover closes
   */
  onClose?: () => void;

  /**
   * Callback when popover closes due to item activation
   */
  onClosedOnActivate?: () => void;

  /**
   * Callback on flipper navigation
   */
  onFlip?: () => void;

  /**
   * Children (popover items)
   */
  children?: React.ReactNode;
}

/**
 * Imperative handle for PopoverDesktopComponent
 * @internal
 */
export interface PopoverDesktopComponentHandle {
  // Element accessors
  getPopoverElement: () => HTMLElement | null;
  getContainerElement: () => HTMLElement | null;
  getItemsElement: () => HTMLElement | null;
  getNothingFoundElement: () => HTMLElement | null;

  // State setters
  setOpened: (opened: boolean) => void;
  setOpenTop: (value: boolean) => void;
  setOpenLeft: (value: boolean) => void;
  setNothingFoundVisible: (visible: boolean) => void;
  setContainerOpened: (opened: boolean) => void;

  // Popover API
  show: () => void;
  hide: () => void;
  hasFocus: () => boolean;
  getSize: () => { width: number; height: number };
  getScrollTop: () => number;
  getOffsetTop: () => number;

  // Flipper API
  activateFlipper: (items?: HTMLElement[], cursorPosition?: number) => void;
  deactivateFlipper: () => void;
  focusFirst: () => void;
  setFlippableElements: (elements: HTMLElement[]) => void;

  // Search API
  focusSearch: () => void;
  clearSearch: () => void;
}

/**
 * Inner component that has access to FlipperContext
 * @internal
 */
/**
 * Default empty array for searchableItems to avoid unstable default prop
 */
const DEFAULT_SEARCHABLE_ITEMS: SearchableItem[] = [];

const PopoverDesktopInner = forwardRef<PopoverDesktopComponentHandle, PopoverDesktopComponentProps>(
  (
    {
      customClass,
      messages,
      searchable = false,
      searchableItems = DEFAULT_SEARCHABLE_ITEMS,
      trigger,
      scopeElement,
      nestingLevel = 0,
      flippable = true,
      allowedKeys: _allowedKeys,
      onSearch,
      onClose,
      onClosedOnActivate: _onClosedOnActivate,
      onFlip,
      children,
    },
    ref
  ) => {
    // State
    const [isOpened, setIsOpened] = useState(false);
    const [openTop, setOpenTop] = useState(false);
    const [openLeft, setOpenLeft] = useState(false);
    const [nothingFoundVisible, setNothingFoundVisible] = useState(false);
    const [containerOpened, setContainerOpened] = useState(false);
    const [sizeCache, setSizeCache] = useState<{ width: number; height: number } | null>(null);

    // Refs
    const popoverRef = useRef<HTMLDivElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const itemsRef = useRef<HTMLDivElement>(null);
    const nothingFoundRef = useRef<HTMLDivElement>(null);
    const searchRef = useRef<SearchInputComponentHandle>(null);
    const flippableElementsRef = useRef<HTMLElement[]>([]);

    // Get flipper context
    const flipper = useFlipperContext();

    // Position hook
    const triggerRef = useRef<HTMLElement | null>(trigger ?? null);
    const scopeRef = useRef<HTMLElement | null>(scopeElement ?? null);

    const { position, shouldOpenBottom, shouldOpenRight } = usePopoverPosition({
      triggerRef,
      scopeElementRef: scopeRef,
      popoverRef,
      containerRef,
      calculateOnMount: false,
    });

    // Register flip callback
    useEffect(() => {
      if (onFlip) {
        flipper.onFlip(onFlip);

        return () => {
          flipper.removeOnFlip(onFlip);
        };
      }
    }, [flipper, onFlip]);

    /**
     * Calculate popover size by cloning and measuring
     */
    const calculateSize = useCallback((): { width: number; height: number } => {
      if (sizeCache) {
        return sizeCache;
      }

      if (!popoverRef.current) {
        return { width: 0, height: 0 };
      }

      const clone = popoverRef.current.cloneNode(true) as HTMLElement;

      clone.style.visibility = 'hidden';
      clone.style.position = 'absolute';
      clone.style.top = '-1000px';
      clone.setAttribute(DATA_ATTR.opened, 'true');
      clone.querySelector(`[${DATA_ATTR.nested}]`)?.remove();

      document.body.appendChild(clone);

      const container = clone.querySelector(`[${DATA_ATTR.popoverContainer}]`) as HTMLElement;
      const size = {
        width: container?.offsetWidth ?? 0,
        height: container?.offsetHeight ?? 0,
      };

      clone.remove();
      setSizeCache(size);

      return size;
    }, [sizeCache]);

    /**
     * Show popover
     */
    const show = useCallback(() => {
      if (!popoverRef.current) {
        return;
      }

      // Append to body if triggered
      if (trigger && !popoverRef.current.isConnected) {
        document.body.appendChild(popoverRef.current);
      }

      // Calculate position if trigger exists
      if (trigger) {
        const { top, left } = position;

        popoverRef.current.style.position = 'absolute';
        popoverRef.current.style.top = `${top}px`;
        popoverRef.current.style.left = `${left}px`;
        popoverRef.current.style.setProperty(CSSVariables.PopoverTop, '0px');
        popoverRef.current.style.setProperty(CSSVariables.PopoverLeft, '0px');
      }

      // Set height CSS variable
      const size = calculateSize();

      popoverRef.current.style.setProperty(CSSVariables.PopoverHeight, `${size.height}px`);

      // Check open direction if no trigger
      const openBottom = trigger ? true : shouldOpenBottom();
      const openRight = trigger ? true : shouldOpenRight();

      if (!openBottom) {
        flushSync(() => setOpenTop(true));
        popoverRef.current.style.setProperty(
          CSSVariables.PopoverTop,
          'calc(-1 * (0.5rem + var(--popover-height)))'
        );
      }

      if (!openRight) {
        flushSync(() => setOpenLeft(true));
        popoverRef.current.style.setProperty(
          CSSVariables.PopoverLeft,
          'calc(-1 * var(--width) + 100%)'
        );
      }

      flushSync(() => {
        setIsOpened(true);
        setContainerOpened(true);
      });

      // Activate flipper if enabled
      if (flippable) {
        flipper.activate(flippableElementsRef.current);
      }

      // Focus search if present
      if (searchable) {
        searchRef.current?.focus();
      }
    }, [trigger, position, calculateSize, shouldOpenBottom, shouldOpenRight, flippable, flipper, searchable]);

    /**
     * Hide popover
     */
    const hide = useCallback(() => {
      flushSync(() => {
        setIsOpened(false);
        setOpenTop(false);
        setOpenLeft(false);
        setContainerOpened(false);
      });

      flipper.deactivate();

      if (searchable) {
        searchRef.current?.clear();
      }

      onClose?.();
    }, [flipper, searchable, onClose]);

    /**
     * Handle search
     */
    const handleSearch = useCallback((data: { query: string; items: SearchableItem[] }) => {
      const isNothingFound = data.items.length === 0;

      setNothingFoundVisible(isNothingFound);
      onSearch?.(data);

      // Update flipper with filtered elements if active
      if (flipper.isActivated && flippable) {
        flipper.deactivate();
        const elements = data.query === ''
          ? flippableElementsRef.current
          : data.items.map(item => (item as { getElement?: () => HTMLElement | null }).getElement?.()).filter((el): el is HTMLElement => el !== null && el !== undefined);

        flipper.activate(elements);
      }
    }, [onSearch, flipper, flippable]);

    /**
     * Expose imperative handle
     */
    useImperativeHandle(ref, () => ({
      // Element accessors
      getPopoverElement: () => popoverRef.current,
      getContainerElement: () => containerRef.current,
      getItemsElement: () => itemsRef.current,
      getNothingFoundElement: () => nothingFoundRef.current,

      // State setters
      setOpened: (opened: boolean) => flushSync(() => setIsOpened(opened)),
      setOpenTop: (value: boolean) => flushSync(() => setOpenTop(value)),
      setOpenLeft: (value: boolean) => flushSync(() => setOpenLeft(value)),
      setNothingFoundVisible: (visible: boolean) => flushSync(() => setNothingFoundVisible(visible)),
      setContainerOpened: (opened: boolean) => flushSync(() => setContainerOpened(opened)),

      // Popover API
      show,
      hide,
      hasFocus: () => flipper.hasFocus(),
      getSize: calculateSize,
      getScrollTop: () => itemsRef.current?.scrollTop ?? 0,
      getOffsetTop: () => containerRef.current?.offsetTop ?? 0,

      // Flipper API
      activateFlipper: (items, cursorPosition) => flipper.activate(items, cursorPosition),
      deactivateFlipper: () => flipper.deactivate(),
      focusFirst: () => flipper.focusFirst(),
      setFlippableElements: (elements: HTMLElement[]) => {
        flippableElementsRef.current = elements;
      },

      // Search API
      focusSearch: () => searchRef.current?.focus(),
      clearSearch: () => searchRef.current?.clear(),
    }), [show, hide, calculateSize, flipper]);

    // Build CSS classes
    const containerClasses = twMerge(
      css.popoverContainer,
      containerOpened && css.popoverContainerOpened
    );

    const nothingFoundClasses = twMerge(
      'cursor-default text-sm leading-5 font-medium whitespace-nowrap overflow-hidden text-ellipsis text-gray-text p-[3px]',
      !nothingFoundVisible && 'hidden'
    );

    return (
      <div
        ref={popoverRef}
        className={customClass}
        data-blok-popover=""
        data-blok-popover-opened={isOpened ? 'true' : undefined}
        data-blok-popover-open-top={openTop ? 'true' : undefined}
        data-blok-popover-open-left={openLeft ? 'true' : undefined}
        data-blok-nested={nestingLevel > 0 ? 'true' : undefined}
        data-blok-testid="popover"
        style={{
          '--width': '200px',
          '--item-padding': '3px',
          '--item-height': 'calc(1.25rem + 2 * var(--item-padding))',
          '--popover-top': 'calc(100% + 0.5rem)',
          '--popover-left': '0',
          '--nested-popover-overlap': '0.25rem',
        } as React.CSSProperties}
      >
        <div
          ref={containerRef}
          className={containerClasses}
          {...{ [DATA_ATTR.popoverContainer]: '' }}
          data-blok-testid="popover-container"
        >
          {searchable && (
            <SearchInputComponent
              ref={searchRef}
              items={searchableItems}
              placeholder={messages.search}
              onSearch={handleSearch}
              className="mb-1.5"
            />
          )}
          <div
            ref={nothingFoundRef}
            className={nothingFoundClasses}
            {...(nothingFoundVisible && { [DATA_ATTR.nothingFoundDisplayed]: 'true' })}
            data-blok-testid="popover-nothing-found"
          >
            {messages.nothingFound}
          </div>
          <div
            ref={itemsRef}
            className={css.items}
            {...{ [DATA_ATTR.popoverItems]: '' }}
            data-blok-testid="popover-items"
          >
            {children}
          </div>
        </div>
      </div>
    );
  }
);

PopoverDesktopInner.displayName = 'PopoverDesktopInner';

/**
 * PopoverDesktopComponent - React component for desktop popover
 *
 * Wraps the inner component with FlipperProvider for keyboard navigation.
 * This component replaces the vanilla PopoverDesktop class internals while
 * maintaining API compatibility.
 *
 * @internal
 */
export const PopoverDesktopComponent = forwardRef<PopoverDesktopComponentHandle, PopoverDesktopComponentProps>(
  (props, ref) => {
    const { allowedKeys } = props;

    // Default allowed keys for popover navigation
    const defaultAllowedKeys = [
      _.keyCodes.TAB,
      _.keyCodes.UP,
      _.keyCodes.DOWN,
      _.keyCodes.ENTER,
    ];

    return (
      <FlipperProvider
        options={{
          focusedItemClass: popoverItemCss.focused,
          allowedKeys: allowedKeys ?? defaultAllowedKeys,
        }}
      >
        <PopoverDesktopInner ref={ref} {...props} />
      </FlipperProvider>
    );
  }
);

PopoverDesktopComponent.displayName = 'PopoverDesktopComponent';
