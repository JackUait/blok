import { DATA_ATTR } from '../../constants/data-attributes';
import { Flipper } from '../../flipper';
import { isMobileScreen, keyCodes } from '../../utils';
import { twMerge } from '../tw';

import type { PopoverItem } from './components/popover-item';
import { PopoverItemDefault, PopoverItemType , css as popoverItemCls } from './components/popover-item';
import { PopoverItemHtml } from './components/popover-item/popover-item-html/popover-item-html';
import { PopoverDesktop } from './popover-desktop';
import { css, cssInline, CSSVariables, getNestedLevelAttrValue } from './popover.const';

import type { PopoverParams } from '@/types/utils/popover/popover';
import { PopoverEvent } from '@/types/utils/popover/popover-event';



/**
 * Inline popover height CSS variables
 */
const INLINE_HEIGHT = '38px';
const INLINE_HEIGHT_MOBILE = '46px';

/**
 * Horizontal popover that is displayed inline with the content
 * @internal
 */
export class PopoverInline extends PopoverDesktop {
  /**
   * Returns true if a nested popover is currently open
   */
  public get hasNestedPopoverOpen(): boolean {
    return this.nestedPopover !== null && this.nestedPopover !== undefined;
  }

  /**
   * Closes the nested popover if one is open
   */
  public closeNestedPopover(): void {
    this.destroyNestedPopoverIfExists();
  }

  /**
   * Closes popover - override as arrow function to match parent
   */
  public override hide = (): void => {
    // Call parent hide logic manually (can't use super for arrow functions)
    this.setOpenTop(false);
    this.setOpenLeft(false);

    this.itemsDefault.forEach(item => item.reset());

    if (this.search !== undefined) {
      this.search.clear();
    }

    this.destroyNestedPopoverIfExists();
    this.flipper?.deactivate();

    // Reset to closed inline styles
    this.nodes.popover.className = twMerge(cssInline.popover);
    if (this.nodes.popoverContainer) {
      this.nodes.popoverContainer.className = twMerge(
        css.popoverContainer,
        cssInline.popoverContainer
      );
      this.nodes.popoverContainer.style.height = '';
    }

    // Emit closed event (from abstract)
    this.emit(PopoverEvent.Closed);
  };

  /**
   * Constructs the instance
   * @param params - instance parameters
   */
  constructor(params: PopoverParams) {
    const isHintEnabled = !isMobileScreen();

    /**
     * Create a custom Flipper for inline toolbar that only responds to vertical navigation.
     * Left/Right arrow keys should have no effect in the inline toolbar.
     * Navigation is done via Up/Down arrows and Tab/Shift+Tab.
     */
    const inlineFlipper = new Flipper({
      focusedItemClass: popoverItemCls.focused,
      allowedKeys: [
        keyCodes.TAB,
        keyCodes.UP,
        keyCodes.DOWN,
        keyCodes.ENTER,
      ],
    });

    super(
      {
        ...params,
        flipper: inlineFlipper,
      },
      {
        [PopoverItemType.Default]: {
          /**
           * We use button instead of div here to fix bug associated with focus loss (which leads to selection change) on click in safari
           * @todo figure out better way to solve the issue
           */
          wrapperTag: 'button',
          hint: {
            position: 'top',
            alignment: 'center',
            enabled: isHintEnabled,
          },
          /**
           * Inline tools display icons without titles, so no gap is needed
           */
          iconWithGap: false,
          /**
           * Mark items as inline for styling
           */
          isInline: true,
        },
        [PopoverItemType.Html]: {
          hint: {
            position: 'top',
            alignment: 'center',
            enabled: isHintEnabled,
          },
          isInline: true,
        },
        [PopoverItemType.Separator]: {
          isInline: true,
        },
      }
    );

    // Apply inline popover root styles
    this.nodes.popover.className = twMerge(cssInline.popover);

    // Apply inline container styles
    if (this.nodes.popoverContainer) {
      this.nodes.popoverContainer.className = twMerge(
        css.popoverContainer,
        cssInline.popoverContainer
      );
    }

    // Apply inline items container styles
    if (this.nodes.items) {
      this.nodes.items.className = twMerge(css.items, 'flex');
    }

    // Set inline height CSS variables
    this.nodes.popover.style.setProperty('--height', INLINE_HEIGHT);
    this.nodes.popover.style.setProperty('--height-mobile', INLINE_HEIGHT_MOBILE);

    // Mark as inline popover for any remaining CSS (deprecated, but kept for backwards compatibility)
    this.nodes.popover.setAttribute(DATA_ATTR.popoverInline, '');

    this.flipper?.setHandleContentEditableTargets(true);

    /**
     * If active popover item has children, show them.
     * This is needed to display link url text (which is displayed as a nested popover content)
     * once you select <a> tag content in text
     */
    this.items
      .forEach((item) => {
        if (!(item instanceof PopoverItemDefault) && !(item instanceof PopoverItemHtml)) {
          return;
        }

        if (item.hasChildren && item.isChildrenOpen) {
          this.showNestedItems(item);
        }
      });

  }

