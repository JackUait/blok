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
import { twMerge } from '../utils/tw';
import { css, cssInline, DATA_ATTR, CSSVariables } from '../utils/popover/popover.const';
import { css as popoverItemCss } from '../utils/popover/components/popover-item';
import { isMobileScreen } from '../utils';
import * as _ from '../utils';
import type { PopoverMessages } from '@/types/utils/popover/popover';

/**
 * Inline popover height CSS variables
 */
const INLINE_HEIGHT = '38px';
const INLINE_HEIGHT_MOBILE = '46px';

/**
 * Props for PopoverInlineComponent
 * @internal
 */
export interface PopoverInlineComponentProps {
  /**
   * Custom CSS class for root element
   */
  customClass?: string;

  /**
   * Popover messages
   */
  messages: PopoverMessages;

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
 * Imperative handle for PopoverInlineComponent
 * @internal
 */
export interface PopoverInlineComponentHandle {
  // Element accessors
  getPopoverElement: () => HTMLElement | null;
  getContainerElement: () => HTMLElement | null;
  getItemsElement: () => HTMLElement | null;

  // State setters
  setOpened: (opened: boolean) => void;
  setOpenTop: (value: boolean) => void;
  setOpenLeft: (value: boolean) => void;

  // Popover API
  show: () => void;
  hide: () => void;
  hasFocus: () => boolean;
  getSize: () => { width: number; height: number };
  getOffsetLeft: () => number;

