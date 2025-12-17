import Flipper from '../../flipper';
import { PopoverAbstract } from './popover-abstract';
import type { PopoverItem, PopoverItemRenderParamsMap } from './components/popover-item';
import { PopoverItemSeparator, css as popoverItemCls } from './components/popover-item';
import type { PopoverParams } from '@/types/utils/popover/popover';
import { PopoverEvent } from '@/types/utils/popover/popover-event';
import { keyCodes } from '../../utils';
import { CSSVariables } from './popover.const';
import { DATA_ATTR } from '../../constants/data-attributes';
import type { SearchableItem } from './components/search-input';
import { SearchInput, SearchInputEvent } from './components/search-input';
import { PopoverItemDefault } from './components/popover-item';
import { PopoverItemHtml } from './components/popover-item/popover-item-html/popover-item-html';

/**
 * Desktop popover.
 * On desktop devices popover behaves like a floating element. Nested popover appears at right or left side.
 * @internal
 * @todo support rtl for nested popovers and search
 */
export class PopoverDesktop extends PopoverAbstract {
  /**
   * Flipper - module for keyboard iteration between elements
   */
  public flipper: Flipper | undefined;

  /**
   * Popover nesting level. 0 value means that it is a root popover
   */
  public nestingLevel = 0;

  /**
   * Reference to nested popover if exists.
   * Undefined by default, PopoverDesktop when exists and null after destroyed.
   */
  protected nestedPopover: PopoverDesktop | undefined | null;

  /**
   * Item nested popover is displayed for
   */
  protected nestedPopoverTriggerItem: PopoverItem | null = null;

  /**
   * Last hovered item inside popover.
   * Is used to determine if cursor is moving inside one item or already moved away to another one.
   * Helps prevent reopening nested popover while cursor is moving inside one item area.
   */
  private previouslyHoveredItem: PopoverItem | null = null;

  /**
   * Element of the page that creates 'scope' of the popover.
   * If possible, popover will not cross specified element's borders when opening.
   */
  private scopeElement: HTMLElement = document.body;

  /**
   * Element relative to which the popover should be positioned
   */
  private trigger: HTMLElement | undefined;

  /**
   * Popover size cache
   */
  private _size: { height: number; width: number } | undefined;

  /**
   * Construct the instance
   * @param params - popover params
   * @param itemsRenderParams – popover item render params.
   * The parameters that are not set by user via popover api but rather depend on technical implementation
   */
  constructor(params: PopoverParams, itemsRenderParams?: PopoverItemRenderParamsMap) {
    super(params, itemsRenderParams);

    if (params.trigger) {
      this.trigger = params.trigger;
    }

    if (params.nestingLevel !== undefined) {
      this.nestingLevel = params.nestingLevel;
    }

    if (this.nestingLevel > 0) {
      this.nodes.popover.setAttribute(DATA_ATTR.nested, 'true');
    }

    if (params.scopeElement !== undefined) {
      this.scopeElement = params.scopeElement;
    }

    if (this.nodes.popoverContainer !== null) {
      this.listeners.on(this.nodes.popoverContainer, 'mouseover', (event: Event) => this.handleHover(event));
    }

    if (params.searchable) {
      this.addSearch();
    }

    if (params.flippable === false) {
      return;
    }

    if (params.flipper !== undefined) {
      params.flipper.deactivate();
      params.flipper.removeOnFlip(this.onFlip);
      this.flipper = params.flipper;
    } else {
      this.flipper = new Flipper({
        items: this.flippableElements,
        focusedItemClass: popoverItemCls.focused,
        allowedKeys: [
          keyCodes.TAB,
          keyCodes.UP,
          keyCodes.DOWN,
          keyCodes.ENTER,
          keyCodes.RIGHT,
          keyCodes.LEFT,
        ],
        onArrowLeft: params.onNavigateBack,
      });
    }

    this.flipper.onFlip(this.onFlip);
  }

  /**
   * Returns true if some item inside popover is focused
   */
  public hasFocus(): boolean {
    if (this.flipper === undefined) {
      return false;
    }

    return this.flipper.hasFocus();
  }

