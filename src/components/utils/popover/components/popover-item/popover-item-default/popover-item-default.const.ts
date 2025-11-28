import { bem } from '../../../../bem';

/**
 * Popover item block CSS class constructor
 */
const className = bem('blok-popover-item');

/**
 * CSS class names to be used in popover item class
 */
export const css = {
  container: className(),
  active: className(null, 'active'),
  disabled: className(null, 'disabled'),
  focused: className(null, 'focused'),
  hidden: className(null, 'hidden'),
  confirmationState: className(null, 'confirmation'),
  noHover: className(null, 'no-hover'),
  noFocus: className(null, 'no-focus'),
  title: className('title'),
  secondaryTitle: className('secondary-title'),
  icon: className('icon'),
  iconTool: className('icon', 'tool'),
  iconChevronRight: className('icon', 'chevron-right'),
  wobbleAnimation: bem('wobble')(),
};

/**
 * Data attribute name for active state
 */
export const DATA_ATTRIBUTE_ACTIVE = 'data-blok-popover-item-active';
