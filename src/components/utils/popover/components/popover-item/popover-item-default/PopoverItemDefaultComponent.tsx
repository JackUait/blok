import React, { forwardRef, useImperativeHandle, useState, useCallback } from 'react';
import { flushSync } from 'react-dom';
import { IconChevronRight } from '../../../../../icons';
import { css, cssInline, cssNestedInline, DATA_ATTR } from './popover-item-default.const';
import { twMerge } from '../../../../tw';
import type { PopoverItemDefaultParams } from '@/types/utils/popover/popover-item';

/**
 * Props for the PopoverItemDefaultComponent
 */
export interface PopoverItemDefaultComponentProps {
  /**
   * Icon HTML string to display
   */
  icon?: string;

  /**
   * Item title
   */
  title?: string;

  /**
   * Secondary label text
   */
  secondaryLabel?: string;

  /**
   * Whether the item is active (initial value, can be overridden by imperative handle)
   */
  isActive?: boolean;

  /**
   * Whether the item is disabled
   */
  isDisabled?: boolean;

  /**
   * Whether the item has children (shows chevron)
   */
  hasChildren?: boolean;

  /**
   * Whether to hide the chevron icon
   */
  hideChevron?: boolean;

  /**
   * Wrapper tag to use ('div' or 'button')
   */
  wrapperTag?: 'div' | 'button';

  /**
   * Item name for data attribute
   */
  name?: string;

  /**
   * Whether to add gap after icon
   */
  iconWithGap?: boolean;

  /**
   * Whether this item is in an inline popover context
   */
  isInline?: boolean;

  /**
   * Whether this item is in a nested inline popover context
   */
  isNestedInline?: boolean;
}

/**
 * Imperative handle exposed by PopoverItemDefaultComponent
 * Allows parent class to control component state without re-rendering entire tree
 */
export interface PopoverItemDefaultComponentHandle {
  /**
   * Set the active state of the item
   */
  setActive: (isActive: boolean) => void;

  /**
   * Set the hidden state of the item
   */
  setHidden: (isHidden: boolean) => void;

  /**
   * Set the focused state of the item
   */
  setFocused: (isFocused: boolean) => void;

  /**
   * Set the confirmation state with new params, or null to clear
   */
  setConfirmation: (params: PopoverItemDefaultParams | null) => void;

  /**
   * Set the no-hover state (prevents hover highlighting)
   */
  setNoHover: (noHover: boolean) => void;

  /**
   * Set the no-focus state (prevents focus highlighting)
   */
  setNoFocus: (noFocus: boolean) => void;

  /**
   * Trigger wobble animation on the icon
   */
  triggerWobble: () => void;

  /**
   * Get reference to the icon element for animation purposes
   */
  getIconElement: () => HTMLElement | null;
}

/**
 * Stateful React component for rendering popover item default markup
 * Exposes imperative handle for external state control by PopoverItemDefault class
 */
export const PopoverItemDefaultComponent = forwardRef<
  PopoverItemDefaultComponentHandle,
  PopoverItemDefaultComponentProps