  /**
   * Scroll position inside items container of the popover
   */
  public get scrollTop(): number {
    if (this.nodes.items === null) {
      return 0;
    }

    return this.nodes.items.scrollTop;
  }

  /**
   * Returns visible element offset top
   */
  public get offsetTop(): number {
    if (this.nodes.popoverContainer === null) {
      return 0;
    }

    return this.nodes.popoverContainer.offsetTop;
  }

  /**
   * Open popover
   */
  public show(): void {
    const mountTarget = this.getMountElement();

    if (this.trigger && mountTarget) {
      document.body.appendChild(mountTarget);
    }

    if (this.trigger) {
      const { top, left } = this.calculatePosition();
      this.nodes.popover.style.position = 'absolute';
      this.nodes.popover.style.top = `${top}px`;
      this.nodes.popover.style.left = `${left}px`;
      this.nodes.popover.style.setProperty(CSSVariables.PopoverTop, '0px');
      this.nodes.popover.style.setProperty(CSSVariables.PopoverLeft, '0px');
    }

    this.nodes.popover.style.setProperty(CSSVariables.PopoverHeight, this.size.height + 'px');

    if (!this.trigger && !this.shouldOpenBottom) {
      this.setOpenTop(true);
      // Apply open-top positioning (moved from popover.css)
      this.nodes.popover.style.setProperty(CSSVariables.PopoverTop, 'calc(-1 * (0.5rem + var(--popover-height)))');
    }

    if (!this.trigger && !this.shouldOpenRight) {
      this.setOpenLeft(true);
      // Apply open-left positioning (moved from popover.css)
      this.nodes.popover.style.setProperty(CSSVariables.PopoverLeft, 'calc(-1 * var(--width) + 100%)');
    }

    super.show();
    this.flipper?.activate(this.flippableElements);

    // Focus the first item: search field if present, otherwise first menu item
    requestAnimationFrame(() => {
      this.focusInitialElement();
    });
  }

  /**
   * Focuses the initial element when popover is shown.
   * Focuses search field if present, otherwise first menu item.
   */
  private focusInitialElement(): void {
    if (this.search) {
      this.search.focus();

      return;
    }

    this.flipper?.focusFirst();
  }

  /**
   * Calculates position for the popover
   */
  private calculatePosition(): { top: number; left: number } {
    if (!this.trigger) {
      return {
        top: 0,
        left: 0,
      };
    }

    const triggerRect = this.trigger.getBoundingClientRect();
    const popoverRect = this.size;
    const windowWidth = window.innerWidth;
    const windowHeight = window.innerHeight;
    const offset = 8;

    const initialTop = triggerRect.bottom + offset + window.scrollY;
    const shouldFlipTop = (triggerRect.bottom + offset + popoverRect.height > windowHeight + window.scrollY) &&
      (triggerRect.top - offset - popoverRect.height > window.scrollY);
    const top = shouldFlipTop ? triggerRect.top - offset - popoverRect.height + window.scrollY : initialTop;

    const initialLeft = triggerRect.left + window.scrollX;
    const shouldFlipLeft = initialLeft + popoverRect.width > windowWidth + window.scrollX;
    const left = shouldFlipLeft ? Math.max(0, triggerRect.right - popoverRect.width + window.scrollX) : initialLeft;

    return {
      top,
      left,
    };
  }

  /**
   * Closes popover
   */
  public hide = (): void => {
    super.hide();

    this.destroyNestedPopoverIfExists();

    this.flipper?.deactivate();

    this.previouslyHoveredItem = null;
  };

  /**
   * Clears memory
   */
  public destroy(): void {
    this.hide();
    super.destroy();
  }

  /**
   * Checks if popover contains the node.
   * Overridden to check nested popover as well.
   * @param node - node to check
   */
  public override hasNode(node: Node): boolean {
    if (super.hasNode(node)) {
      return true;
    }

    if (this.nestedPopover !== undefined && this.nestedPopover !== null) {
      return this.nestedPopover.hasNode(node);
    }

    return false;
  }