  /**
   * Returns visible element offset top
   */
  public get offsetLeft(): number {
    if (this.nodes.popoverContainer === null) {
      return 0;
    }

    return this.nodes.popoverContainer.offsetLeft;
  }

  /**
   * Open popover
   */
  public override show(): void {
    super.show();

    // Apply inline opened styles to root
    this.nodes.popover.className = twMerge(cssInline.popover, 'inline-block');

    // Apply inline container opened styles (no animation for inline)
    if (this.nodes.popoverContainer) {
      this.nodes.popoverContainer.className = twMerge(
        css.popoverContainer,
        css.popoverContainerOpened,
        cssInline.popoverContainer,
        'animate-none'
      );

      // Set height based on screen
      const height = isMobileScreen() ? 'var(--height-mobile)' : 'var(--height)';
      this.nodes.popoverContainer.style.height = height;
    }

    const containerRect = this.nestingLevel === 0
      ? this.nodes.popoverContainer?.getBoundingClientRect()
      : undefined;

    if (containerRect !== undefined) {
      const width = `${containerRect.width}px`;
      const heightPx = `${containerRect.height}px`;

      this.nodes.popover.style.setProperty(CSSVariables.InlinePopoverWidth, width);
      this.nodes.popover.style.width = width;
      this.nodes.popover.style.height = heightPx;
    }

    requestAnimationFrame(() => {
      this.flipper?.deactivate();
      this.flipper?.activate(this.flippableElements);
    });
  }

  /**
   * Disable hover event handling.
   * Overrides parent's class behavior
   */
  protected override handleHover(): void {
    return;
  }

  /**
   * Sets CSS variable with position of item near which nested popover should be displayed.
   * Is used to position nested popover right below clicked item
   * @param nestedPopoverEl - nested popover element
   * @param item – item near which nested popover should be displayed
   */
  protected override setTriggerItemPosition(
    nestedPopoverEl: HTMLElement,
    item: PopoverItemDefault
  ): void {
    const itemEl = item.getElement();
    const itemOffsetLeft = itemEl ? itemEl.offsetLeft : 0;
    const totalLeftOffset = this.offsetLeft + itemOffsetLeft;

    nestedPopoverEl.style.setProperty(
      CSSVariables.TriggerItemLeft,
      totalLeftOffset + 'px'
    );
  }

  /**
   * Handles displaying nested items for the item.
   * Overriding in order to add toggling behaviour
   * @param item – item to toggle nested popover for
   */
  protected override showNestedItems(item: PopoverItemDefault | PopoverItemHtml): void {
    if (this.nestedPopoverTriggerItem === item) {
      this.destroyNestedPopoverIfExists();

      this.nestedPopoverTriggerItem = null;

      return;
    }

    super.showNestedItems(item);
  }

  /**
   * Creates and displays nested popover for specified item.
   * Is used only on desktop
   * @param item - item to display nested popover by
   */
  protected showNestedPopoverForItem(item: PopoverItem): PopoverDesktop {
    const nestedPopover = super.showNestedPopoverForItem(item);
    const nestedPopoverEl = nestedPopover.getElement();

    nestedPopover.flipper?.setHandleContentEditableTargets(true);

    // Apply nested inline styles to the nested popover container
    const nestedContainer = nestedPopoverEl.querySelector(`[${DATA_ATTR.popoverContainer}]`);
    if (nestedContainer) {
      nestedContainer.className = twMerge(
        nestedContainer.className,
        'h-fit p-1.5 flex-col',
      );
    }

    // Apply nested inline styles to the items container
    const nestedItems = nestedPopoverEl.querySelector(`[${DATA_ATTR.popoverItems}]`);
    if (nestedItems) {
      nestedItems.className = twMerge(nestedItems.className, 'block w-full');
    }

    /**
     * We need to add data attribute with nesting level, which will help position nested popover.
     * Currently only 'level-1' is used
     */
    nestedPopoverEl.setAttribute(DATA_ATTR.nestedLevel, getNestedLevelAttrValue(nestedPopover.nestingLevel));

    // Apply level-1 specific positioning styles
    if (nestedPopover.nestingLevel === 1 && nestedContainer) {
      nestedContainer.className = twMerge(nestedContainer.className, 'left-0');
      // Set top position based on height
      const topOffset = isMobileScreen() ? 'calc(var(--height-mobile) + 3px)' : 'calc(var(--height) + 3px)';
      nestedContainer.style.top = topOffset;
    }

    return nestedPopover;
  }

  /**
   * Overrides default item click handling.
   * Helps to close nested popover once other item is clicked.
   * @param item - clicked item
   */
  protected override handleItemClick(item: PopoverItem): void {
    if (item !== this.nestedPopoverTriggerItem) {
      /**
       * In case tool had special handling for toggling button (like link tool which modifies selection)
       * we need to call handleClick on nested popover trigger item
       */
      this.nestedPopoverTriggerItem?.handleClick();

      /**
       * Then close the nested popover
       */
      super.destroyNestedPopoverIfExists();
    }

    super.handleItemClick(item);
  }

}
