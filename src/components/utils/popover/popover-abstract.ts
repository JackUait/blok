import { DATA_ATTR } from '../../constants/data-attributes';
import { EventsDispatcher } from '../events';
import { Listeners } from '../listeners';
import { isPromotedToTopLayer, promoteToTopLayer, removeFromTopLayer, supportsPopoverAPI } from '../top-layer';
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
    actions: 'Actions',
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

    // Set up scroll listener on items container for scroll hazes
    if (this.nodes.items) {
      this.listeners.on(this.nodes.items, 'scroll', () => this.updateScrollHazes());
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
   * Whether the popover is currently shown
   */
  public get isShown(): boolean {
    return this.nodes.popover.hasAttribute(DATA_ATTR.popoverOpened);
  }

  /**
   * Open popover
   */
  public show(): void {
    const mountTarget = this.nodes.popover;

    if (mountTarget !== null && !mountTarget.isConnected) {
      document.body.appendChild(mountTarget);
    }

    // Promote ROOT, body-mounted popovers into the CSS Top Layer so they
    // render above every other element on the page (site headers, drawers,
    // consumer overlays). Skipped when:
    //   - the popover is nested inside another popover (descendants render
    //     inside the same top layer automatically; promoting them would
    //     change their containing block to the viewport and break
    //     positioning math that assumes the nested root sits at the
    //     parent's coordinates);
    //   - the popover has no `trigger` (inline-toolbar popovers mount
    //     inside their owning wrapper rather than `<body>`; promotion
    //     would leave that wrapper empty and zero-sized).
    const isRoot = (this.params.nestingLevel ?? 0) === 0;
    const isBodyMounted = this.params.trigger !== undefined;

    if (mountTarget !== null && isRoot && isBodyMounted && supportsPopoverAPI()) {
      promoteToTopLayer(mountTarget);
    }

    // Update DOM state
    this.nodes.popover.setAttribute(DATA_ATTR.popoverOpened, 'true');
    this.nodes.popover.dataset.state = 'open';
    this.nodes.popoverContainer.className = twMerge(
      this.nodes.popoverContainer.className,
      css.popoverContainerOpened
    );

    /**
     * Refresh active states for all items.
     * This ensures items with dynamic isActive() callbacks reflect the current state.
     */
    this.itemsDefault.forEach(item => this.refreshItemActiveState(item));

    if (this.search !== undefined) {
      this.search.focus();
    }

    /**
     * Show hazes instantly on open (no transition), then restore transition for scroll-triggered changes
     */
    this.nodes.scrollHazeTop.style.transition = 'none';
    this.nodes.scrollHazeBottom.style.transition = 'none';
    this.updateScrollHazes();
    requestAnimationFrame(() => {
      this.nodes.scrollHazeTop.style.transition = '';
      this.nodes.scrollHazeBottom.style.transition = '';
    });

    const { trigger } = this.params;
    const isRootWithTrigger = (this.params.nestingLevel ?? 0) === 0 && trigger !== undefined;

    if (isRootWithTrigger) {
      PopoverRegistry.instance.register(this, trigger);
    }

    this.onShow();
  }

  /**
   * Subclass hook invoked at the end of {@link show}. Base implementation is a
   * no-op; subclasses override to run show-time setup while inheriting the base
   * open sequence (template-method pattern).
   */
  protected onShow(): void {
    // No-op in base class.
  }

  /**
   * Closes popover
   */
  public hide(): void {
    const mountTarget = this.nodes.popover;

    if (mountTarget !== null && supportsPopoverAPI() && isPromotedToTopLayer(mountTarget)) {
      // Centralized helper hides the popover, strips the `popover` attribute
      // (so UA `[popover]:not(:popover-open)` display:none no longer applies)
      // and removes the `data-blok-top-layer` marker so the CSS reset rule
      // turns off too.
      removeFromTopLayer(mountTarget);
    }

    // Update DOM state
    this.nodes.popover.removeAttribute(DATA_ATTR.popoverOpened);
    this.nodes.popover.removeAttribute(DATA_ATTR.popoverOpenTop);
    this.nodes.popover.removeAttribute(DATA_ATTR.popoverOpenLeft);
    this.nodes.popover.dataset.state = 'closed';
    this.nodes.popoverContainer.className = css.popoverContainer;

    this.itemsDefault.forEach(item => item.reset());

    this.nodes.scrollHazeTop.style.opacity = '0';
    this.nodes.scrollHazeBottom.style.opacity = '0';

    if (this.search !== undefined) {
      this.search.clear();
    }

    this.onHide();

    PopoverRegistry.instance.unregister(this);

    this.emit(PopoverEvent.Closed);
  }

  /**
   * Subclass hook invoked by {@link hide} after the base close sequence and
   * before the registry unregister + Closed emit. Base implementation is a
   * no-op. Subclasses override this instead of re-implementing hide(), so the
   * base cleanup (removing the opened attribute, resetting hazes, clearing
   * search) is never forgotten (template-method pattern).
   */
  protected onHide(): void {
    // No-op in base class.
  }

  /**
   * Timeout fallback (ms) for removing the popover element if no
   * transitionend/animationend fires (e.g. reduced-motion, no transition).
   */
  private static readonly EXIT_ANIMATION_TIMEOUT_MS = 400;

  /**
   * Clears memory.
   *
   * Instead of cloning the popover into a throwaway "ghost" (which duplicated
   * the element's `aria-live` announcer region — a second live region in the
   * AT tree), the real element is kept in the DOM, stamped `data-state="closed"`
   * with the open attribute removed so `popover-animation.css` plays the exit
   * transition, and removed once that transition ends (with a timeout fallback).
   */
  public destroy(): void {
    this.items.forEach(item => item.destroy());
    this.listeners.removeAll();
    this.search?.destroy();

    const popover = this.nodes.popover;

    if (popover === null) {
      return;
    }

    popover.dataset.state = 'closed';
    popover.removeAttribute(DATA_ATTR.popoverOpened);

    if (!this.hasVisibleExitBox(popover)) {
      popover.remove();

      return;
    }

    // Drop the opened container styling so the exit transform plays.
    this.nodes.popoverContainer.className = css.popoverContainer;

    const container = this.nodes.popoverContainer;
    let removed = false;
    const remove = (): void => {
      if (removed) {
        return;
      }
      removed = true;
      popover.remove();
    };

    // Raw listeners (not via this.listeners, which was just torn down) so they
    // survive the destroy and fire once the exit transition completes.
    container.addEventListener('transitionend', remove, { once: true });
    container.addEventListener('animationend', remove, { once: true });
    window.setTimeout(remove, PopoverAbstract.EXIT_ANIMATION_TIMEOUT_MS);
  }

  /**
   * Returns true when the popover has a visible box worth animating out. When
   * detached or zero-sized (e.g. never opened, or under jsdom), the element is
   * removed immediately with no exit transition.
   * @param popover - the popover root element
   */
  private hasVisibleExitBox(popover: HTMLElement): boolean {
    if (!popover.isConnected) {
      return false;
    }

    const rect = popover.getBoundingClientRect();

    return rect.width > 0 || rect.height > 0;
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
    const menuItemRole = this.params.listbox === true ? 'option' : 'menuitem';

    return items.map(item => {
      switch (item.type) {
        case PopoverItemType.Separator:
          return new PopoverItemSeparator(this.itemsRenderParams[PopoverItemType.Separator]);
        case PopoverItemType.Html:
          return new PopoverItemHtml(item, this.itemsRenderParams[PopoverItemType.Html]);
        case PopoverItemType.Default:
        case undefined:
          return new PopoverItemDefault(item, {
            ...this.itemsRenderParams[PopoverItemType.Default],
            menuItemRole,
          });
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

    // A destructive item swaps its content to a "click again to confirm" prompt
    // silently; announce that mode change so screen readers learn the click did
    // not act immediately. Reuses the existing results-announcer live region.
    if (item instanceof PopoverItemDefault && item.isConfirmationStateEnabled) {
      this.announceConfirmationMode(item);
    }

    if (item.closeOnActivate === true) {
      this.hide();

      this.emit(PopoverEvent.ClosedOnActivate);
    }
  }

  /**
   * Writes the confirmation prompt into the visually-hidden live region so
   * screen readers announce that the destructive item is now awaiting a second
   * click to confirm.
   * @param item - the item that just entered confirmation mode
   */
  private announceConfirmationMode(item: PopoverItemDefault): void {
    const announcer = this.nodes.resultsAnnouncer;
    const title = item.confirmationTitle;

    if (announcer === undefined || title === undefined) {
      return;
    }

    announcer.textContent = title;
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
  protected refreshItemActiveState(item: PopoverItem): void {
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
      this.nodes.items?.classList.remove('pb-1.5');
      this.nodes.popoverContainer?.classList.remove('px-1.5', 'pt-1.5');
    } else {
      this.nodes.nothingFoundMessage.classList.add('hidden');
      this.nodes.nothingFoundMessage.removeAttribute(DATA_ATTR.nothingFoundDisplayed);
      this.nodes.items?.classList.add('pb-1.5');
      if (this.isShown) {
        this.nodes.popoverContainer?.classList.add('px-1.5', 'pt-1.5');
      }
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
   * Updates scroll haze visibility based on the items container scroll state.
   * Shows top haze when scrolled down, bottom haze when more content below.
   */
  protected updateScrollHazes(): void {
    const { items, scrollHazeTop, scrollHazeBottom } = this.nodes;

    const hasOverflow = items.scrollHeight > items.clientHeight;
    const isAtTop = items.scrollTop <= 0;
    const isAtBottom = items.scrollTop + items.clientHeight >= items.scrollHeight - 1;

    scrollHazeTop.style.opacity = hasOverflow && !isAtTop ? '1' : '0';
    scrollHazeBottom.style.opacity = hasOverflow && !isAtBottom ? '1' : '0';

    scrollHazeTop.style.top = `${items.offsetTop}px`;
    scrollHazeBottom.style.top = `${items.offsetTop + items.clientHeight - scrollHazeBottom.offsetHeight}px`;
  }

  /**
   * Checks if popover contains the node
   * @param node - node to check
   */
  public hasNode(node: Node): boolean {
    return this.nodes.popover.contains(node);
  }

  /**
   * Returns the element that owns DOM focus while this popover is open, when
   * focus is intentionally kept outside the popover subtree (e.g. the combobox
   * contentEditable that drives the Toolbox via aria-activedescendant). The
   * registry treats focus landing on this host as "inside" so its focus-out
   * dismissal does not close a popover that is working as designed. Base
   * popovers keep focus inside themselves and return null.
   */
  public getFocusHost(): HTMLElement | null {
    return null;
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

    // Popover attribute is added lazily on show() — adding it at creation
    // time would invoke UA `[popover]:not(:popover-open)` display:none
    // styles and, in Chromium, fire synthesized pointer events when the
    // element is promoted to the top layer (matching the mouse position
    // left over from the trigger click). Adding it only around the show()
    // call avoids those synthetic events.

    // Set CSS variables
    popover.style.setProperty('--width', this.params.width ?? 'auto');
    popover.style.setProperty('--item-padding', '4px');
    popover.style.setProperty('--item-height', 'calc(1.75rem + 2 * var(--item-padding))');
    popover.style.setProperty('--popover-top', 'calc(100% + 0.5rem)');
    popover.style.setProperty('--popover-left', '0');
    popover.style.setProperty('--nested-popover-overlap', '0.25rem');
    popover.style.setProperty('--max-height', '400px');

    // Create popover container
    const popoverContainer = document.createElement('div');
    popoverContainer.className = css.popoverContainer;
    popoverContainer.style.boxShadow = 'var(--blok-popover-box-shadow)';
    popoverContainer.setAttribute(DATA_ATTR.popoverContainer, '');
    popoverContainer.setAttribute('data-blok-testid', 'popover-container');

    // Create nothing found message
    const nothingFoundMessage = document.createElement('div');
    nothingFoundMessage.className = twMerge(
      'cursor-default text-[13px] leading-5 font-normal whitespace-nowrap overflow-hidden text-ellipsis text-gray-text px-3 py-4 text-center',
      'hidden'
    );
    nothingFoundMessage.setAttribute('data-blok-testid', 'popover-nothing-found');
    nothingFoundMessage.textContent = this.messages.nothingFound ?? 'Nothing found';

    // Create items container
    const items = document.createElement('div');
    items.className = css.items;
    items.setAttribute(DATA_ATTR.popoverItems, '');
    items.setAttribute('data-blok-testid', 'popover-items');
    // Expose the container as a listbox (search/combobox surfaces) or a menu.
    items.setAttribute('role', this.params.listbox === true ? 'listbox' : 'menu');
    if (this.params.listboxId !== undefined) {
      items.id = this.params.listboxId;
    }

    // Visually-hidden polite live region: announces search result counts / the
    // empty state to screen readers as items are filtered.
    const resultsAnnouncer = document.createElement('div');

    resultsAnnouncer.setAttribute('aria-live', 'polite');
    resultsAnnouncer.setAttribute('role', 'status');
    resultsAnnouncer.setAttribute('data-blok-testid', 'popover-results-announcer');
    resultsAnnouncer.style.position = 'absolute';
    resultsAnnouncer.style.width = '1px';
    resultsAnnouncer.style.height = '1px';
    resultsAnnouncer.style.padding = '0';
    resultsAnnouncer.style.margin = '-1px';
    resultsAnnouncer.style.overflow = 'hidden';
    resultsAnnouncer.style.clip = 'rect(0, 0, 0, 0)';
    resultsAnnouncer.style.whiteSpace = 'nowrap';
    resultsAnnouncer.style.border = '0';

    // Create scroll haze overlays
    const scrollHazeTop = document.createElement('div');

    scrollHazeTop.className = css.scrollHaze;
    scrollHazeTop.style.background = 'linear-gradient(to bottom, var(--blok-popover-bg), transparent)';
    scrollHazeTop.style.opacity = '0';

    const scrollHazeBottom = document.createElement('div');

    scrollHazeBottom.className = css.scrollHaze;
    scrollHazeBottom.style.background = 'linear-gradient(to top, var(--blok-popover-bg), transparent)';
    scrollHazeBottom.style.opacity = '0';

    const contextLabel = this.params.contextLabel !== undefined
      ? (() => {
        const el = document.createElement('div');

        el.className = 'shrink-0 pl-2 pr-3 pt-1 pb-1.5 text-xs font-medium text-gray-text/50 cursor-default bg-popover-bg';
        el.setAttribute('role', 'status');
        el.setAttribute('data-blok-testid', 'popover-context-label');
        el.textContent = this.params.contextLabel;

        return el;
      })()
      : undefined;

    // Assemble DOM structure
    popoverContainer.appendChild(nothingFoundMessage);
    if (contextLabel !== undefined) {
      popoverContainer.appendChild(contextLabel);
    }
    popoverContainer.appendChild(items);
    popoverContainer.appendChild(resultsAnnouncer);
    popoverContainer.appendChild(scrollHazeTop);
    popoverContainer.appendChild(scrollHazeBottom);
    popover.appendChild(popoverContainer);

    return {
      popover,
      popoverContainer,
      nothingFoundMessage,
      resultsAnnouncer,
      contextLabel,
      items,
      scrollHazeTop,
      scrollHazeBottom,
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