  /**
   * Handles displaying nested items for the item.
   * @param item – item to show nested popover for
   */
  protected override showNestedItems(item: PopoverItem): void {
    if (this.nestedPopover !== null && this.nestedPopover !== undefined) {
      return;
    }

    this.nestedPopoverTriggerItem = item;

    this.showNestedPopoverForItem(item);
  }

  /**
   * Handles hover events inside popover items container
   * @param event - hover event data
   */
  protected handleHover(event: Event): void {
    const item = this.getTargetItem(event);

    if (item === undefined) {
      return;
    }

    if (this.previouslyHoveredItem === item) {
      return;
    }

    this.destroyNestedPopoverIfExists();

    this.previouslyHoveredItem = item;

    if (!item.hasChildren) {
      return;
    }

    this.showNestedPopoverForItem(item);
  }

  /**
   * Sets CSS variable with position of item near which nested popover should be displayed.
   * Is used for correct positioning of the nested popover
   * @param nestedPopoverEl - nested popover element
   * @param item – item near which nested popover should be displayed
   */
  protected setTriggerItemPosition(nestedPopoverEl: HTMLElement, item: PopoverItem): void {
    const itemEl = item.getElement();
    const itemOffsetTop = (itemEl ? itemEl.offsetTop : 0) - this.scrollTop;
    const topOffset = this.offsetTop + itemOffsetTop;

    const actualPopoverEl = nestedPopoverEl.querySelector(`[${DATA_ATTR.popover}]`) as HTMLElement | null ?? nestedPopoverEl;

    actualPopoverEl.style.setProperty(CSSVariables.TriggerItemTop, topOffset + 'px');
  }

  /**
   * Destroys existing nested popover
   */
  protected destroyNestedPopoverIfExists(): void {
    if (this.nestedPopover === undefined || this.nestedPopover === null) {
      return;
    }

    const triggerItemElement = this.nestedPopoverTriggerItem?.getElement();

    this.nestedPopover.off(PopoverEvent.ClosedOnActivate, this.hide);
    this.nestedPopover.hide();
    this.nestedPopover.destroy();
    this.nestedPopover.getElement().remove();
    this.nestedPopover = null;
    this.flipper?.activate(this.flippableElements);
    // Focus the trigger item synchronously to ensure keyboard events work immediately
    this.focusAfterNestedPopoverClose(triggerItemElement);

    this.nestedPopoverTriggerItem?.onChildrenClose();
    // Reset trigger item so clicking the same item again will open the nested popover
    this.nestedPopoverTriggerItem = null;
  }

  /**
   * Focuses the appropriate item after nested popover closes.
   * Focuses the item that opened the nested popover, or falls back to first item.
   * @param triggerItemElement - element that triggered the nested popover
   */
  private focusAfterNestedPopoverClose(triggerItemElement: HTMLElement | null | undefined): void {
    if (!triggerItemElement || !this.flipper) {
      this.flipper?.focusFirst();

      return;
    }

    const triggerIndex = this.flippableElements.indexOf(triggerItemElement);

    if (triggerIndex !== -1) {
      // Don't skip next Tab - user expects Tab to move to next item after closing nested popover
      this.flipper.focusItem(triggerIndex, { skipNextTab: false });

      return;
    }

    this.flipper.focusFirst();
  }

  /**
   * Creates and displays nested popover for specified item.
   * Is used only on desktop
   * @param item - item to display nested popover by
   */
  protected showNestedPopoverForItem(item: PopoverItem): PopoverDesktop {
    this.nestedPopover = new PopoverDesktop({
      searchable: item.isChildrenSearchable,
      items: item.children,
      nestingLevel: this.nestingLevel + 1,
      flippable: item.isChildrenFlippable,
      messages: this.messages,
      onNavigateBack: this.destroyNestedPopoverIfExists.bind(this),
    });

    item.onChildrenOpen();

    /**
     * Close nested popover when item with 'closeOnActivate' property set was clicked
     * parent popover should also be closed
     */
    this.nestedPopover.on(PopoverEvent.ClosedOnActivate, this.hide);

    const nestedPopoverEl = this.nestedPopover.getMountElement();
    const actualNestedPopoverEl = this.nestedPopover.getElement();

    this.nodes.popover.appendChild(nestedPopoverEl);

    this.setTriggerItemPosition(nestedPopoverEl, item);

    /* We need nesting level value in CSS to calculate offset left for nested popover */
    /* Set on the actual popover element so it's available for --popover-left calculation */
    actualNestedPopoverEl.style.setProperty(CSSVariables.NestingLevel, this.nestedPopover.nestingLevel.toString());

    // Apply nested popover positioning (moved from popover.css)
    this.applyNestedPopoverPositioning(nestedPopoverEl);

    this.nestedPopover.show();
    this.flipper?.deactivate();

    return this.nestedPopover;
  }

