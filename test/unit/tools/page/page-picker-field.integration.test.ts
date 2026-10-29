import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { PagePicker } from '../../../../src/tools/page/page-picker';

/** The picker on the real popover: where its field and empty state land. */
describe('PagePicker on the real popover', () => {
  let anchor: HTMLElement;
  let picker: PagePicker;

  beforeEach(() => {
    vi.clearAllMocks();
    anchor = document.createElement('div');
    document.body.append(anchor);
    picker = new PagePicker('Pages', 'Page', 'Draft', 'Ничего не найдено');
  });

  afterEach(() => {
    picker.close();
    document.body.replaceChildren();
    vi.restoreAllMocks();
  });

  const nothingFound = (): HTMLElement | null =>
    document.querySelector<HTMLElement>('[data-blok-testid="popover-nothing-found"]');

  it('keeps the field on top, the empty state under it, and only options in the listbox', () => {
    const onQuery = vi.fn<(query: string) => void>();

    picker.open('', anchor, vi.fn(), { searchField: { placeholder: 'Search pages', onQuery } });

    const input = document.querySelector<HTMLInputElement>('[data-blok-testid="page-picker-search-input"]');
    const container = document.querySelector('[data-blok-popover-container]');

    expect(input).toHaveFocus();
    expect(container?.firstElementChild?.contains(input ?? null)).toBe(true);
    expect(input?.closest('[data-blok-keyboard-owner]')).not.toBeNull();
    expect(nothingFound()?.classList.contains('hidden')).toBe(true);

    picker.setResults([]);

    expect(nothingFound()?.classList.contains('hidden')).toBe(false);
    expect(nothingFound()?.textContent).toContain('Ничего не найдено');

    picker.setResults([{ pageId: 'p1', title: 'Roadmap' }]);
    const list = document.getElementById(input?.getAttribute('aria-controls') ?? '');

    expect(nothingFound()?.classList.contains('hidden')).toBe(true);
    expect(list?.getAttribute('role')).toBe('listbox');
    expect(Array.from(list?.children ?? []).map((child) => child.getAttribute('role'))).toEqual(['option']);
    expect(list?.contains(input ?? null)).toBe(false);
  });
});
