import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SearchInput } from '../../../src/components/utils/popover/components/search-input/search-input';
import { SearchInputEvent } from '../../../src/components/utils/popover/components/search-input/search-input.types';
import type { Listeners } from '../../../src/components/utils/listeners';

const getInput = (instance: SearchInput): HTMLInputElement => {
  return (instance as unknown as { input: HTMLInputElement }).input;
};

const getListeners = (instance: SearchInput): Listeners => {
  return (instance as unknown as { listeners: Listeners }).listeners;
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

    expect(element.getAttribute('data-blok-testid')).toBe('popover-search-field');
    expect(element.children.length).toBe(2);

    const input = element.querySelector('[data-blok-testid="popover-search-input"]') as HTMLInputElement;

    expect(input).not.toBeNull();
    expect(input.type).toBe('search');
    expect(input.tabIndex).toBe(-1);
    expect(input.getAttribute('data-blok-flipper-navigation-target')).toBe('true');
    expect(input.placeholder).toBe('Filter actions');
  });

  it('focuses the underlying input', () => {
    const searchInput = createSearchInput();
    const input = getInput(searchInput);
    const focusSpy = vi.spyOn(input, 'focus');

    searchInput.focus();

    expect(focusSpy).toHaveBeenCalledTimes(1);
  });

  it('emits search event with filtered items on input', () => {
    const searchInput = createSearchInput();
    const handler = vi.fn();

    searchInput.on(SearchInputEvent.Search, handler);

    const input = getInput(searchInput);

    input.value = 'move';
    input.dispatchEvent(new Event('input'));

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith({
      query: 'move',
      items: [ defaultItems[0] ],
    });
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

    input.value = 'alpha';
    input.dispatchEvent(new Event('input'));

    handler.mockClear();

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
    const listeners = getListeners(searchInput);
    const removeAllSpy = vi.spyOn(listeners, 'removeAll');

    searchInput.destroy();

    expect(removeAllSpy).toHaveBeenCalledTimes(1);
  });
});

