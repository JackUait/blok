import { DATA_ATTR } from '../../constants/data-attributes';
import { Flipper } from '../../flipper';
import { keyCodes } from '../../utils';

import type { PopoverItem, PopoverItemRenderParamsMap } from './components/popover-item';
import { PopoverItemSeparator, css as popoverItemCls, PopoverItemDefault, PopoverItemType } from './components/popover-item';
import type { PopoverItemParams } from '@/types/utils/popover/popover-item';
import { PopoverItemHtml } from './components/popover-item/popover-item-html/popover-item-html';
import type { SearchableItem } from './components/search-input';
import { SearchInput, SearchInputEvent, scoreSearchMatch } from './components/search-input';
import { PopoverAbstract } from './popover-abstract';
import { CSSVariables, css as popoverCss } from './popover.const';
import { resolvePosition } from './popover-position';
import { twMerge } from '../tw';

import type { PopoverParams } from '@/types/utils/popover/popover';
import { PopoverEvent } from '@/types/utils/popover/popover-event';


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
   * Optional element whose left edge is used for horizontal positioning
   * instead of the trigger's left edge.
   */
  private leftAlignElement: HTMLElement | undefined;

  /**
   * Updates the element whose left edge is used for horizontal positioning.
   * @param element - new element to align against, or undefined to fall back to trigger
   */
  public setLeftAlignElement(element: HTMLElement | undefined): void {
    this.leftAlignElement = element;
  }

  /**
   * Popover size cache
   */
  private _size: { height: number; width: number } | undefined;

  /**
   * Original order of item elements in the popover container.
   * Cached on first search so we can restore order when query is cleared.
   */
  private originalItemOrder: Element[] | undefined;

  /**
   * Cache of promoted items built from nested children.
   * Built once on first non-empty search, destroyed on clear/hide/destroy.
   */
  private promotedItemCache: {
    items: PopoverItemDefault[];
    parentChains: Map<PopoverItemDefault, string[]>;
  } | null = null;

  /**
   * Temporary group separator elements injected during search.
   */
  private promotedSeparators: HTMLElement[] = [];

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

    if (params.leftAlignElement) {
      this.leftAlignElement = params.leftAlignElement;
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
      this.listeners.on(this.nodes.popoverContainer, 'mouseleave', (event: Event) => this.handleMouseLeave(event));
    }

    if (params.searchable) {
      this.addSearch();
    }

    if (params.flippable === false) {
      return;
    }

    const existingFlipper = params.flipper;
    if (existingFlipper !== undefined) {
      existingFlipper.deactivate();
      existingFlipper.removeOnFlip(this.onFlip);
      this.flipper = existingFlipper;
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
        handleContentEditableTargets: params.handleContentEditableNavigation,
      });
    }

    this.flipper?.onFlip(this.onFlip);
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
   * Toggles hidden state of all items matching the given name.
   * Invalidates the cached size so the next access re-measures the popover.
   * @param name - name of the items to toggle
   * @param isHidden - true to hide, false to show
   */
  public override toggleItemHiddenByName(name: string, isHidden: boolean): void {
    super.toggleItemHiddenByName(name, isHidden);

    this._size = undefined;
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
      const { top, left, openTop, openLeft } = this.calculatePosition();
      this.nodes.popover.style.position = 'absolute';
      this.nodes.popover.style.top = `${top}px`;
      this.nodes.popover.style.left = `${left}px`;
      this.nodes.popover.style.setProperty(CSSVariables.PopoverTop, '0px');
      this.nodes.popover.style.setProperty(CSSVariables.PopoverLeft, '0px');
      this.setOpenTop(openTop);
      this.setOpenLeft(openLeft);
    }

    const measuredSize = this.size;

    this.nodes.popover.style.setProperty(CSSVariables.PopoverHeight, measuredSize.height + 'px');

    if (this.params.width === undefined || this.params.width === 'auto') {
      const minWidth = this.params.minWidth !== undefined ? parseFloat(this.params.minWidth) : 0;
      const width = Math.max(measuredSize.width, minWidth);

      this.nodes.popover.style.setProperty('--width', width + 'px');
    }

    if (!this.trigger) {
      const containerRect = this.nodes.popoverContainer.getBoundingClientRect();
      const { openTop, openLeft } = resolvePosition({
        anchor: containerRect,
        popoverSize: measuredSize,
        scopeBounds: this.scopeElement.getBoundingClientRect(),
        viewportSize: { width: window.innerWidth, height: window.innerHeight },
        scrollOffset: { x: window.scrollX, y: window.scrollY },
        offset: 0,
      });

      if (openTop) {
        this.setOpenTop(true);
        this.nodes.popover.style.setProperty(CSSVariables.PopoverTop, 'calc(-1 * (0.5rem + var(--popover-height)))');
      }

      if (openLeft) {
        this.setOpenLeft(true);
        this.nodes.popover.style.setProperty(CSSVariables.PopoverLeft, 'calc(-1 * var(--width) + 100%)');
      }
    }

    super.show();
    this.flipper?.activate(this.flippableElements);

    // Focus the first item: search field if present, otherwise first menu item
    queueMicrotask(() => {
      this.focusInitialElement();
    });
  }

  /**
   * Focuses the initial element when popover is shown.
   * When a search field is present, it receives focus so the user can type immediately.
   * When autoFocusFirstItem is false, no item is pre-focused — focus only appears
   * after the user begins keyboard navigation.
   */
  private focusInitialElement(): void {
    if (this.search) {
      this.search.focus();

      return;
    }

    if (this.params.autoFocusFirstItem === false) {
      return;
    }

    this.flipper?.focusItem(0, { skipNextTab: true });
  }

  /**
   * Updates the popover position dynamically.
   * Used when the trigger position changes or when positioning at caret location.
   * @param position - new DOMRect position for the popover
   */
  public updatePosition(position: DOMRect): void {
    this.params.position = position;

    // Recalculate and apply position if already shown
    if (this.nodes.popover.hasAttribute('data-blok-popover-opened')) {
      const { top, left, openTop, openLeft } = this.calculatePosition();

      this.nodes.popover.style.top = `${top}px`;
      this.nodes.popover.style.left = `${left}px`;
      this.setOpenTop(openTop);
      this.setOpenLeft(openLeft);
    }
  }

  /**
   * Calculates position for the popover
   */
  private calculatePosition(): { top: number; left: number; openTop: boolean; openLeft: boolean } {
    const rect = this.params.position ?? this.trigger?.getBoundingClientRect();

    if (!rect) {
      return { top: 0, left: 0, openTop: false, openLeft: false };
    }

    return resolvePosition({
      anchor: rect,
      popoverSize: this.size,
      scopeBounds: this.scopeElement.getBoundingClientRect(),
      viewportSize: { width: window.innerWidth, height: window.innerHeight },
      scrollOffset: { x: window.scrollX, y: window.scrollY },
      offset: 8,
      leftAlignRect: this.leftAlignElement?.getBoundingClientRect(),
    });
  }

  /**
   * Closes popover
   */
  public hide = (): void => {
    this.cleanupPromotedItems();
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

    /**
     * If the pointer moved into the nested popover (e.g. user is about to click
     * an item in the sub-menu), do not destroy it.
     */
    if (
      this.nestedPopover !== undefined &&
      this.nestedPopover !== null &&
      event.target instanceof Node &&
      this.nestedPopover.hasNode(event.target)
    ) {
      return;
    }

    this.destroyNestedPopoverIfExists(false);

    this.previouslyHoveredItem = item;

    if (!item.hasChildren) {
      return;
    }

    this.showNestedPopoverForItem(item);
  }

  /**
   * Handles mouse leaving the popover container.
   * Destroys nested popover unless the mouse moved into it.
   * @param event - mouseleave event
   */
  protected handleMouseLeave(event: Event): void {
    const mouseEvent = event as MouseEvent;
    const relatedTarget = mouseEvent.relatedTarget;

    if (
      relatedTarget instanceof Node &&
      this.nestedPopover !== undefined &&
      this.nestedPopover !== null &&
      this.nestedPopover.hasNode(relatedTarget)
    ) {
      return;
    }

    this.destroyNestedPopoverIfExists(false);
    this.previouslyHoveredItem = null;
  }

  /**
   * Retrieves popover item that is the target of the specified event.
   * Overridden to include promoted items from recursive search.
   * @param event - event to retrieve popover item from
   */
  protected override getTargetItem(event: Event): PopoverItemDefault | PopoverItemHtml | undefined {
    const allItems = this.promotedItemCache !== null
      ? [...this.items, ...this.promotedItemCache.items]
      : this.items;

    return allItems
      .filter((item): item is PopoverItemDefault | PopoverItemHtml =>
        item instanceof PopoverItemDefault || item instanceof PopoverItemHtml
      )
      .find(item => {
        const itemEl = item.getElement();

        if (itemEl === null) {
          return false;
        }

        return event.composedPath().includes(itemEl);
      });
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

    const queriedPopoverEl = nestedPopoverEl.querySelector(`[${DATA_ATTR.popover}]`);
    const actualPopoverEl: HTMLElement = queriedPopoverEl instanceof HTMLElement ? queriedPopoverEl : nestedPopoverEl;

    actualPopoverEl.style.setProperty(CSSVariables.TriggerItemTop, topOffset + 'px');
  }

  /**
   * Destroys existing nested popover
   * @param restoreFocus - whether to restore keyboard focus to the trigger item after closing.
   * Should be true for keyboard-driven closes (e.g. ArrowLeft/Escape), false for mouse-driven closes
   * to avoid leaving a stale focus highlight on the trigger item.
   */
  protected destroyNestedPopoverIfExists(restoreFocus = true): void {
    if (this.nestedPopover === undefined || this.nestedPopover === null) {
      return;
    }

    const triggerItemElement = this.nestedPopoverTriggerItem?.getElement();
    const elementToRemove = this.nestedPopover.getElement();

    this.nestedPopover.off(PopoverEvent.ClosedOnActivate, this.hide);
    this.nestedPopover.hide();
    this.nestedPopover.destroy();
    elementToRemove.remove();
    this.nestedPopover = null;
    this.flipper?.activate(this.flippableElements);

    if (restoreFocus) {
      // Focus the trigger item synchronously to ensure keyboard events work immediately
      this.focusAfterNestedPopoverClose(triggerItemElement);
    }

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
    const handleContentEditable = this.flipper?.getHandleContentEditableTargets();

    this.nestedPopover = new PopoverDesktop({
      searchable: item.isChildrenSearchable,
      items: item.children,
      nestingLevel: this.nestingLevel + 1,
      flippable: item.isChildrenFlippable,
      messages: this.messages,
      onNavigateBack: this.destroyNestedPopoverIfExists.bind(this),
      width: item.childrenWidth,
      minWidth: item.childrenMinWidth,
      handleContentEditableNavigation: handleContentEditable,
      autoFocusFirstItem: this.params.autoFocusFirstItem,
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

    /**
     * Refresh trigger item's active state after any click inside the nested popover.
     * This handles the case where a child action (e.g. color swatch click) changes
     * the trigger tool's active state but the parent popover is not aware of it.
     */
    this.listeners.on(nestedPopoverEl, 'click', () => {
      if (this.nestedPopoverTriggerItem !== null) {
        this.refreshItemActiveState(this.nestedPopoverTriggerItem);
      }
    });

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
    const nestedContainerEl = nestedPopoverEl.querySelector(`[${DATA_ATTR.popoverContainer}]`);
    if (!(nestedContainerEl instanceof HTMLElement)) {
      return;
    }
    const nestedContainer = nestedContainerEl;

    const queriedPopoverEl = nestedPopoverEl.querySelector(`[${DATA_ATTR.popover}]`);
    const actualPopoverEl: HTMLElement = queriedPopoverEl instanceof HTMLElement ? queriedPopoverEl : nestedPopoverEl;

    // Check if parent popover has openTop or openLeft state
    const _isParentOpenTop = this.nodes.popover.hasAttribute(DATA_ATTR.popoverOpenTop);
    const isParentOpenLeft = this.nodes.popover.hasAttribute(DATA_ATTR.popoverOpenLeft);

    // Apply position: absolute for nested container
    nestedContainer.style.position = 'absolute';

    // Get parent width - use computed width if --width resolves to 'auto'
    const parentWidth = this.params.width === undefined || this.params.width === 'auto'
      ? `${this.nodes.popoverContainer.offsetWidth}px`
      : 'var(--width)';

    // Calculate --popover-left based on nesting level and parent open direction
    // Set on the actual popover element to override its default value
    if (isParentOpenLeft) {
      // Position to the left
      actualPopoverEl.style.setProperty(CSSVariables.PopoverLeft, `calc(-1 * (var(--nesting-level) + 1) * ${parentWidth} + 100%)`);
    } else {
      // Position to the right
      actualPopoverEl.style.setProperty(CSSVariables.PopoverLeft, `calc(var(--nesting-level) * (${parentWidth} - var(--nested-popover-overlap)))`);
    }

    // Center nested popover vertically on the trigger item
    nestedContainer.style.top = 'calc(var(--trigger-item-top) - var(--popover-height) / 2 + var(--item-height) / 2)';
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

    const container = popoverClone.querySelector(`[${DATA_ATTR.popoverContainer}]`) as HTMLElement;

    container.className = twMerge(container.className, popoverCss.popoverContainerOpened);

    document.body.appendChild(popoverClone);

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
   * Builds cache of PopoverItemDefault instances from nested children.
   * Recursively walks the item tree to arbitrary depth.
   * Each cached item is mapped to its parent chain for group labeling.
   */
  private buildPromotedItemCache(): { items: PopoverItemDefault[]; parentChains: Map<PopoverItemDefault, string[]> } {
    const cache = {
      items: [] as PopoverItemDefault[],
      parentChains: new Map<PopoverItemDefault, string[]>(),
    };

    this.collectPromotedChildren(this.items, [], cache);

    return cache;
  }

  /**
   * Recursively collects default child items from items that have children.
   * @param items - items to inspect for children
   * @param parentChain - ancestor label chain accumulated so far
   * @param cache - mutable cache to populate
   */
  private collectPromotedChildren(
    items: PopoverItem[],
    parentChain: string[],
    cache: { items: PopoverItemDefault[]; parentChains: Map<PopoverItemDefault, string[]> }
  ): void {
    for (const item of items) {
      if (!(item instanceof PopoverItemDefault) || !item.hasChildren) {
        continue;
      }

      const label = item.title ?? item.name ?? '';
      const newChain = [...parentChain, label];

      this.collectDefaultChildren(item.children, newChain, cache);
    }
  }

  /**
   * Constructs PopoverItemDefault instances from raw params and adds them to the cache.
   * @param childParams - raw child item params from a parent item
   * @param parentChain - ancestor label chain for this group
   * @param cache - mutable cache to populate
   */
  private collectDefaultChildren(
    childParams: PopoverItemParams[],
    parentChain: string[],
    cache: { items: PopoverItemDefault[]; parentChains: Map<PopoverItemDefault, string[]> }
  ): void {
    for (const childParam of childParams) {
      if (childParam.type !== undefined && childParam.type !== PopoverItemType.Default) {
        continue;
      }

      const childInstance = new PopoverItemDefault(childParam);

      if (childInstance.name !== undefined && this.isNamePermanentlyHidden(childInstance.name)) {
        childInstance.destroy();
        continue;
      }

      cache.items.push(childInstance);
      cache.parentChains.set(childInstance, parentChain);

      if (childInstance.hasChildren) {
        this.collectPromotedChildren([childInstance], parentChain, cache);
      }
    }
  }

  /**
   * Removes promoted items and group separators from DOM and destroys cached instances.
   * Idempotent — safe to call when cache is already null.
   */
  private cleanupPromotedItems(): void {
    for (const separator of this.promotedSeparators) {
      separator.remove();
    }
    this.promotedSeparators = [];

    if (this.promotedItemCache !== null) {
      for (const item of this.promotedItemCache.items) {
        item.getElement()?.remove();
        item.destroy();
      }
      this.promotedItemCache = null;
    }
  }

  /**
   * Creates a group separator element for promoted search results.
   * @param label - the parent chain label (e.g., "Convert to" or "Parent › Child")
   */
  private createGroupSeparator(label: string): HTMLElement {
    const el = document.createElement('div');

    el.setAttribute(DATA_ATTR.promotedGroupLabel, '');
    el.setAttribute('role', 'separator');
    el.className = 'px-3 pt-2.5 pb-1 text-[11px] font-medium uppercase tracking-wide text-gray-text/50 cursor-default';
    el.textContent = label;

    return el;
  }

  /**
   * Appends DOM elements for a group of promoted items to the items container.
   * @param groupItems - promoted items with their scores
   */
  private appendPromotedGroupElements(groupItems: Array<{ item: PopoverItemDefault; score: number }>): void {
    for (const { item } of groupItems) {
      const el = item.getElement();

      if (el !== null) {
        this.nodes.items?.appendChild(el);
      }
    }
  }

  /**
   * Filters out top-level items whose title duplicates a promoted item's title.
   * Prevents the same entry from appearing both at the top level and under a group
   * like "Convert to" during search.
   * @param topLevel - top-level items matching the search query
   * @param promoted - promoted items from nested children
   */
  private deduplicateAgainstPromoted(
    topLevel: PopoverItemDefault[],
    promoted: Array<{ item: PopoverItemDefault }>
  ): PopoverItemDefault[] {
    const promotedTitles = new Set<string>();

    for (const { item } of promoted) {
      if (item.title !== undefined) {
        promotedTitles.add(item.title.toLowerCase());
      }
    }

    return topLevel.filter(item => {
      if (!(item instanceof PopoverItemDefault) || item.title === undefined) {
        return true;
      }

      return !promotedTitles.has(item.title.toLowerCase());
    });
  }

  /**
   * Adds search to the popover
   */
  private addSearch(): void {
    this.search = new SearchInput({
      items: this.itemsDefault,
      placeholder: this.messages.search,
    });

    this.search.on(SearchInputEvent.Search, (searchData: { query: string; items: SearchableItem[] }) => {
      const isEmptyQuery = searchData.query === '';

      if (isEmptyQuery) {
        this.cleanupPromotedItems();
        this.onSearch({
          query: searchData.query,
          topLevelItems: searchData.items as unknown as PopoverItemDefault[],
          promotedItems: [],
        });

        return;
      }

      // Build cache on first non-empty search
      if (this.promotedItemCache === null) {
        this.promotedItemCache = this.buildPromotedItemCache();
      }

      // Score promoted items against the query
      const { parentChains } = this.promotedItemCache;
      const promotedScored = this.promotedItemCache.items
        .map(item => ({
          item,
          score: scoreSearchMatch(item, searchData.query),
          chain: parentChains.get(item) ?? [],
        }))
        .filter(({ score }) => score > 0)
        .sort((a, b) => b.score - a.score);

      this.onSearch({
        query: searchData.query,
        topLevelItems: searchData.items as unknown as PopoverItemDefault[],
        promotedItems: promotedScored,
      });
    });

    const searchElement = this.search.getElement();

    searchElement.classList.add('mb-1.5');

    this.nodes.popoverContainer.insertBefore(searchElement, this.nodes.popoverContainer.firstChild);
  }

  /**
   * Filters popover items by query string.
   * Used for inline slash search where typing happens in the block, not in a search input.
   * @param query - search query text
   */
  public override filterItems(query: string): void {
    if (query === '') {
      this.cleanupPromotedItems();
      this.onSearch({
        query,
        topLevelItems: this.itemsDefault,
        promotedItems: [],
      });

      return;
    }

    // Build cache on first non-empty search
    if (this.promotedItemCache === null) {
      this.promotedItemCache = this.buildPromotedItemCache();
    }

    // Score top-level items
    const topLevelScored = this.itemsDefault
      .map(item => ({ item, score: scoreSearchMatch(item, query) }))
      .filter(({ score }) => score > 0)
      .sort((a, b) => b.score - a.score);

    // Score promoted items from cache
    const { parentChains: chains } = this.promotedItemCache;
    const promotedScored = this.promotedItemCache.items
      .map(item => ({
        item,
        score: scoreSearchMatch(item, query),
        chain: chains.get(item) ?? [],
      }))
      .filter(({ score }) => score > 0)
      .sort((a, b) => b.score - a.score);

    this.onSearch({
      query,
      topLevelItems: topLevelScored.map(({ item }) => item),
      promotedItems: promotedScored,
    });
  }

  /**
   * Handles search results from both filterItems and SearchInput.
   * Renders top-level matches and promoted children with group separators.
   */
  private onSearch = (data: {
    query: string;
    topLevelItems: PopoverItemDefault[] | SearchableItem[];
    promotedItems: Array<{ item: PopoverItemDefault; score: number; chain: string[] }>;
  }): void => {
    const isEmptyQuery = data.query === '';
    const allTopLevel = data.topLevelItems as unknown as PopoverItemDefault[];

    // Deduplicate: hide top-level items whose title matches a promoted item
    const matchingTopLevel = !isEmptyQuery && data.promotedItems.length > 0
      ? this.deduplicateAgainstPromoted(allTopLevel, data.promotedItems)
      : allTopLevel;

    const isNothingFound = matchingTopLevel.length === 0 && data.promotedItems.length === 0;

    this.items
      .forEach((item) => {
        const isDefaultItem = item instanceof PopoverItemDefault;
        const isSeparatorOrHtml = item instanceof PopoverItemSeparator || item instanceof PopoverItemHtml;
        const isHidden = isDefaultItem
          ? !matchingTopLevel.includes(item) || (item.name !== undefined && this.isNamePermanentlyHidden(item.name))
          : isSeparatorOrHtml && (isNothingFound || !isEmptyQuery);

        item.toggleHidden(isHidden);
      });

    // Reorder top-level DOM elements to reflect ranking
    if (!isEmptyQuery && matchingTopLevel.length > 0) {
      this.reorderItemsByRank(matchingTopLevel);
    } else if (isEmptyQuery && this.originalItemOrder !== undefined) {
      this.restoreOriginalItemOrder();
    }

    // Detach previous promoted elements from DOM (don't destroy cache)
    for (const separator of this.promotedSeparators) {
      separator.remove();
    }
    this.promotedSeparators = [];

    if (this.promotedItemCache !== null) {
      for (const item of this.promotedItemCache.items) {
        item.getElement()?.remove();
      }
    }

    // Render promoted items grouped by parent chain
    if (data.promotedItems.length > 0) {
      const groups = new Map<string, Array<{ item: PopoverItemDefault; score: number }>>();

      for (const entry of data.promotedItems) {
        const label = entry.chain.join(' \u203A ');
        const existing = groups.get(label);

        if (existing !== undefined) {
          existing.push({ item: entry.item, score: entry.score });
        } else {
          groups.set(label, [{ item: entry.item, score: entry.score }]);
        }
      }

      // Sort groups by best score in each group
      const sortedGroups = [...groups.entries()].sort((a, b) => {
        const bestA = Math.max(...a[1].map(e => e.score));
        const bestB = Math.max(...b[1].map(e => e.score));

        return bestB - bestA;
      });

      for (const [label, groupItems] of sortedGroups) {
        const separator = this.createGroupSeparator(label);

        this.promotedSeparators.push(separator);
        this.nodes.items?.appendChild(separator);

        this.appendPromotedGroupElements(groupItems);
      }
    }

    this.toggleNothingFoundMessage(isNothingFound);

    // Build flippable elements list: top-level matches + promoted items
    const topLevelFlippable = isEmptyQuery
      ? this.flippableElements
      : matchingTopLevel.map(item => item.getElement());

    const promotedFlippable = data.promotedItems.map(({ item }) => item.getElement());

    const flippableElements = [
      ...topLevelFlippable,
      ...promotedFlippable,
    ].filter((el): el is HTMLElement => el !== null);

    if (!this.flipper?.isActivated) {
      return;
    }

    this.flipper.deactivate();
    this.flipper.activate(flippableElements);

    if (flippableElements.length > 0) {
      this.flipper.focusItem(0, { skipNextTab: true });
    }
  };

  /**
   * Reorders DOM children of the items container to match the ranked order.
   * Caches the original order on first call so it can be restored later.
   * @param rankedItems - items sorted by search relevance (best first)
   */
  private reorderItemsByRank(rankedItems: PopoverItemDefault[]): void {
    if (this.originalItemOrder === undefined && this.nodes.items !== null) {
      this.originalItemOrder = Array.from(this.nodes.items.children);
    }

    const itemsContainer = this.nodes.items;

    if (itemsContainer === null) {
      return;
    }

    for (const item of rankedItems) {
      const el = item.getElement();

      if (el !== null) {
        itemsContainer.appendChild(el);
      }
    }
  }

  /**
   * Restores the original DOM order of items container children.
   * Called when the search query is cleared.
   */
  private restoreOriginalItemOrder(): void {
    const itemsContainer = this.nodes.items;

    if (itemsContainer === null || this.originalItemOrder === undefined) {
      return;
    }

    for (const el of this.originalItemOrder) {
      itemsContainer.appendChild(el);
    }

    this.originalItemOrder = undefined;
  }
}
