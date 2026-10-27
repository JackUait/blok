import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { PopoverDesktop } from '../../../../../src/components/utils/popover/popover-desktop';

const itemEl = (name: string): HTMLElement | null => document.querySelector<HTMLElement>(`[data-blok-item-name="${name}"]`);

/** notion-spec-2 §17.2: the rollup's Target property list reads "Search for a property…". */
describe('Popover: children.searchPlaceholder', () => {
  const popovers: PopoverDesktop[] = [];
  const open = (searchPlaceholder?: string): void => {
    const popover = new PopoverDesktop({
      messages: { search: 'Search' },
      items: [{
        title: 'Target property',
        name: 'target',
        children: { clickOnly: true, searchable: true, ...(searchPlaceholder === undefined ? {} : { searchPlaceholder }), items: [{ title: 'Name', name: 'name', onActivate: vi.fn() }] },
      }],
    });

    popovers.push(popover);
    document.body.appendChild(popover.getElement());
    popover.show();
    itemEl('target')?.click();
  };
  const searchInput = (): HTMLInputElement | null =>
    itemEl('name')?.closest('[data-blok-popover-container]')?.querySelector('input') ?? null;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    popovers.splice(0).forEach((popover) => popover.destroy());
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  it('puts its own placeholder in the list\'s search field', () => {
    open('Search for a property…');

    expect(searchInput()?.placeholder).toBe('Search for a property…');
  });

  it('keeps the menu\'s placeholder without one', () => {
    open();

    expect(searchInput()?.placeholder).toBe('Search');
  });
});