  /**
   * Applies positioning styles to nested popover container.
   * This replaces CSS selectors like [data-blok-nested] [data-blok-popover-container]
   * @param nestedPopoverEl - the nested popover element (mount element)
   */
  private applyNestedPopoverPositioning(nestedPopoverEl: HTMLElement): void {
    const nestedContainer = nestedPopoverEl.querySelector(`[${DATA_ATTR.popoverContainer}]`) as HTMLElement | null;

    if (!nestedContainer) {
      return;
    }

    const actualPopoverEl = nestedPopoverEl.querySelector(`[${DATA_ATTR.popover}]`) as HTMLElement | null ?? nestedPopoverEl;

    // Check if parent popover has openTop or openLeft state
    const isParentOpenTop = this.nodes.popover.hasAttribute(DATA_ATTR.popoverOpenTop);
    const isParentOpenLeft = this.nodes.popover.hasAttribute(DATA_ATTR.popoverOpenLeft);

    // Apply position: absolute for nested container
    nestedContainer.style.position = 'absolute';

    // Calculate --popover-left based on nesting level and parent open direction
    // Set on the actual popover element to override its default value
    if (isParentOpenLeft) {
      // Position to the left
      actualPopoverEl.style.setProperty(CSSVariables.PopoverLeft, 'calc(-1 * (var(--nesting-level) + 1) * var(--width) + 100%)');
    } else {
      // Position to the right
      actualPopoverEl.style.setProperty(CSSVariables.PopoverLeft, 'calc(var(--nesting-level) * (var(--width) - var(--nested-popover-overlap)))');
    }

    // Calculate top position based on parent open direction
    if (isParentOpenTop) {
      // Open upward
      nestedContainer.style.top = 'calc(var(--trigger-item-top) - var(--popover-height) + var(--item-height) + 0.5rem + var(--nested-popover-overlap))';
    } else {
      // Open downward
      nestedContainer.style.top = 'calc(var(--trigger-item-top) - var(--nested-popover-overlap))';
    }
  }

  /**
   * Checks if popover should be opened bottom.
   * It should happen when there is enough space below or not enough space above
   */
  private get shouldOpenBottom(): boolean {
    if (this.nodes.popover === undefined || this.nodes.popover === null) {
      return false;
    }
    const popoverRect = this.nodes.popoverContainer.getBoundingClientRect();
    const scopeElementRect = this.scopeElement.getBoundingClientRect();
    const popoverHeight = this.size.height;
    const popoverPotentialBottomEdge = popoverRect.top + popoverHeight;
    const popoverPotentialTopEdge = popoverRect.top - popoverHeight;
    const bottomEdgeForComparison = Math.min(window.innerHeight, scopeElementRect.bottom);

    return popoverPotentialTopEdge < scopeElementRect.top || popoverPotentialBottomEdge <= bottomEdgeForComparison;
  }

  /**
   * Checks if popover should be opened left.
   * It should happen when there is enough space in the right or not enough space in the left
   */
  private get shouldOpenRight(): boolean {
    if (this.nodes.popover === undefined || this.nodes.popover === null) {
      return false;
    }

    const popoverRect = this.nodes.popover.getBoundingClientRect();
    const scopeElementRect = this.scopeElement.getBoundingClientRect();
    const popoverWidth = this.size.width;
    const popoverPotentialRightEdge = popoverRect.right + popoverWidth;
    const popoverPotentialLeftEdge = popoverRect.left - popoverWidth;
    const rightEdgeForComparison = Math.min(window.innerWidth, scopeElementRect.right);

    return popoverPotentialLeftEdge < scopeElementRect.left || popoverPotentialRightEdge <= rightEdgeForComparison;
  }

