import { Dom } from '../../../../dom';
import { IconSearch } from '../../../../icons';
import { EventsDispatcher } from '../../../events';
import { Listeners } from '../../../listeners';

import { css } from './search-input.const';
import type { SearchInputEventMap, SearchableItem } from './search-input.types';
import { SearchInputEvent, scoreSearchMatch } from './search-input.types';


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
   * @param options.label - accessible label (aria-label) for the combobox input.
   *   Falls back to the placeholder when omitted.
   * @param options.controlsId - id of the results container the combobox owns.
   *   Wired as `aria-controls` so assistive tech links the input to its listbox.
   */
  constructor({ items, placeholder, label, controlsId }: {
    items: SearchableItem[];
    placeholder?: string;
    label?: string;
    controlsId?: string;
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

    // Expose the input as an ARIA combobox that filters a results list, so
    // screen readers announce it as a search combobox and can track the
    // virtually-focused result via aria-activedescendant (mirrored onto this
    // input by the popover flipper). See H10.
    this.input.setAttribute('role', 'combobox');
    this.input.setAttribute('aria-autocomplete', 'list');
    this.input.setAttribute('aria-expanded', 'true');

    const accessibleLabel = label ?? placeholder;

    if (accessibleLabel !== undefined) {
      this.input.setAttribute('aria-label', accessibleLabel);
    }

    if (controlsId !== undefined) {
      this.input.setAttribute('aria-controls', controlsId);
    }

    this.wrapper.appendChild(iconWrapper);
    this.wrapper.appendChild(this.input);

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
   * Returns the underlying combobox input element. Exposed so the popover can
   * wire it as the aria-activedescendant host for keyboard navigation.
   */
  public getInput(): HTMLInputElement {
    return this.input;
  }

  /**
   * Sets focus to the input
   */
  public focus(): void {
    this.input.focus();
  }

  /**
   * Sets the input value programmatically and applies the search. Use this
   * instead of assigning `input.value` directly, which does not emit a native
   * `input` event and would leave the search state stale.
   * @param value - new query value
   */
  public setValue(value: string): void {
    this.input.value = value;
    this.applySearch(value);
  }

  /**
   * Clears search query and results
   */
  public clear(): void {
    this.setValue('');
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
   * Clears memory
   */
  public destroy(): void {
    this.listeners.removeAll();
  }

  /**
   * Returns list of found items for the current search query, sorted by relevance
   */
  private get foundItems(): SearchableItem[] {
    return this.items
      .map(item => ({ item, score: scoreSearchMatch(item, this.searchQuery) }))
      .filter(({ score }) => score > 0)
      .sort((a, b) => b.score - a.score)
      .map(({ item }) => item);
  }
}
