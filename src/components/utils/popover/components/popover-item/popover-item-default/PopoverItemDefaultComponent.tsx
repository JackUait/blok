import React from 'react';
import { IconChevronRight } from '../../../../../icons';
import { css, DATA_ATTRIBUTE_ACTIVE } from './popover-item-default.const';

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
   * Whether the item is active
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
}

/**
 * Stateless React component for rendering popover item default markup
 * All state management is handled externally by the PopoverItemDefault class
 */
export const PopoverItemDefaultComponent: React.FC<PopoverItemDefaultComponentProps> = ({
  icon,
  title,
  secondaryLabel,
  isActive = false,
  isDisabled = false,
  hasChildren = false,
  hideChevron = false,
  wrapperTag = 'div',
  name,
  iconWithGap = true,
}) => {
  const containerClasses = [
    css.container,
    isActive ? css.active : '',
    isDisabled ? css.disabled : '',
    isDisabled ? css.disabledCursor : '',
    isDisabled ? css.disabledPointerEvents : '',
  ].filter(c => c !== '').join(' ');

  const iconClasses = iconWithGap
    ? `${css.icon} ${css.iconToolMargin}`
    : css.icon;

  const showChevron = hasChildren && !hideChevron;

  const content = (
    <>
      {icon && (
        <div
          className={iconClasses}
          data-blok-testid="popover-item-icon"
          dangerouslySetInnerHTML={{ __html: icon }}
        />
      )}
      {title !== undefined && (
        <div
          className={css.title}
          data-blok-testid="popover-item-title"
        >
          {title}
        </div>
      )}
      {secondaryLabel && (
        <div
          className={css.secondaryTitle}
          data-blok-testid="popover-item-secondary-title"
        >
          {secondaryLabel}
        </div>
      )}
      {showChevron && (
        <div
          className={`${css.icon} ${css.iconChevronRight}`}
          data-blok-testid="popover-item-chevron-right"
          dangerouslySetInnerHTML={{ __html: IconChevronRight }}
        />
      )}
    </>
  );

  const commonProps = {
    className: containerClasses,
    'data-blok-testid': 'popover-item',
    ...(name && { 'data-blok-item-name': name }),
    ...(isDisabled && { 'data-blok-disabled': 'true' }),
    ...(isActive && { [DATA_ATTRIBUTE_ACTIVE]: 'true' }),
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
};
