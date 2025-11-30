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

/**
 * Data attribute name for hidden state
 */
export const DATA_ATTRIBUTE_HIDDEN = 'data-blok-hidden';

/**
 * Data attribute name for confirmation state
 */
export const DATA_ATTRIBUTE_CONFIRMATION = 'data-blok-popover-item-confirmation';

/**
 * Data attribute name for no-hover state
 */
export const DATA_ATTRIBUTE_NO_HOVER = 'data-blok-popover-item-no-hover';

/**
 * Data attribute name for no-focus state
 */
export const DATA_ATTRIBUTE_NO_FOCUS = 'data-blok-popover-item-no-focus';

/**
 * Data attribute name for focused state (managed by DomIterator)
 */
export const DATA_ATTRIBUTE_FOCUSED = 'data-blok-focused';

/**
 * Data attribute name for wobble animation state
 */
export const DATA_ATTRIBUTE_WOBBLE = 'data-blok-popover-item-wobble';
