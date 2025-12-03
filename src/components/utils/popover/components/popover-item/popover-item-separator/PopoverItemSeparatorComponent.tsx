import React, { forwardRef, useImperativeHandle, useState } from 'react';
import { flushSync } from 'react-dom';
import { css, cssInline, DATA_ATTR } from './popover-item-separator.const';
import { twMerge } from '../../../../tw';

/**
 * Props for the PopoverItemSeparatorComponent
 */
export interface PopoverItemSeparatorComponentProps {
  /**
   * Whether this separator is in an inline popover context
   */
  isInline?: boolean;

  /**
   * Whether this separator is in a nested inline popover context
   */
  isNestedInline?: boolean;
}

/**
 * Imperative handle exposed by PopoverItemSeparatorComponent
 */
export interface PopoverItemSeparatorComponentHandle {
  /**
   * Set the hidden state of the separator
   */
  setHidden: (isHidden: boolean) => void;
}

/**
 * React component for rendering popover separator
 * Exposes imperative handle for external state control
 */
export const PopoverItemSeparatorComponent = forwardRef<
  PopoverItemSeparatorComponentHandle,
  PopoverItemSeparatorComponentProps
>(({
  isInline = false,
  isNestedInline = false,
}, ref) => {
  const [isHidden, setIsHidden] = useState(false);

  // Expose imperative handle to parent
  useImperativeHandle(ref, () => ({
    setHidden: (hidden: boolean) => {
      flushSync(() => setIsHidden(hidden));
    },
  }), []);

  // Build container class based on context
  const getContainerClass = (): string => {
    const baseClass = css.container;

    if (isNestedInline) {
      return twMerge(baseClass, cssInline.nestedContainer, isHidden && css.containerHidden);
    }
    if (isInline) {
      return twMerge(baseClass, cssInline.container, isHidden && css.containerHidden);
    }

    return twMerge(baseClass, isHidden && css.containerHidden);
  };

  // Build line class based on context
  const getLineClass = (): string => {
    if (isNestedInline) {
      return twMerge(css.line, cssInline.nestedLine);
    }
    if (isInline) {
      return twMerge(css.line, cssInline.line);
    }

    return css.line;
  };

  return (
    <div
      className={getContainerClass()}
      {...{ [DATA_ATTR.root]: '' }}
      {...(isHidden && { [DATA_ATTR.hidden]: 'true' })}
      data-blok-testid="popover-item-separator"
    >
      <div
        className={getLineClass()}
        {...{ [DATA_ATTR.line]: '' }}
      />
    </div>
  );
});

PopoverItemSeparatorComponent.displayName = 'PopoverItemSeparatorComponent';
