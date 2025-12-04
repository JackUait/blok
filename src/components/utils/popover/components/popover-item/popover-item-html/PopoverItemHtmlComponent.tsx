import React, { forwardRef, useImperativeHandle, useState, useRef, useEffect } from 'react';
import { flushSync } from 'react-dom';
import { css, cssInline, DATA_ATTR } from './popover-item-html.const';
import { twMerge } from '../../../../tw';

/**
 * Props for the PopoverItemHtmlComponent
 */
export interface PopoverItemHtmlComponentProps {
  /**
   * Custom HTML element to render inside the container
   */
  element: HTMLElement;

  /**
   * Item name for data attribute
   */
  name?: string;

  /**
   * Whether this item is in an inline popover context
   */
  isInline?: boolean;
}

/**
 * Imperative handle exposed by PopoverItemHtmlComponent
 */
export interface PopoverItemHtmlComponentHandle {
  /**
   * Set the hidden state of the item
   */
  setHidden: (isHidden: boolean) => void;

  /**
   * Get the root element
   */
  getRootElement: () => HTMLElement | null;
}

/**
 * React component for rendering popover item with custom HTML content
 * Exposes imperative handle for external state control
 */
export const PopoverItemHtmlComponent = forwardRef<
  PopoverItemHtmlComponentHandle,
  PopoverItemHtmlComponentProps
>(({
  element,
  name,
  isInline = false,
}, ref) => {
  const [isHidden, setIsHidden] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  // Append the custom element to the root container
  useEffect(() => {
    if (rootRef.current && element) {
      rootRef.current.appendChild(element);
    }

    return () => {
      // Don't remove the element on cleanup - it belongs to the user
    };
  }, [element]);

  // Expose imperative handle to parent
  useImperativeHandle(ref, () => ({
    setHidden: (hidden: boolean) => {
      flushSync(() => setIsHidden(hidden));
    },
    getRootElement: () => rootRef.current,
  }), []);

  const rootClass = twMerge(
    css.root,
    isInline && cssInline.root,
    isHidden && css.rootHidden
  );

  return (
    <div
      ref={rootRef}
      className={rootClass}
      {...{ [DATA_ATTR.root]: '' }}
      {...(isHidden && { [DATA_ATTR.hidden]: 'true' })}
      data-blok-testid="popover-item-html"
      {...(name && { 'data-blok-item-name': name })}
    />
  );
});

PopoverItemHtmlComponent.displayName = 'PopoverItemHtmlComponent';
