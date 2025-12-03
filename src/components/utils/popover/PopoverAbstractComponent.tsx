import React, { forwardRef, useImperativeHandle, useState, useRef } from 'react';
import { flushSync } from 'react-dom';
import { twMerge } from '../tw';
import { css, DATA_ATTR } from './popover.const';
import type { PopoverMessages } from '@/types/utils/popover/popover';

/**
 * Props for the PopoverAbstractComponent
 */
export interface PopoverAbstractComponentProps {
  /**
   * Custom CSS class for the popover root element
   */
  customClass?: string;

  /**
   * Messages for popover UI (nothing found, search placeholder)
   */
  messages: PopoverMessages;

  /**
   * Child elements (popover items) to render
   */
  children?: React.ReactNode;
}

/**
 * Imperative handle exposed by PopoverAbstractComponent
 * Allows parent class to control component state without re-rendering entire tree
 */
export interface PopoverAbstractComponentHandle {
  /**
   * Get the root popover element
   */
  getPopoverElement: () => HTMLElement | null;

  /**
   * Get the popover container element
   */
  getContainerElement: () => HTMLElement | null;

  /**
   * Get the items wrapper element
   */
  getItemsElement: () => HTMLElement | null;

  /**
   * Get the nothing found message element
   */
  getNothingFoundElement: () => HTMLElement | null;

  /**
   * Set the opened state of the popover
   */
  setOpened: (isOpened: boolean) => void;

  /**
   * Set the open-top state (popover opens above trigger)
   */
  setOpenTop: (openTop: boolean) => void;

  /**
   * Set the open-left state (popover opens to the left)
   */
  setOpenLeft: (openLeft: boolean) => void;

  /**
   * Show/hide the nothing found message
   */
  setNothingFoundVisible: (visible: boolean) => void;

  /**
   * Update container classes (for opened state styling)
   */
  setContainerOpened: (isOpened: boolean) => void;
}

/**
 * React component for rendering the base popover structure
 *
 * This component renders:
 * - Root popover element with data attributes
 * - Popover container with styling and animation
 * - Nothing found message
 * - Items wrapper for popover items
 *
 * State is controlled via imperative handle to maintain compatibility
 * with the existing vanilla class-based API.
 */
export const PopoverAbstractComponent = forwardRef<
  PopoverAbstractComponentHandle,
  PopoverAbstractComponentProps
>(({ customClass, messages, children }, ref) => {
  // State managed via imperative handle
  const [isOpened, setIsOpened] = useState(false);
  const [openTop, setOpenTop] = useState(false);
  const [openLeft, setOpenLeft] = useState(false);
  const [nothingFoundVisible, setNothingFoundVisible] = useState(false);
  const [containerOpened, setContainerOpened] = useState(false);

  // Refs to DOM elements for external access
  const popoverRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const itemsRef = useRef<HTMLDivElement>(null);
  const nothingFoundRef = useRef<HTMLDivElement>(null);

  // Expose imperative handle to parent class
  useImperativeHandle(ref, () => ({
    getPopoverElement: () => popoverRef.current,
    getContainerElement: () => containerRef.current,
    getItemsElement: () => itemsRef.current,
    getNothingFoundElement: () => nothingFoundRef.current,

    setOpened: (opened: boolean) => {
      flushSync(() => setIsOpened(opened));
    },

    setOpenTop: (value: boolean) => {
      flushSync(() => setOpenTop(value));
    },

    setOpenLeft: (value: boolean) => {
      flushSync(() => setOpenLeft(value));
    },

    setNothingFoundVisible: (visible: boolean) => {
      flushSync(() => setNothingFoundVisible(visible));
    },

    setContainerOpened: (opened: boolean) => {
      flushSync(() => setContainerOpened(opened));
    },
  }), []);

  // Build container classes based on state
  const containerClasses = twMerge(
    css.popoverContainer,
    containerOpened && css.popoverContainerOpened
  );

  // Build nothing found classes
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
      {...(customClass && { 'data-blok-popover-custom-class': customClass })}
      data-blok-testid="popover"
      style={{
        // CSS variables for popover layout
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
});

PopoverAbstractComponent.displayName = 'PopoverAbstractComponent';
