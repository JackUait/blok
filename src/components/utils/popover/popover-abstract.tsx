import React, { createRef } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { flushSync } from 'react-dom';
import type { PopoverItem, PopoverItemRenderParamsMap } from './components/popover-item';
import { PopoverItemDefault, PopoverItemSeparator, PopoverItemType } from './components/popover-item';
import type { SearchInput } from './components/search-input';
import EventsDispatcher from '../events';
import Listeners from '../listeners';
import type { PopoverEventMap, PopoverMessages, PopoverParams, PopoverNodes } from '@/types/utils/popover/popover';
import { PopoverEvent } from '@/types/utils/popover/popover-event';
import type { PopoverItemParams } from './components/popover-item';
import { PopoverItemHtml } from './components/popover-item/popover-item-html/popover-item-html';
import {
  PopoverAbstractComponent,
  type PopoverAbstractComponentHandle
} from './PopoverAbstractComponent';

/**
 * Class responsible for rendering popover and handling its behaviour.
 * Uses React internally for rendering while maintaining the same public API.
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
   * These are populated from React component refs after rendering.
   */
  protected nodes: Nodes;

  /**
   * List of default popover items that are searchable and may have confirmation state
   */
  protected get itemsDefault(): PopoverItemDefault[] {
    return this.items.filter(item => item instanceof PopoverItemDefault) as PopoverItemDefault[];
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
   * React 18 root instance for persistent rendering
   */
  private reactRoot: Root | null = null;

  /**
   * Container element that hosts the React root
   */
  private reactContainer: HTMLElement | null = null;

  /**
   * Ref to the imperative handle exposed by the React component
   */
  private componentRef = createRef<PopoverAbstractComponentHandle>();

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

    // Initialize nodes object
    this.nodes = {} as Nodes;

    // Create React container and render component
    this.initializeReactRoot();
    this.renderComponent();

    // Populate nodes from React refs after initial render
    this.syncNodesFromReact();

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
    return this.nodes.popover as HTMLElement;
  }

  /**
   * Returns DOM element that should be attached to the document (React container if present).
   */
  public getMountElement(): HTMLElement {
    return (this.reactContainer ?? this.nodes.popover) as HTMLElement;
  }

  /**
   * Open popover
   */
  public show(): void {
    /**
     * Ensure popover is attached to DOM even if it's still inside the detached React container
     * (happens in mobile mode where no trigger is passed).
     */
    const mountTarget = this.reactContainer ?? this.nodes.popover;

    if (mountTarget !== null && !mountTarget.isConnected) {
      document.body.appendChild(mountTarget);
    }

    // Update React state
    this.componentRef.current?.setOpened(true);
    this.componentRef.current?.setContainerOpened(true);

    /**
     * Refresh active states for all items.
     * This ensures items with dynamic isActive() callbacks reflect the current state.
     */
    this.itemsDefault.forEach(item => this.refreshItemActiveState(item));

    if (this.search !== undefined) {
      this.search.focus();
    }
  }

  /**
   * Closes popover
   */
  public hide(): void {
    // Update React state
    this.componentRef.current?.setOpened(false);
    this.componentRef.current?.setOpenTop(false);
    this.componentRef.current?.setOpenLeft(false);
    this.componentRef.current?.setContainerOpened(false);

    this.itemsDefault.forEach(item => item.reset());

    if (this.search !== undefined) {
      this.search.clear();
    }

    this.emit(PopoverEvent.Closed);
  }

  /**
   * Clears memory
   */
  public destroy(): void {
    this.items.forEach(item => item.destroy());
    this.reactContainer?.remove();
    this.listeners.removeAll();
    this.search?.destroy();

    // Cleanup React root
    if (this.reactRoot) {
      try {
        this.reactRoot.unmount();
      } catch {
        // Ignore errors if DOM is already cleaned up
      }
      this.reactRoot = null;
    }
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
        default:
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
      }) as PopoverItemDefault | PopoverItemHtml | undefined;
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
    this.componentRef.current?.setNothingFoundVisible(isDisplayed);
  }

  /**
   * Sets the open-top state for the popover
   * @param openTop - true if popover should open above trigger
   */
  protected setOpenTop(openTop: boolean): void {
    this.componentRef.current?.setOpenTop(openTop);
  }

  /**
   * Sets the open-left state for the popover
   * @param openLeft - true if popover should open to the left
   */
  protected setOpenLeft(openLeft: boolean): void {
    this.componentRef.current?.setOpenLeft(openLeft);
  }

  /**
   * Checks if popover contains the node
   * @param node - node to check
   */
  public hasNode(node: Node): boolean {
    return this.nodes.popover.contains(node);
  }

  /**
   * Initializes the React root for rendering
   */
  private initializeReactRoot(): void {
    // Create a container element for the React root
    this.reactContainer = document.createElement('div');
    this.reactContainer.style.display = 'contents';

    this.reactRoot = createRoot(this.reactContainer);
  }

  /**
   * Renders the React component with current state
   */
  private renderComponent(): void {
    if (!this.reactRoot) {
      return;
    }

    // Use flushSync to ensure synchronous rendering for immediate DOM access
    flushSync(() => {
      this.reactRoot?.render(
        <PopoverAbstractComponent
          ref={this.componentRef}
          customClass={this.params.class}
          messages={this.messages}
        />
      );
    });
  }

  /**
   * Syncs the nodes object with refs from the React component
   */
  private syncNodesFromReact(): void {
    // Get the actual popover element from the React component
    const popoverEl = this.componentRef.current?.getPopoverElement();
    const containerEl = this.componentRef.current?.getContainerElement();
    const itemsEl = this.componentRef.current?.getItemsElement();
    const nothingFoundEl = this.componentRef.current?.getNothingFoundElement();

    if (popoverEl) {
      this.nodes.popover = popoverEl;
    }
    if (containerEl) {
      this.nodes.popoverContainer = containerEl;
    }
    if (itemsEl) {
      this.nodes.items = itemsEl;
    }
    if (nothingFoundEl) {
      this.nodes.nothingFoundMessage = nothingFoundEl;
    }
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
