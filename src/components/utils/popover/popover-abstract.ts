import { DATA_ATTR } from '../../constants/data-attributes';
import { EventsDispatcher } from '../events';
import { Listeners } from '../listeners';
import { twMerge } from '../tw';

import { PopoverItemDefault, PopoverItemSeparator, PopoverItemType } from './components/popover-item';
import type { PopoverItem, PopoverItemRenderParamsMap , PopoverItemParams } from './components/popover-item';
import { PopoverItemHtml } from './components/popover-item/popover-item-html/popover-item-html';
import type { SearchInput } from './components/search-input';
import { PopoverRegistry } from './popover-registry';
import { css } from './popover.const';

import type { PopoverEventMap, PopoverMessages, PopoverParams, PopoverNodes } from '@/types/utils/popover/popover';
import { PopoverEvent } from '@/types/utils/popover/popover-event';



/**
 * Class responsible for rendering popover and handling its behaviour.
 * Uses vanilla DOM manipulation for rendering.
 */
export abstract class PopoverAbstract<Nodes extends PopoverNodes = PopoverNodes> extends EventsDispatcher<PopoverEventMap> {
  /**
   * List of popover items
   */
  protected items: Array<PopoverItem>;

  /**
   * Listeners util instance
   */
  protected listeners: Listeners = new Listeners();

  /**
   * Refs to created HTML elements.
   */
  protected nodes: Nodes;

  /**
   * List of default popover items that are searchable and may have confirmation state
   */
  protected get itemsDefault(): PopoverItemDefault[] {
    return this.items.filter(item => item instanceof PopoverItemDefault);
  }

  /**
   * Instance of the Search Input
   */
  protected search: SearchInput | undefined;

  /**
   * Messages that will be displayed in popover
   */
  protected messages: PopoverMessages = {
    nothingFound: 'Nothing found',
    search: 'Search',
  };

  /**
   * Constructs the instance
   * @param params - popover construction params
   * @param itemsRenderParams - popover item render params.
   * The parameters that are not set by user via popover api but rather depend on technical implementation
   */
  constructor(
    protected readonly params: PopoverParams,
    protected readonly itemsRenderParams: PopoverItemRenderParamsMap = {}
  ) {
    super();

    this.items = this.buildItems(params.items);

    if (params.messages) {
      this.messages = {
        ...this.messages,
        ...params.messages,
      };
    }

    // Initialize nodes object and create DOM elements
    this.nodes = this.createPopoverDOM() as Nodes;

    // Append item elements to the items container
    this.appendItemElements();

    // Set up click listener on the container
    if (this.nodes.popoverContainer) {
      this.listeners.on(this.nodes.popoverContainer, 'click', (event: Event) => this.handleClick(event));
    }
  }

  /**
   * Returns HTML element corresponding to the popover
   */
  public getElement(): HTMLElement {
    return this.nodes.popover;
  }

  /**
   * Returns DOM element that should be attached to the document.
   */
  public getMountElement(): HTMLElement {
    return this.nodes.popover;
  }

  /**
   * Open popover
   */
  public show(): void {
    const mountTarget = this.nodes.popover;

    if (mountTarget !== null && !mountTarget.isConnected) {
      document.body.appendChild(mountTarget);
    }

    // Update DOM state
    this.nodes.popover.setAttribute(DATA_ATTR.popoverOpened, 'true');
    this.nodes.popoverContainer.classList.add(...css.popoverContainerOpened.split(' '));

    /**
     * Refresh active states for all items.
     * This ensures items with dynamic isActive() callbacks reflect the current state.
     */
    this.itemsDefault.forEach(item => this.refreshItemActiveState(item));

    if (this.search !== undefined) {
      this.search.focus();
    }

    const { trigger } = this.params;
    const isRootWithTrigger = (this.params.nestingLevel ?? 0) === 0 && trigger !== undefined;

    if (isRootWithTrigger) {
      PopoverRegistry.instance.register(this, trigger);
    }
  }

  /**
   * Closes popover
   */
  public hide(): void {
    // Update DOM state
    this.nodes.popover.removeAttribute(DATA_ATTR.popoverOpened);
    this.nodes.popover.removeAttribute(DATA_ATTR.popoverOpenTop);
    this.nodes.popover.removeAttribute(DATA_ATTR.popoverOpenLeft);
    this.nodes.popoverContainer.classList.remove(...css.popoverContainerOpened.split(' '));

    this.itemsDefault.forEach(item => item.reset());

    if (this.search !== undefined) {
      this.search.clear();
    }

    PopoverRegistry.instance.unregister(this);

    this.emit(PopoverEvent.Closed);
  }

  /**
   * Clears memory
   */
  public destroy(): void {
    this.items.forEach(item => item.destroy());
    this.nodes.popover?.remove();
    this.listeners.removeAll();
    this.search?.destroy();
  }

  /**
   * Filters popover items by query string.
   * Base implementation is a no-op. Override in subclasses that support filtering.
   * @param _query - search query text
   */
  public filterItems(_query: string): void {
    // No-op in base class. PopoverDesktop overrides this.
  }

