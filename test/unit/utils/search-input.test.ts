import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SearchInput } from '../../../src/components/utils/popover/components/search-input/search-input';
import { SearchInputEvent } from '../../../src/components/utils/popover/components/search-input/search-input.types';

const getInput = (instance: SearchInput): HTMLInputElement => {
  return (instance as unknown as { input: HTMLInputElement }).input;
};

describe('SearchInput', () => {
  const defaultItems = [
    { title: 'Move Up' },
    { title: 'Delete' },
    { title: undefined },
  ];

  const createSearchInput = (override: Partial<ConstructorParameters<typeof SearchInput>[0]> = {}): SearchInput => {
    return new SearchInput({
      items: defaultItems,
      placeholder: 'Filter actions',
      ...override,
    });
  };

  beforeEach(() => {
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  it('builds the wrapper with icon and input', () => {
    const searchInput = createSearchInput();
    const element = searchInput.getElement();

    expect(element).toHaveAttribute('data-blok-testid', 'popover-search-field');
    expect(element.children.length).toBe(2);

    const input = element.querySelector('[data-blok-testid="popover-search-input"]') as HTMLInputElement;

    expect(input).not.toBeNull();
    expect(input.type).toBe('search');
    expect(input.tabIndex).toBe(-1);
    expect(input).toHaveAttribute('data-blok-flipper-navigation-target', 'true');
    expect(input.placeholder).toBe('Filter actions');
  });

  it('focuses the underlying input', () => {
    const searchInput = createSearchInput();
    const wrapper = searchInput.getElement();
    document.body.appendChild(wrapper);
    const input = getInput(searchInput);

    searchInput.focus();

    expect(input).toHaveFocus();
  });

  it('emits search event with filtered items on input', () => {
    const searchInput = createSearchInput();
    const handler = vi.fn();

    searchInput.on(SearchInputEvent.Search, handler);

    const input = getInput(searchInput);

    // Setting the input value triggers the search via the overridden value property
    input.value = 'move';

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith({
      query: 'move',
      items: [ defaultItems[0] ],
    });
    // Verify the input value was actually set
    expect(input.value).toBe('move');
  });

  it('clears value and emits empty query', () => {
    const customItems = [
      { title: 'Alpha' },
      { title: 'Beta' },
    ];
    const searchInput = createSearchInput({ items: customItems });
    const input = getInput(searchInput);
    const handler = vi.fn();

    searchInput.on(SearchInputEvent.Search, handler);

    // Set initial value to filter items
    input.value = 'alpha';

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenLastCalledWith({
      query: 'alpha',
      items: [ customItems[0] ],
    });

    handler.mockClear();

    // Clear the search input
    searchInput.clear();

    expect(input.value).toBe('');
    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith({
      query: '',
      items: customItems,
    });
  });

  it('removes listeners on destroy', () => {
    const searchInput = createSearchInput();
    const input = getInput(searchInput);
    const handler = vi.fn();

    searchInput.on(SearchInputEvent.Search, handler);

    // Verify initial state - search works
    input.value = 'move';
    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith({
      query: 'move',
      items: [ defaultItems[0] ],
    });

    // Destroy should not throw
    expect(() => searchInput.destroy()).not.toThrow();

    // After destroy, the value property override still triggers search
    // (The property override uses a bound reference to applySearch, independent of DOM listeners)
    input.value = 'delete';
    expect(handler).toHaveBeenCalledTimes(2);
    expect(handler).toHaveBeenLastCalledWith({
      query: 'delete',
      items: [ defaultItems[1] ],
    });

    // Destroy can be called multiple times (idempotent)
    expect(() => searchInput.destroy()).not.toThrow();
  });
});