  // Flipper API
  activateFlipper: (items?: HTMLElement[], cursorPosition?: number) => void;
  deactivateFlipper: () => void;
  focusFirst: () => void;
  setFlippableElements: (elements: HTMLElement[]) => void;
  setHandleContentEditableTargets: (value: boolean) => void;
}

/**
 * Inner component with FlipperContext access
 * @internal
 */
const PopoverInlineInner = forwardRef<PopoverInlineComponentHandle, PopoverInlineComponentProps>(
  (
    {
      customClass,
      messages: _messages,
      scopeElement: _scopeElement,
      nestingLevel = 0,
      flippable = true,
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
    const [containerOpened, setContainerOpened] = useState(false);
    const [sizeCache, setSizeCache] = useState<{ width: number; height: number } | null>(null);

    // Refs
    const popoverRef = useRef<HTMLDivElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const itemsRef = useRef<HTMLDivElement>(null);
    const flippableElementsRef = useRef<HTMLElement[]>([]);

    // Get flipper context
    const flipper = useFlipperContext();

    // Enable contenteditable handling for inline toolbar
    useEffect(() => {
      flipper.setHandleContentEditableTargets(true);

      return () => {
        flipper.setHandleContentEditableTargets(false);
      };
    }, [flipper]);

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
     * Calculate popover size
     */
    const calculateSize = useCallback((): { width: number; height: number } => {
      if (sizeCache) {
        return sizeCache;
      }

      if (!containerRef.current) {
        return { width: 0, height: 0 };
      }

      const rect = containerRef.current.getBoundingClientRect();
      const size = {
        width: rect.width,
        height: rect.height,
      };

      setSizeCache(size);

      return size;
    }, [sizeCache]);

    /**
     * Show popover
     */
    const show = useCallback(() => {
      if (!popoverRef.current || !containerRef.current) {
        return;
      }

      flushSync(() => {
        setIsOpened(true);
        setContainerOpened(true);
      });

      // Apply opened styles
      popoverRef.current.className = twMerge(cssInline.popover, 'inline-block', customClass);
      containerRef.current.className = twMerge(
        css.popoverContainer,
        css.popoverContainerOpened,
        cssInline.popoverContainer,
        'animate-none'
      );

      // Set height
      const height = isMobileScreen() ? 'var(--height-mobile)' : 'var(--height)';

      containerRef.current.style.height = height;

      // Set dimensions after first render
      requestAnimationFrame(() => {
        if (!popoverRef.current || !containerRef.current) {
          return;
        }

        if (nestingLevel === 0) {
          const containerRect = containerRef.current.getBoundingClientRect();
          const width = `${containerRect.width}px`;
          const heightPx = `${containerRect.height}px`;

          popoverRef.current.style.setProperty(CSSVariables.InlinePopoverWidth, width);
          popoverRef.current.style.width = width;
          popoverRef.current.style.height = heightPx;
        }

        // Activate flipper
        if (flippable) {
          flipper.deactivate();
          flipper.activate(flippableElementsRef.current);
        }
      });
    }, [customClass, nestingLevel, flippable, flipper]);

    /**
     * Hide popover
     */
    const hide = useCallback(() => {
      if (!popoverRef.current || !containerRef.current) {
        return;
      }

      flushSync(() => {
        setIsOpened(false);
        setOpenTop(false);
        setOpenLeft(false);
        setContainerOpened(false);
      });

      // Reset styles
      popoverRef.current.className = twMerge(cssInline.popover, customClass);
      containerRef.current.className = twMerge(css.popoverContainer, cssInline.popoverContainer);
      containerRef.current.style.height = '';

      flipper.deactivate();
      onClose?.();
    }, [customClass, flipper, onClose]);

    /**
     * Expose imperative handle
     */
    useImperativeHandle(ref, () => ({
      // Element accessors
      getPopoverElement: () => popoverRef.current,
      getContainerElement: () => containerRef.current,
      getItemsElement: () => itemsRef.current,

      // State setters
      setOpened: (opened: boolean) => flushSync(() => setIsOpened(opened)),
      setOpenTop: (value: boolean) => flushSync(() => setOpenTop(value)),
      setOpenLeft: (value: boolean) => flushSync(() => setOpenLeft(value)),

      // Popover API
      show,
      hide,
      hasFocus: () => flipper.hasFocus(),
      getSize: calculateSize,
      getOffsetLeft: () => containerRef.current?.offsetLeft ?? 0,

      // Flipper API
      activateFlipper: (items, cursorPosition) => flipper.activate(items, cursorPosition),
      deactivateFlipper: () => flipper.deactivate(),
      focusFirst: () => flipper.focusFirst(),
      setFlippableElements: (elements: HTMLElement[]) => {
        flippableElementsRef.current = elements;
      },
      setHandleContentEditableTargets: (value: boolean) => {
        flipper.setHandleContentEditableTargets(value);
      },
    }), [show, hide, calculateSize, flipper]);

    // Build CSS classes
    const popoverClasses = twMerge(
      cssInline.popover,
      isOpened && 'inline-block',
      customClass
    );

    const containerClasses = twMerge(
      css.popoverContainer,
      cssInline.popoverContainer,
      containerOpened && css.popoverContainerOpened,
      containerOpened && 'animate-none'
    );

    const itemsClasses = twMerge(css.items, 'flex');

    return (
      <div
        ref={popoverRef}
        className={popoverClasses}
        data-blok-popover=""
        data-blok-popover-inline=""
        data-blok-popover-opened={isOpened ? 'true' : undefined}
        data-blok-popover-open-top={openTop ? 'true' : undefined}
        data-blok-popover-open-left={openLeft ? 'true' : undefined}
        data-blok-nested={nestingLevel > 0 ? 'true' : undefined}
        data-blok-testid="popover-inline"
        style={{
          '--width': '200px',
          '--height': INLINE_HEIGHT,
          '--height-mobile': INLINE_HEIGHT_MOBILE,
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
          data-blok-testid="popover-inline-container"
        >
          <div
            ref={itemsRef}
            className={itemsClasses}
            {...{ [DATA_ATTR.popoverItems]: '' }}
            data-blok-testid="popover-inline-items"
          >
            {children}
          </div>
        </div>
      </div>
    );
  }
);

PopoverInlineInner.displayName = 'PopoverInlineInner';

/**
 * PopoverInlineComponent - React component for inline popover
 *
 * Used for inline toolbar. Wraps inner component with FlipperProvider.
 * Key differences from desktop:
 * - Horizontal layout
 * - No hover-triggered nested popovers
 * - Toggle behavior for nested items
 * - ContentEditable-aware keyboard handling
 *
 * @internal
 */
export const PopoverInlineComponent = forwardRef<PopoverInlineComponentHandle, PopoverInlineComponentProps>(
  (props, ref) => {
    // Allowed keys for inline popover (no LEFT/RIGHT to allow text editing)
    const allowedKeys = [
      _.keyCodes.TAB,
      _.keyCodes.UP,
      _.keyCodes.DOWN,
      _.keyCodes.ENTER,
    ];

    return (
      <FlipperProvider
        options={{
          focusedItemClass: popoverItemCss.focused,
          allowedKeys,
          handleContentEditableTargets: true,
        }}
      >
        <PopoverInlineInner ref={ref} {...props} />
      </FlipperProvider>
    );
  }
);

PopoverInlineComponent.displayName = 'PopoverInlineComponent';