>(({
  icon: initialIcon,
  title: initialTitle,
  secondaryLabel: initialSecondaryLabel,
  isActive: initialIsActive = false,
  isDisabled: initialIsDisabled = false,
  hasChildren = false,
  hideChevron = false,
  wrapperTag = 'div',
  name,
  iconWithGap = true,
  isInline = false,
  isNestedInline = false,
}, ref) => {
  // Internal state that can be controlled via imperative handle
  const [isActive, setIsActive] = useState(initialIsActive);
  const [isHidden, setIsHidden] = useState(false);
  const [isFocused, setIsFocused] = useState(false);
  const [isConfirmation, setIsConfirmation] = useState(false);
  const [noHover, setNoHover] = useState(false);
  const [noFocus, setNoFocus] = useState(false);
  const [isWobbling, setIsWobbling] = useState(false);

  // Confirmation state overrides - when set, these override the initial props
  const [confirmationOverrides, setConfirmationOverrides] = useState<{
    icon?: string;
    title?: string;
    secondaryLabel?: string;
  } | null>(null);

  // Current values - use confirmation overrides if in confirmation state
  const icon = confirmationOverrides?.icon ?? initialIcon;
  const title = confirmationOverrides?.title ?? initialTitle;
  const secondaryLabel = confirmationOverrides?.secondaryLabel ?? initialSecondaryLabel;
  const isDisabled = initialIsDisabled;

  // Ref to icon element for animations
  const iconRef = React.useRef<HTMLDivElement>(null);

  // Handle wobble animation end - wrapped in flushSync for synchronous DOM updates
  const handleAnimationEnd = useCallback(() => {
    flushSync(() => setIsWobbling(false));
  }, []);

  // Attach native event listener for animationend since tests dispatch non-bubbling events
  React.useEffect(() => {
    const iconElement = iconRef.current;

    if (!iconElement || !isWobbling) {
      return;
    }

    iconElement.addEventListener('animationend', handleAnimationEnd);

    return () => {
      iconElement.removeEventListener('animationend', handleAnimationEnd);
    };
  }, [isWobbling, handleAnimationEnd]);

  // Expose imperative handle to parent
  // Uses flushSync to ensure DOM updates are synchronous for external code
  useImperativeHandle(ref, () => ({
    setActive: (active: boolean) => {
      flushSync(() => setIsActive(active));
    },
    setHidden: (hidden: boolean) => {
      flushSync(() => setIsHidden(hidden));
    },
    setFocused: (focused: boolean) => {
      flushSync(() => setIsFocused(focused));
    },
    setConfirmation: (params: PopoverItemDefaultParams | null) => {
      flushSync(() => {
        if (params === null) {
          setIsConfirmation(false);
          setConfirmationOverrides(null);
        } else {
          setIsConfirmation(true);
          setConfirmationOverrides({
            icon: params.icon,
            // eslint-disable-next-line @typescript-eslint/no-deprecated -- TODO: remove this once label is removed
            title: params.title || params.label,
            secondaryLabel: params.secondaryLabel,
          });
        }
      });
    },
    setNoHover: (value: boolean) => {
      flushSync(() => setNoHover(value));
    },
    setNoFocus: (value: boolean) => {
      flushSync(() => setNoFocus(value));
    },
    triggerWobble: () => {
      if (!isWobbling) {
        flushSync(() => setIsWobbling(true));
      }
    },
    getIconElement: () => iconRef.current,
  }), [isWobbling]);
  // Build class names using twMerge with inline context awareness
  const containerClasses = twMerge(
    css.item,
    isInline && cssInline.item,
    isNestedInline && cssNestedInline.item,
    isActive && css.itemActive,
    isDisabled && css.itemDisabled,
    isFocused && '!bg-item-focus-bg',
    isConfirmation && '!bg-item-confirm-bg !text-white',
    isHidden && '!hidden'
  );

  const iconClasses = twMerge(
    css.icon,
    isInline && 'w-auto h-auto [&_svg]:w-icon [&_svg]:h-icon mobile:[&_svg]:w-icon-mobile mobile:[&_svg]:h-icon-mobile',
    isNestedInline && 'w-toolbox-btn h-toolbox-btn',
    iconWithGap && 'mr-2',
    iconWithGap && isInline && 'shadow-none bg-transparent !mr-0',
    iconWithGap && isNestedInline && '!mr-2',
    isWobbling && 'animate-wobble'
  );

  const chevronClasses = twMerge(
    css.icon,
    isInline && 'rotate-90'
  );

  const showChevron = hasChildren && !hideChevron;

  const content = (
    <>
      {icon && (
        <div
          ref={iconRef}
          {...{ [DATA_ATTR.icon]: '' }}
          {...(iconWithGap && { [DATA_ATTR.iconTool]: '' })}
          {...(isWobbling && { [DATA_ATTR.wobble]: 'true' })}
          className={iconClasses}
          data-blok-testid="popover-item-icon"
          // eslint-disable-next-line react/no-danger -- Icon is trusted HTML string from tool configuration
          dangerouslySetInnerHTML={{ __html: icon }}
        />
      )}
      {title !== undefined && (
        <div
          {...{ [DATA_ATTR.title]: '' }}
          className="mr-auto truncate text-sm font-medium leading-5"
          data-blok-testid="popover-item-title"
        >
          {title}
        </div>
      )}
      {secondaryLabel && (
        <div
          {...{ [DATA_ATTR.secondaryTitle]: '' }}
          className="whitespace-nowrap pr-1.5 text-xs -tracking-widest text-text-secondary opacity-60"
          data-blok-testid="popover-item-secondary-title"
        >
          {secondaryLabel}
        </div>
      )}
      {showChevron && (
        <div
          {...{ [DATA_ATTR.icon]: '', [DATA_ATTR.iconChevronRight]: '' }}
          className={chevronClasses}
          data-blok-testid="popover-item-chevron-right"
          // eslint-disable-next-line react/no-danger -- IconChevronRight is trusted internal icon
          dangerouslySetInnerHTML={{ __html: IconChevronRight }}
        />
      )}
    </>
  );

  const commonProps = {
    className: containerClasses,
    [DATA_ATTR.item]: '',
    'data-blok-testid': 'popover-item',
    ...(name && { 'data-blok-item-name': name }),
    ...(isDisabled && { [DATA_ATTR.disabled]: 'true' }),
    ...(isActive && { [DATA_ATTR.active]: 'true' }),
    ...(isHidden && { [DATA_ATTR.hidden]: 'true' }),
    ...(isConfirmation && { [DATA_ATTR.confirmation]: 'true' }),
    ...(isFocused && { [DATA_ATTR.focused]: 'true' }),
    ...(noHover && { [DATA_ATTR.noHover]: 'true' }),
    ...(noFocus && { [DATA_ATTR.noFocus]: 'true' }),
    ...(hasChildren && { [DATA_ATTR.hasChildren]: 'true' }),
  };

  if (wrapperTag === 'button') {
    return (
      <button type="button" {...commonProps}>
        {content}
      </button>
    );
  }

  return (
    <div {...commonProps}>
      {content}
    </div>
  );
});

// Display name for debugging
PopoverItemDefaultComponent.displayName = 'PopoverItemDefaultComponent';