  /**
   * Names of items that have been explicitly hidden via toggleItemHiddenByName.
   * These items must stay hidden even when filterItems would normally show them.
   */
  private readonly permanentlyHiddenNames = new Set<string>();

  /**
   * Toggles hidden state of all items matching the given name
   * @param name - name of the items to toggle
   * @param isHidden - true to hide, false to show
   */
  public toggleItemHiddenByName(name: string, isHidden: boolean): void {
    this.items
      .filter(item => item.name === name)
      .forEach(item => item.toggleHidden(isHidden));

    if (isHidden) {
      this.permanentlyHiddenNames.add(name);
    } else {
      this.permanentlyHiddenNames.delete(name);
    }
  }

  /**
   * Returns true if the given item name was explicitly hidden via toggleItemHiddenByName.
   * Used by subclasses to prevent filter logic from un-hiding restricted items.
   * @param name - item name to check
   */
  protected isNamePermanentlyHidden(name: string): boolean {
    return this.permanentlyHiddenNames.has(name);
  }

  /**
   * Looks for the item by name and imitates click on it
   * @param name - name of the item to activate
   */
  public activateItemByName(name: string): void {
    const foundItem = this.items.find(item => item.name === name);

    if (foundItem === undefined) {
      return;
    }

    this.handleItemClick(foundItem);
  }

  /**
   * Factory method for creating popover items
   * @param items - list of items params
   */
  protected buildItems(items: PopoverItemParams[]): Array<PopoverItem> {
    return items.map(item => {
      switch (item.type) {
        case PopoverItemType.Separator:
          return new PopoverItemSeparator(this.itemsRenderParams[PopoverItemType.Separator]);
        case PopoverItemType.Html:
          return new PopoverItemHtml(item, this.itemsRenderParams[PopoverItemType.Html]);
        case PopoverItemType.Default:
        case undefined:
          return new PopoverItemDefault(item, this.itemsRenderParams[PopoverItemType.Default]);
      }
    });
  }

  /**
   * Retrieves popover item that is the target of the specified event
   * @param event - event to retrieve popover item from
   */
  protected getTargetItem(event: Event): PopoverItemDefault | PopoverItemHtml | undefined {
    return this.items
      .filter(item => item instanceof PopoverItemDefault || item instanceof PopoverItemHtml)
      .find(item => {
        const itemEl = item.getElement();

        if (itemEl === null) {
          return false;
        }

        return event.composedPath().includes(itemEl);
      });
  }

  /**
   * Handles popover item click
   * @param item - item to handle click of
   */
  protected handleItemClick(item: PopoverItem): void {
    if (item instanceof PopoverItemDefault && item.isDisabled) {
      return;
    }

    if (item.hasChildren) {
      this.showNestedItems(item as PopoverItemDefault | PopoverItemHtml);
      this.callHandleClickIfPresent(item);

      return;
    }

    /** Cleanup other items state */
    this.itemsDefault.filter(x => x !== item).forEach(x => x.reset());

    this.callHandleClickIfPresent(item);

    this.toggleItemActivenessIfNeeded(item);

    /**
     * Refresh item's active state based on isActive() callback.
     * This is needed for inline tools that dynamically determine their active state.
     */
    this.refreshItemActiveState(item);

    if (item.closeOnActivate === true) {
      this.hide();

      this.emit(PopoverEvent.ClosedOnActivate);
    }
  }

  /**
   * Handles clicks inside popover
   * @param event - item to handle click of
   */
  private handleClick(event: Event): void {
    const item = this.getTargetItem(event);

    if (item === undefined) {
      return;
    }

    this.handleItemClick(item);
  }


  /**
   * - Toggles item active state, if clicked popover item has property 'toggle' set to true.
   *
   * - Performs radiobutton-like behavior if the item has property 'toggle' set to string key.
   * (All the other items with the same key get inactive, and the item gets active)
   * @param clickedItem - popover item that was clicked
   */
  private toggleItemActivenessIfNeeded(clickedItem: PopoverItem): void {
    if (!(clickedItem instanceof PopoverItemDefault)) {
      return;
    }

    if (clickedItem.toggle === true) {
      clickedItem.toggleActive();
    }

    if (typeof clickedItem.toggle !== 'string') {
      return;
    }

    const itemsInToggleGroup = this.itemsDefault.filter(item => item.toggle === clickedItem.toggle);

    /** If there's only one item in toggle group, toggle it */
    if (itemsInToggleGroup.length === 1) {
      clickedItem.toggleActive();

      return;
    }

    /** Set clicked item as active and the rest items with same toggle key value as inactive */
    itemsInToggleGroup.forEach(item => {
      item.toggleActive(item === clickedItem);
    });
  }

