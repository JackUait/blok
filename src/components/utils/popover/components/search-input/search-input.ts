import Dom from '../../../../dom';
import Listeners from '../../../listeners';
import { IconSearch } from '../../../../icons';
import type { SearchInputEventMap, SearchableItem } from './search-input.types';
import { SearchInputEvent } from './search-input.types';
import { css } from './search-input.const';
import EventsDispatcher from '../../../events';

/**
 * Provides search input element and search logic
 * @internal
 */
export class SearchInput extends EventsDispatcher<SearchInputEventMap> {
  /**
   * Input wrapper element
   */
  private wrapper: HTMLElement;

  /**
   * Editable input itself
   */
  private input: HTMLInputElement;

  /**
   * The instance of the Listeners util
   */
  private listeners: Listeners;

  /**
   * Items for local search
   */
  private items: SearchableItem[];

  /**
   * Current search query
   */
  private searchQuery = '';

  /**
   * @param options - available config
   * @param options.items - searchable items list
   * @param options.placeholder - input placeholder
   */
  constructor({ items, placeholder }: {
    items: SearchableItem[];
    placeholder?: string;
  }) {
    super();

    this.listeners = new Listeners();
    this.items = items;

    /** Build ui */
    this.wrapper = Dom.make('div', css.wrapper);
    this.wrapper.setAttribute('data-blok-testid', 'popover-search-field');

    const iconWrapper = Dom.make('div', css.icon, {
      innerHTML: IconSearch,
    });

    this.input = Dom.make('input', css.input, {
      type: 'search',
      placeholder,
      /**
       * Used to prevent focusing on the input by Tab key
       * (Popover in the Toolbar lays below the blocks,
       * so Tab in the last block will focus this hidden input if this property is not set)
       */
      tabIndex: -1,
    }) as HTMLInputElement;
    this.input.setAttribute('data-blok-flipper-navigation-target', 'true');
    this.input.setAttribute('data-blok-testid', 'popover-search-input');

    this.wrapper.appendChild(iconWrapper);
    this.wrapper.appendChild(this.input);

    this.overrideValueProperty();

    const eventsToHandle = ['input', 'keyup', 'search', 'change'] as const;

    eventsToHandle.forEach((eventName) => {
      this.listeners.on(this.input, eventName, this.handleValueChange);
    });
  }

  /**
   * Returns search field element
   */
  public getElement(): HTMLElement {
    return this.wrapper;
  }

  /**
   * Sets focus to the input
   */
  public focus(): void {
    this.input.focus();
  }

  /**
   * Clears search query and results
   */
  public clear(): void {
    this.input.value = '';
  }

  /**
   * Handles value changes for the input element
   */
  private handleValueChange = (): void => {
    this.applySearch(this.input.value);
  };

  /**
   * Applies provided query to the search state and notifies listeners
   * @param query - search query to apply
   */
  private applySearch(query: string): void {
    if (this.searchQuery === query) {
      return;
    }

    this.searchQuery = query;

    this.emit(SearchInputEvent.Search, {
      query,
      items: this.foundItems,
    });
  }

  /**
   * Overrides value property setter to catch programmatic changes
   */
  private overrideValueProperty(): void {
    const prototype = Object.getPrototypeOf(this.input);
    const descriptor = Object.getOwnPropertyDescriptor(prototype, 'value');

    if (descriptor?.set === undefined || descriptor.get === undefined) {
      return;
    }

    const applySearch = this.applySearch.bind(this);

    Object.defineProperty(this.input, 'value', {
      configurable: descriptor.configurable ?? true,
      enumerable: descriptor.enumerable ?? false,
      get(): string {
        return descriptor.get?.call(this) ?? '';
      },
      set(value: string): void {
        descriptor.set?.call(this, value);
        applySearch(value);
      },
    });
  }

  /**
   * Clears memory
   */
  public destroy(): void {
    this.listeners.removeAll();
  }

  /**
   * Returns list of found items for the current search query
   */
  private get foundItems(): SearchableItem[] {
    return this.items.filter(item => this.checkItem(item));
  }

  /**
   * Contains logic for checking whether passed item conforms the search query
   * @param item - item to be checked
   */
  private checkItem(item: SearchableItem): boolean {
    const text = item.title?.toLowerCase() || '';
    const query = this.searchQuery?.toLowerCase();

    return query !== undefined ? text.includes(query) : false;
  }
}
