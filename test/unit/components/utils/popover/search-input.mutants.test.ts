import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest';

import { SearchInput } from '../../../../../src/components/utils/popover/components/search-input/search-input';
import { SearchInputEvent } from '../../../../../src/components/utils/popover/components/search-input/search-input.types';

interface Fixture {
  search: SearchInput;
  input: HTMLInputElement;
  onSearch: Mock<(payload: { query: string }) => void>;
}

const build = (options: { placeholder?: string; label?: string; controlsId?: string } = {}): Fixture => {
  const search = new SearchInput({ items: [{ title: 'Bold' }], ...options });
  const root = search.getElement();
  const input = root.querySelector('input');

  if (input === null) {
    throw new Error('the search field has no input');
  }

  const onSearch = vi.fn<(payload: { query: string }) => void>();

  search.on(SearchInputEvent.Search, onSearch);
  document.body.appendChild(root);

  return { search, input, onSearch };
};

const type = (fixture: Fixture, value: string): void => {
  const { input } = fixture;

  input.value = value;
  input.dispatchEvent(new Event('input'));
};

describe('popover search input mutants', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    document.body.replaceChildren();
    vi.restoreAllMocks();
  });

  it('names the combobox from the label, or from the placeholder when there is none', () => {
    expect(build({ label: 'Search tools', placeholder: 'Type' }).input.getAttribute('aria-label'))
      .toBe('Search tools');
    expect(build({ placeholder: 'Type' }).input.getAttribute('aria-label')).toBe('Type');
  });

  // Writing an absent value stores the string "undefined", which assistive tech
  // would read out — so the attribute has to stay off entirely.
  it('leaves the aria attributes off when it has nothing to put in them', () => {
    const fixture = build();

    expect(fixture.input.hasAttribute('aria-label')).toBe(false);
    expect(fixture.input.hasAttribute('aria-controls')).toBe(false);
  });

  it('links the results container when it is given one', () => {
    expect(build({ controlsId: 'results' }).input.getAttribute('aria-controls')).toBe('results');
  });

  it('announces a query once, however many times the same value arrives', () => {
    const fixture = build();

    type(fixture, 'bo');
    type(fixture, 'bo');

    expect(fixture.onSearch.mock.calls.map(([payload]) => payload.query)).toStrictEqual(['bo']);
  });

  // The field starts empty, so an input event carrying the empty string is not
  // a change and must announce nothing.
  it('says nothing when the value arrives still empty', () => {
    const fixture = build();

    type(fixture, '');

    expect(fixture.onSearch).not.toHaveBeenCalled();
  });
});