  /**
   * Helps to calculate size of popover that is only resolved when popover is displayed on screen.
   * Renders invisible clone of popover to get actual values.
   */
  public get size(): { height: number; width: number } {
    if (this._size) {
      return this._size;
    }

    const size = {
      height: 0,
      width: 0,
    };

    if (this.nodes.popover === null) {
      return size;
    }

    const popoverClone = this.nodes.popover.cloneNode(true) as HTMLElement;

    popoverClone.style.visibility = 'hidden';
    popoverClone.style.position = 'absolute';
    popoverClone.style.top = '-1000px';

    popoverClone.setAttribute(DATA_ATTR.popoverOpened, 'true');
    popoverClone.querySelector(`[${DATA_ATTR.nested}]`)?.remove();
    document.body.appendChild(popoverClone);

    const container = popoverClone.querySelector(`[${DATA_ATTR.popoverContainer}]`) as HTMLElement;

    size.height = container.offsetHeight;
    size.width = container.offsetWidth;
    popoverClone.remove();

    this._size = size;

    return size;
  }

  /**
   * Returns list of elements available for keyboard navigation.
   */
  protected get flippableElements(): HTMLElement[] {
    const result = this.items.flatMap(item => {
      return this.getFlippableElementsForItem(item);
    }).filter((item): item is HTMLElement => item !== undefined && item !== null);

    return result;
  }

  /**
   * Gets flippable elements for a single item.
   * @param item - popover item to get elements from
   * @returns array of HTML elements for keyboard navigation
   */
  private getFlippableElementsForItem(item: PopoverItem): HTMLElement[] {
    if (item instanceof PopoverItemHtml) {
      const element = item.getElement();

      return element ? [element] : [];
    }

    if (!(item instanceof PopoverItemDefault)) {
      return [];
    }

    if (item.isDisabled) {
      return [];
    }

    const element = item.getElement();

    return element ? [ element ] : [];
  }

  /**
   * Called on flipper navigation
   */
  private onFlip = (): void => {
    const focusedItem = this.itemsDefault.find(item => item.isFocused);

    focusedItem?.onFocus();
  };

  /**
   * Adds search to the popover
   */
  private addSearch(): void {
    this.search = new SearchInput({
      items: this.itemsDefault,
      placeholder: this.messages.search,
    });

    this.search.on(SearchInputEvent.Search, this.onSearch);

    const searchElement = this.search.getElement();

    searchElement.classList.add('mb-1.5');

    this.nodes.popoverContainer.insertBefore(searchElement, this.nodes.popoverContainer.firstChild);
  }

  /**
   * Handles input inside search field
   * @param data - search input event data
   * @param data.query - search query text
   * @param data.items - search results
   */
  private onSearch = (data: { query: string, items: SearchableItem[] }): void => {
    const isEmptyQuery = data.query === '';
    const isNothingFound = data.items.length === 0;

    this.items
      .forEach((item) => {
        const isDefaultItem = item instanceof PopoverItemDefault;
        const isSeparatorOrHtml = item instanceof PopoverItemSeparator || item instanceof PopoverItemHtml;
        const isHidden = isDefaultItem
          ? !data.items.includes(item)
          : isSeparatorOrHtml && (isNothingFound || !isEmptyQuery);

        item.toggleHidden(isHidden);
      });
    this.toggleNothingFoundMessage(isNothingFound);

    /** List of elements available for keyboard navigation considering search query applied */
    const flippableElements = data.query === '' ? this.flippableElements : data.items.map(item => (item as PopoverItem).getElement());

    if (this.flipper?.isActivated) {
      /** Update flipper items with only visible */
      this.flipper.deactivate();
      this.flipper.activate(flippableElements as HTMLElement[]);
    }
  };
}