  /**
   * Refreshes the item's active state based on its isActive callback.
   * This is useful for items that determine their active state dynamically (e.g., inline tools).
   * @param item - popover item to refresh
   */
  private refreshItemActiveState(item: PopoverItem): void {
    if (!(item instanceof PopoverItemDefault)) {
      return;
    }

    /**
     * Only refresh if the item doesn't use toggle (which is handled by toggleItemActivenessIfNeeded)
     */
    if (item.toggle !== undefined) {
      return;
    }

    /**
     * Update the visual state based on the isActive callback
     */
    item.toggleActive(item.isActive);
  }

  /**
   * Executes handleClick if it is present on item.
   * @param item - popover item whose handler should be executed
   */
  private callHandleClickIfPresent(item: PopoverItem): void {
    if ('handleClick' in item && typeof item.handleClick === 'function') {
      item.handleClick();
    }
  }

  /**
   * Handles displaying nested items for the item. Behaviour differs depending on platform.
   * @param item – item to show nested popover for
   */
  protected abstract showNestedItems(item: PopoverItemDefault | PopoverItemHtml): void;

  /**
   * Toggles nothing found message visibility
   * @param isDisplayed - true if the message should be displayed
   */
  protected toggleNothingFoundMessage(isDisplayed: boolean): void {
    if (isDisplayed) {
      this.nodes.nothingFoundMessage.classList.remove('hidden');
      this.nodes.nothingFoundMessage.setAttribute(DATA_ATTR.nothingFoundDisplayed, 'true');
    } else {
      this.nodes.nothingFoundMessage.classList.add('hidden');
      this.nodes.nothingFoundMessage.removeAttribute(DATA_ATTR.nothingFoundDisplayed);
    }
  }

  /**
   * Sets the open-top state for the popover
   * @param openTop - true if popover should open above trigger
   */
  protected setOpenTop(openTop: boolean): void {
    if (openTop) {
      this.nodes.popover.setAttribute(DATA_ATTR.popoverOpenTop, 'true');
    } else {
      this.nodes.popover.removeAttribute(DATA_ATTR.popoverOpenTop);
    }
  }

  /**
   * Sets the open-left state for the popover
   * @param openLeft - true if popover should open to the left
   */
  protected setOpenLeft(openLeft: boolean): void {
    if (openLeft) {
      this.nodes.popover.setAttribute(DATA_ATTR.popoverOpenLeft, 'true');
    } else {
      this.nodes.popover.removeAttribute(DATA_ATTR.popoverOpenLeft);
    }
  }

  /**
   * Checks if popover contains the node
   * @param node - node to check
   */
  public hasNode(node: Node): boolean {
    return this.nodes.popover.contains(node);
  }

  /**
   * Creates the popover DOM structure
   * @returns PopoverNodes object with all required elements
   */
  private createPopoverDOM(): PopoverNodes {
    // Create root popover element
    const popover = document.createElement('div');

    if (this.params.class) {
      popover.className = this.params.class;
    }
    popover.setAttribute(DATA_ATTR.popover, '');
    if (this.params.class) {
      popover.setAttribute('data-blok-popover-custom-class', this.params.class);
    }
    popover.setAttribute('data-blok-testid', 'popover');

    // Set CSS variables
    popover.style.setProperty('--width', this.params.width ?? 'auto');
    popover.style.setProperty('--item-padding', '3px');
    popover.style.setProperty('--item-height', 'calc(1.25rem + 2 * var(--item-padding))');
    popover.style.setProperty('--popover-top', 'calc(100% + 0.5rem)');
    popover.style.setProperty('--popover-left', '0');
    popover.style.setProperty('--nested-popover-overlap', '0.25rem');

    // Create popover container
    const popoverContainer = document.createElement('div');
    popoverContainer.className = css.popoverContainer;
    popoverContainer.setAttribute(DATA_ATTR.popoverContainer, '');
    popoverContainer.setAttribute('data-blok-testid', 'popover-container');

    // Create nothing found message
    const nothingFoundMessage = document.createElement('div');
    nothingFoundMessage.className = twMerge(
      'cursor-default text-sm leading-5 font-medium whitespace-nowrap overflow-hidden text-ellipsis text-gray-text p-[3px]',
      'hidden'
    );
    nothingFoundMessage.setAttribute('data-blok-testid', 'popover-nothing-found');
    nothingFoundMessage.textContent = this.messages.nothingFound ?? 'Nothing found';

    // Create items container
    const items = document.createElement('div');
    items.className = css.items;
    items.setAttribute(DATA_ATTR.popoverItems, '');
    items.setAttribute('data-blok-testid', 'popover-items');

    // Assemble DOM structure
    popoverContainer.appendChild(nothingFoundMessage);
    popoverContainer.appendChild(items);
    popover.appendChild(popoverContainer);

    return {
      popover,
      popoverContainer,
      nothingFoundMessage,
      items,
    };
  }

  /**
   * Appends item elements to the items container
   */
  private appendItemElements(): void {
    this.items.forEach(item => {
      const itemEl = item.getMountElement?.() ?? item.getElement();

      if (itemEl === null) {
        return;
      }

      this.nodes.items?.appendChild(itemEl);
    });
  }
}
