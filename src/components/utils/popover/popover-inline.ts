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
   * Inline-specific close cleanup, run by the base
   * {@link PopoverAbstract.hide} via the `onHide` template-method hook. The
   * inline toolbar previously re-implemented `hide()` as an arrow field and
   * forgot base steps (it never removed `data-blok-popover-opened`, so
   * `isShown` stayed true, and it skipped reel/desktop-state resets). Extending
   * the base hide path through this hook keeps that base cleanup while still
   * restoring the inline styles.
   */
  protected override onHide(): void {
    // Desktop cleanup (nested popover teardown, flipper deactivate, etc.).
    super.onHide();

    // Reset to closed inline styles
    this.nodes.popover.className = twMerge(cssInline.popover);
    if (this.nodes.popoverContainer) {
      this.nodes.popoverContainer.className = twMerge(
        css.popoverContainer,
        cssInline.popoverContainer
      );
      this.nodes.popoverContainer.style.height = '';
    }
  }

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
        items: params.items.map(item => 'children' in item && item.children !== undefined
          ? { ...item, children: { ...item.children, placement: item.children.placement ?? 'below' } }
          : item),
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

    // Keep configured tool order while allowing narrow screens to wrap.
    if (this.nodes.items) {
      this.nodes.items.className = twMerge(css.items, cssInline.items);
    }
    this.styleConvertControl();

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
   * Conversion keeps its label and fixed icon box beside the icon-only tools.
   */
  private styleConvertControl(): void {
    const root = this.nodes.popover;

    for (const convertEl of root.querySelectorAll(`[${DATA_ATTR.itemName}="convert-to"]`)) {
      // group/convert is named so only row hover, not whole-card hover,
      // drives the chevron motion below.
      convertEl.className = twMerge(convertEl.className, 'w-auto max-w-full min-w-0 py-2 gap-2 group/convert mobile:basis-full');

      for (const icon of convertEl.querySelectorAll('[data-blok-testid="popover-item-icon"]')) {
        icon.className = popoverItemCls.icon;
      }

      convertEl
        .querySelectorAll('[data-blok-testid="popover-item-title"]')
        .forEach((title) => title.classList.add('font-medium'));

      convertEl
        .querySelectorAll('[data-blok-testid="popover-item-chevron-right"]')
        .forEach((chevron) => chevron.classList.add(
          'ml-auto',
          'rotate-90',
          'text-text-secondary',
          'transition-transform',
          'duration-150',
          'ease-out',
          'can-hover:group-hover/convert:translate-y-0.5',
          'group-data-[blok-popover-item-children-open]/convert:translate-y-0.5',
          'group-data-[blok-popover-item-children-open]/convert:text-text-primary'
        ));
    }

    root
      .querySelectorAll('[data-blok-testid="popover-item-separator"]')
      .forEach((separator) => separator.setAttribute('aria-orientation', 'vertical'));
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
        cssInline.popoverContainerOpened
      );

      // Measure wrapped rows rather than assuming a single-row height.
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

    queueMicrotask(() => {
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
   * Disable mouse-leave event handling.
   * Inline toolbar uses click-to-toggle for nested popovers, not hover.
   */
  protected override handleMouseLeave(): void {
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
      // Toggling shut is a click, so the trigger must not keep the focus cursor.
      this.destroyNestedPopoverIfExists(false);

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
      // No top padding: the nested item menu's first item sits flush to the top edge,
      // matching the desktop popover. px/pb come from the shared opened state.
      nestedContainer.className = twMerge(
        nestedContainer.className,
        'h-fit px-1.5 pb-0 flex-col',
      );
    }

    // Apply nested inline styles to the items container. No explicit width:
    // flex stretch sizes the element including its scrollbar-gutter margin
    // offsets, whereas `w-full` pins it to the container content box and
    // strands the scrollbar 8px from the popover edge instead of 2px.
    const nestedItems = nestedPopoverEl.querySelector(`[${DATA_ATTR.popoverItems}]`);
    if (nestedItems) {
      nestedItems.className = twMerge(nestedItems.className, 'block');
    }

    /**
     * We need to add data attribute with nesting level, which will help position nested popover.
     * Currently only 'level-1' is used
     */
    nestedPopoverEl.setAttribute(DATA_ATTR.nestedLevel, getNestedLevelAttrValue(nestedPopover.nestingLevel));

    // The shared desktop placement clamps dropdowns to the viewport.

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
       * Then close the nested popover. This path is a click on another tool,
       * so the trigger must not keep the focus cursor.
       */
      super.destroyNestedPopoverIfExists(false);
    }

    super.handleItemClick(item);
  }

}
