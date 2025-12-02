import React from 'react';
import { IconChevronRight } from '../../../../../icons';
import { css, cssInline, cssNestedInline, DATA_ATTR } from './popover-item-default.const';
import { twMerge } from '../../../../tw';

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
  isInline = false,
  isNestedInline = false,
}) => {
  // Build class names using twMerge with inline context awareness
  const containerClasses = twMerge(
    css.item,
    isInline && cssInline.item,
    isNestedInline && cssNestedInline.item,
    isActive && css.itemActive,
    isDisabled && css.itemDisabled
  );

  const iconClasses = twMerge(
    css.icon,
    isInline && 'w-auto h-auto [&_svg]:w-icon [&_svg]:h-icon mobile:[&_svg]:w-icon-mobile mobile:[&_svg]:h-icon-mobile',
    isNestedInline && 'w-toolbox-btn h-toolbox-btn',
    iconWithGap && 'mr-2',
    iconWithGap && isInline && 'shadow-none bg-transparent !mr-0',
    iconWithGap && isNestedInline && '!mr-2'
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
          {...{ [DATA_ATTR.icon]: '' }}
          {...(iconWithGap && { [DATA_ATTR.iconTool]: '' })}
          className={iconClasses}
          data-blok-testid="popover-item-icon"
          dangerouslySetInnerHTML={{ __html: icon }}
        />
      )}
      {title !== undefined && (
        <div
          {...{ [DATA_ATTR.title]: '' }}
          className={'mr-auto truncate text-sm font-medium leading-5'}
          data-blok-testid="popover-item-title"
        >
          {title}
        </div>
      )}
      {secondaryLabel && (
        <div
          {...{ [DATA_ATTR.secondaryTitle]: '' }}
          className={'whitespace-nowrap pr-1.5 text-xs -tracking-widest text-text-secondary opacity-60'}
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
