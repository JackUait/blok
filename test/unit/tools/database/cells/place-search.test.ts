import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { openCellEditor } from '../../../../../src/tools/database/cells';
import { PopoverRegistry } from '../../../../../src/components/utils/popover/popover-registry';
import type { PlaceValue } from '../../../../../src/tools/database/types';
import { editorRoot, makeAnchor, makeEditorContext, makeProperty, press, pressOutside } from './helpers';

const EIFFEL: PlaceValue = { name: 'Eiffel Tower', address: '5 Avenue Anatole France, 75007 Paris, France', lat: 48.8584, lon: 2.2945 };

const field = (): HTMLInputElement => {
  const el = editorRoot()?.querySelector<HTMLInputElement>('[data-blok-database-cell-input]');

  if (el === null || el === undefined) throw new Error('no editor field');

  return el;
};

const type = (text: string): void => {
  field().value = text;
  field().dispatchEvent(new Event('input', { bubbles: true }));
};

const results = (): Array<{ name: string; address: string }> =>
  [...document.querySelectorAll('[data-blok-database-place-result]')].map((row) => ({
    name: row.querySelector('[data-blok-database-place-result-name]')?.textContent ?? '',
    address: row.querySelector('[data-blok-database-place-result-address]')?.textContent ?? '',
  }));

const settle = async (): Promise<void> => {
  await vi.advanceTimersByTimeAsync(300);
};

describe('Place editor: "Search for a location..." with the host geocoder (research/20 §1d)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    PopoverRegistry.resetForTests();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  it('searches as the user types and lists each result as its name over its address', async () => {
    const geocode = vi.fn().mockResolvedValue([EIFFEL, { name: 'Paris', address: 'Paris, Texas, United States', lat: 33.66, lon: -95.55 }]);

    openCellEditor(makeProperty('place'), null, makeAnchor(), makeEditorContext({ geocode }));
    expect(field().placeholder).toBe('tools.database.placeSearch');

    type('Eiffel');
    expect(geocode).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(250);
    expect(geocode).toHaveBeenCalledWith('Eiffel');
    await settle();

    expect(results()).toEqual([
      { name: 'Eiffel Tower', address: '5 Avenue Anatole France, 75007 Paris, France' },
      { name: 'Paris', address: 'Paris, Texas, United States' },
    ]);
  });

  it('says "Loading..." while the search runs', async () => {
    const geocode = vi.fn(() => new Promise<PlaceValue[]>(() => undefined));

    openCellEditor(makeProperty('place'), null, makeAnchor(), makeEditorContext({ geocode }));
    type('Eiffel');
    await settle();

    expect(document.querySelector('[data-blok-database-place-loading]')?.textContent).toBe('tools.database.placeSearching');
  });

  it('picking a result stores its name, address and point, and nothing else', async () => {
    const onCommit = vi.fn();
    const geocode = vi.fn().mockResolvedValue([{ ...EIFFEL, id: 'osm:1', extra: { a: 1 } }]);

    openCellEditor(makeProperty('place'), null, makeAnchor(), makeEditorContext({ geocode, onCommit }));
    type('Eiffel');
    await settle();
    document.querySelector<HTMLElement>('[data-blok-database-place-result]')?.click();

    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenCalledWith(EIFFEL);
  });

  describe('after a pick the editor stays open on the picked place (research/31 §4a, research/35 §9)', () => {
    const pickEiffel = async (overrides: Parameters<typeof makeEditorContext>[0] = {}): Promise<void> => {
      const geocode = vi.fn().mockResolvedValue([EIFFEL]);

      openCellEditor(makeProperty('place'), null, makeAnchor(), makeEditorContext({ geocode, ...overrides }));
      type('Eiffel');
      await settle();
      document.querySelector<HTMLElement>('[data-blok-database-place-result]')?.click();
    };
    const view = (): HTMLElement | null => editorRoot()?.querySelector<HTMLElement>('[data-blok-database-place-view]') ?? null;

    it('shows the name, a × and a Google Maps link instead of the search, and writes once', async () => {
      const onCommit = vi.fn();
      const onClose = vi.fn();

      await pickEiffel({ onCommit, onClose });

      expect(editorRoot()).not.toBeNull();
      expect(onCommit).toHaveBeenCalledTimes(1);
      expect(onClose).not.toHaveBeenCalled();
      expect(editorRoot()?.querySelector('[data-blok-database-cell-input]')).toBeNull();
      expect(editorRoot()?.querySelector('[data-blok-database-place-results]')).toBeNull();
      expect(view()?.querySelector('[data-blok-database-place-name]')?.textContent).toBe('Eiffel Tower');
      expect(view()?.querySelector('[data-blok-database-place-clear]')?.getAttribute('aria-label')).toBe('tools.database.placeClear');
      expect(view()?.querySelector<HTMLAnchorElement>('[data-blok-database-place-google-maps]')?.href)
        .toBe(`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent('Eiffel Tower,5 Avenue Anatole France, 75007 Paris, France')}`);
    });

    it('draws the picked place on the host map, inside the editor, once it is attached', async () => {
      const renderPlace = vi.fn((container: HTMLElement) => {
        expect(container.isConnected).toBe(true);

        return { destroy: vi.fn() };
      });

      await pickEiffel({ renderPlace });

      expect(renderPlace).toHaveBeenCalledTimes(1);
      const [container, place] = renderPlace.mock.calls[0] as unknown as [HTMLElement, PlaceValue];

      expect(place).toEqual(EIFFEL);
      expect(container.hasAttribute('data-blok-database-place-view-map')).toBe(true);
      expect(view()?.contains(container)).toBe(true);
    });

    it('with a map, "Open in Google Maps" is an icon button on it, named for screen readers', async () => {
      await pickEiffel({ renderPlace: () => ({ destroy: vi.fn() }) });
      const link = view()?.querySelector<HTMLAnchorElement>('[data-blok-database-place-google-maps]');

      expect(link?.previousElementSibling?.hasAttribute('data-blok-database-place-view-map')).toBe(true);
      expect(link?.getAttribute('aria-label')).toBe('tools.database.placeOpenInGoogleMaps');
      expect(link?.querySelector('svg')).not.toBeNull();
      expect(link?.textContent?.trim()).toBe('');
    });

    it('a place with no point gets no map box', async () => {
      const renderPlace = vi.fn();
      const geocode = vi.fn().mockResolvedValue([{ name: 'Somewhere', address: 'No point' }]);

      openCellEditor(makeProperty('place'), null, makeAnchor(), makeEditorContext({ geocode, renderPlace }));
      type('Some');
      await settle();
      document.querySelector<HTMLElement>('[data-blok-database-place-result]')?.click();

      expect(view()).not.toBeNull();
      expect(renderPlace).not.toHaveBeenCalled();
      expect(view()?.querySelector('[data-blok-database-place-view-map]')).toBeNull();
    });

    it('Escape closes it, writes nothing more and frees the map', async () => {
      const onCommit = vi.fn();
      const onCancel = vi.fn();
      const onClose = vi.fn();
      const destroy = vi.fn();

      await pickEiffel({ onCommit, onCancel, onClose, renderPlace: () => ({ destroy }) });
      press(window, 'Escape');

      expect(editorRoot()).toBeNull();
      expect(onCommit).toHaveBeenCalledTimes(1);
      expect(onCancel).not.toHaveBeenCalled();
      expect(onClose).toHaveBeenCalledTimes(1);
      expect(destroy).toHaveBeenCalledTimes(1);
    });

    it('a press outside closes it and writes nothing more', async () => {
      const onCommit = vi.fn();
      const destroy = vi.fn();

      await pickEiffel({ onCommit, renderPlace: () => ({ destroy }) });
      pressOutside();
      await Promise.resolve();

      expect(editorRoot()).toBeNull();
      expect(onCommit).toHaveBeenCalledTimes(1);
      expect(destroy).toHaveBeenCalledTimes(1);
    });

    it('× clears the place it just stored at once and goes back to the search (research/31 §4a)', async () => {
      const onCommit = vi.fn();
      const destroy = vi.fn();

      await pickEiffel({ onCommit, renderPlace: () => ({ destroy }) });
      view()?.querySelector<HTMLElement>('[data-blok-database-place-clear]')?.click();

      expect(onCommit.mock.calls).toEqual([[EIFFEL], [null]]);
      expect(destroy).toHaveBeenCalledTimes(1);
      expect(view()).toBeNull();
      expect(field().value).toBe('');
      expect(field()).toHaveFocus();
      press(window, 'Escape');

      expect(editorRoot()).toBeNull();
      expect(onCommit).toHaveBeenCalledTimes(2);
    });
  });

  describe('a cell that holds a place opens on it, not on the search (research/35 §9)', () => {
    const view = (): HTMLElement | null => editorRoot()?.querySelector<HTMLElement>('[data-blok-database-place-view]') ?? null;

    it('shows the name, a × and the Google Maps link, and writes nothing', () => {
      const onCommit = vi.fn();
      const onCancel = vi.fn();

      openCellEditor(makeProperty('place'), EIFFEL, makeAnchor(), makeEditorContext({ geocode: vi.fn(), onCommit, onCancel }));

      expect(view()?.querySelector('[data-blok-database-place-name]')?.textContent).toBe('Eiffel Tower');
      expect(view()?.querySelector('[data-blok-database-place-clear]')).not.toBeNull();
      expect(view()?.querySelector('[data-blok-database-place-google-maps]')).not.toBeNull();
      expect(editorRoot()?.querySelector('[data-blok-database-cell-input]')).toBeNull();
      press(window, 'Escape');

      expect(onCommit).not.toHaveBeenCalled();
      expect(editorRoot()).toBeNull();
    });

    it('a typed key opens the search with that key and keeps the saved place', () => {
      const onCommit = vi.fn();

      openCellEditor(makeProperty('place'), EIFFEL, makeAnchor(), makeEditorContext({ geocode: vi.fn().mockResolvedValue([]), onCommit }));
      const key = press(document.activeElement ?? document.body, 'B');

      expect(key.defaultPrevented).toBe(true);
      expect(field().value).toBe('B');
      expect(field()).toHaveFocus();
      press(window, 'Escape');

      expect(onCommit).not.toHaveBeenCalled();
    });

    it('ArrowDown then Enter on the place picks nothing hidden behind it', async () => {
      const onCommit = vi.fn();

      openCellEditor(makeProperty('place'), EIFFEL, makeAnchor(), makeEditorContext({ geocode: vi.fn(), currentLocation: vi.fn().mockReturnValue({ name: 'Here' }), onCommit }));
      const target = document.activeElement ?? document.body;

      press(target, 'ArrowDown');
      press(target, 'Enter');
      await settle();

      expect(onCommit).not.toHaveBeenCalled();
    });

    it('a key typed on the selected cell opens the search with it, not the place, and searches', async () => {
      const geocode = vi.fn().mockResolvedValue([]);

      openCellEditor(makeProperty('place'), EIFFEL, makeAnchor(), makeEditorContext({ geocode, initialText: 'L' }));

      expect(view()).toBeNull();
      expect(field().value).toBe('L');
      await settle();
      expect(geocode).toHaveBeenCalledWith('L');
    });

    it('Enter on the place, then a typed search left by a press outside, keeps the saved place', () => {
      const onCommit = vi.fn();

      openCellEditor(makeProperty('place'), EIFFEL, makeAnchor(), makeEditorContext({ geocode: vi.fn().mockResolvedValue([]), onCommit }));
      press(document.activeElement ?? document.body, 'Enter');
      press(document.activeElement ?? document.body, 'B');
      pressOutside();

      expect(onCommit).not.toHaveBeenCalled();
    });

    it('× clears it at once and leaves the search open with no saved name', () => {
      const onCommit = vi.fn();

      openCellEditor(makeProperty('place'), EIFFEL, makeAnchor(), makeEditorContext({ geocode: vi.fn(), onCommit }));
      view()?.querySelector<HTMLElement>('[data-blok-database-place-clear]')?.click();

      expect(onCommit.mock.calls).toEqual([[null]]);
      expect(editorRoot()?.querySelector('[data-blok-database-place-chip]')).toBeNull();
      expect(field()).toHaveFocus();
      pressOutside();

      expect(onCommit).toHaveBeenCalledTimes(1);
    });
  });

  it('picking the place a cell already holds still stores it whole', async () => {
    const onCommit = vi.fn();
    const geocode = vi.fn().mockResolvedValue([EIFFEL]);

    openCellEditor(makeProperty('place'), { address: EIFFEL.address }, makeAnchor(), makeEditorContext({ geocode, onCommit }));
    // The editor opens on the saved place: a key starts the search.
    press(document.activeElement ?? document.body, '5');
    type(EIFFEL.address ?? '');
    await settle();
    document.querySelector<HTMLElement>('[data-blok-database-place-result]')?.click();

    expect(onCommit).toHaveBeenCalledWith(EIFFEL);
  });

  it('an older, slower search never replaces a newer one', async () => {
    const pending: Array<(places: PlaceValue[]) => void> = [];
    const geocode = vi.fn(() => new Promise<PlaceValue[]>((resolve) => pending.push(resolve)));

    openCellEditor(makeProperty('place'), null, makeAnchor(), makeEditorContext({ geocode }));
    type('Pa');
    await settle();
    type('Paris');
    await settle();
    pending[1]([{ name: 'Paris', address: 'Paris, France' }]);
    await settle();
    pending[0]([{ name: 'Pamplona', address: 'Pamplona, Spain' }]);
    await settle();

    expect(results()).toEqual([{ name: 'Paris', address: 'Paris, France' }]);
  });

  it('a failing geocoder shows no results and does not throw', async () => {
    const geocode = vi.fn().mockRejectedValue(new Error('offline'));

    openCellEditor(makeProperty('place'), null, makeAnchor(), makeEditorContext({ geocode }));
    type('Eiffel');
    await settle();

    expect(results()).toEqual([]);
    expect(document.querySelector('[data-blok-database-place-loading]')).toBeNull();
  });

  it('results without a name or address are left out', async () => {
    const geocode = vi.fn().mockResolvedValue([{ lat: 1, lon: 2 }, 'junk', null, EIFFEL]);

    openCellEditor(makeProperty('place'), null, makeAnchor(), makeEditorContext({ geocode }));
    type('Eiffel');
    await settle();

    expect(results().map((row) => row.name)).toEqual(['Eiffel Tower']);
  });

  describe('keys over the rows (research/36 §7, research/31 §4a)', () => {
    const active = (): string[] => [...document.querySelectorAll('[data-blok-database-place-current], [data-blok-database-place-result]')]
      .filter((row) => row.hasAttribute('data-active'))
      .map((row) => row.textContent ?? '');

    it('"Current Location" is the highlighted row when the editor opens', () => {
      openCellEditor(makeProperty('place'), null, makeAnchor(), makeEditorContext({ geocode: vi.fn().mockResolvedValue([]), currentLocation: vi.fn() }));

      expect(active()).toEqual(['tools.database.placeCurrentLocation']);
    });

    it('Enter on open picks "Current Location" and stays open on the place (notion-spec-2 §19.18)', async () => {
      const onCommit = vi.fn();
      const currentLocation = vi.fn().mockResolvedValue(EIFFEL);
      const handle = openCellEditor(makeProperty('place'), null, makeAnchor(), makeEditorContext({ geocode: vi.fn().mockResolvedValue([]), currentLocation, onCommit }));
      const enter = press(field(), 'Enter');

      await settle();

      expect(onCommit).toHaveBeenCalledTimes(1);
      expect(onCommit).toHaveBeenCalledWith(EIFFEL);
      expect(enter.defaultPrevented).toBe(true);
      expect(handle.isOpen).toBe(true);
      expect(document.querySelector('[data-blok-database-place-view] [data-blok-database-place-name]')?.textContent).toBe('Eiffel Tower');
    });

    it('a Current Location that arrives after the editor closed writes nothing', async () => {
      const onCommit = vi.fn();
      const late: { resolve: (place: PlaceValue) => void } = { resolve: () => undefined };
      const currentLocation = vi.fn(() => new Promise<PlaceValue>((resolve) => {
        late.resolve = resolve;
      }));
      const handle = openCellEditor(makeProperty('place'), null, makeAnchor(), makeEditorContext({ currentLocation, onCommit }));

      press(field(), 'Enter');
      await settle();
      handle.cancel();
      onCommit.mockClear();
      late.resolve(EIFFEL);
      await settle();

      expect(onCommit).not.toHaveBeenCalled();
    });

    it('ArrowDown then Enter picks the first result and saves it at once', async () => {
      const onCommit = vi.fn();
      const geocode = vi.fn().mockResolvedValue([EIFFEL, { name: 'Paris', address: 'Paris, France', lat: 1, lon: 2 }]);

      openCellEditor(makeProperty('place'), null, makeAnchor(), makeEditorContext({ geocode, currentLocation: vi.fn(), onCommit }));
      type('Eiffel');
      await settle();
      const down = press(field(), 'ArrowDown');

      expect(down.defaultPrevented).toBe(true);
      expect(active()).toEqual(['Eiffel Tower5 Avenue Anatole France, 75007 Paris, France']);
      press(field(), 'Enter');

      expect(onCommit).toHaveBeenCalledTimes(1);
      expect(onCommit).toHaveBeenCalledWith(EIFFEL);
    });

    it('ArrowUp moves back, and the highlight stops at the ends', async () => {
      const geocode = vi.fn().mockResolvedValue([EIFFEL]);

      openCellEditor(makeProperty('place'), null, makeAnchor(), makeEditorContext({ geocode, currentLocation: vi.fn() }));
      type('Eiffel');
      await settle();
      press(field(), 'ArrowDown');
      press(field(), 'ArrowDown');
      expect(active()).toEqual(['Eiffel Tower5 Avenue Anatole France, 75007 Paris, France']);
      press(field(), 'ArrowUp');
      press(field(), 'ArrowUp');
      expect(active()).toEqual(['tools.database.placeCurrentLocation']);
    });

    it('the pointer moves the one highlight', async () => {
      openCellEditor(makeProperty('place'), null, makeAnchor(), makeEditorContext({ geocode: vi.fn().mockResolvedValue([EIFFEL]), currentLocation: vi.fn() }));
      type('Eiffel');
      await settle();
      document.querySelector('[data-blok-database-place-result-name]')?.dispatchEvent(new PointerEvent('pointermove', { bubbles: true }));

      expect(active()).toEqual(['Eiffel Tower5 Avenue Anatole France, 75007 Paris, France']);
    });

    it('without "Current Location" the first result is highlighted once results come', async () => {
      const onCommit = vi.fn();

      openCellEditor(makeProperty('place'), null, makeAnchor(), makeEditorContext({ geocode: vi.fn().mockResolvedValue([EIFFEL]), onCommit }));
      type('Eiffel');
      await settle();
      expect(active()).toEqual(['Eiffel Tower5 Avenue Anatole France, 75007 Paris, France']);
      press(field(), 'ArrowDown');
      press(field(), 'Enter');

      expect(onCommit).toHaveBeenCalledWith(EIFFEL);
    });
  });

  it('Enter still stores the typed text as an address', async () => {
    const onCommit = vi.fn();
    const geocode = vi.fn().mockResolvedValue([EIFFEL]);

    openCellEditor(makeProperty('place'), null, makeAnchor(), makeEditorContext({ geocode, onCommit }));
    type('1 Main St');
    press(field(), 'Enter');

    expect(onCommit).toHaveBeenCalledWith({ address: '1 Main St' });
  });

  describe('a saved place stays until a result is picked or × clears it (research/31 §4a; Notion clears it on the first key)', () => {
    it('Escape after a search writes nothing', async () => {
      const onCommit = vi.fn();
      const geocode = vi.fn().mockResolvedValue([EIFFEL]);

      openCellEditor(makeProperty('place'), EIFFEL, makeAnchor(), makeEditorContext({ geocode, onCommit }));
      press(document.activeElement ?? document.body, 'B');
      type('Ber');
      await settle();
      press(field(), 'Escape');

      expect(onCommit).not.toHaveBeenCalled();
      expect(editorRoot()).toBeNull();
    });

    it('a press outside with a search nobody picked from writes nothing', async () => {
      const onCommit = vi.fn();
      const geocode = vi.fn().mockResolvedValue([EIFFEL]);

      openCellEditor(makeProperty('place'), EIFFEL, makeAnchor(), makeEditorContext({ geocode, onCommit }));
      press(document.activeElement ?? document.body, 'B');
      type('Ber');
      await settle();
      pressOutside();
      await Promise.resolve();

      expect(onCommit).not.toHaveBeenCalled();
      expect(editorRoot()).toBeNull();
    });
  });

  it('without a geocoder the field is a plain address field: no search, no results', async () => {
    openCellEditor(makeProperty('place'), null, makeAnchor(), makeEditorContext());
    type('Eiffel');
    await settle();

    expect(field().placeholder).toBe('');
    expect(document.querySelector('[data-blok-database-place-results]')).toBeNull();
  });

  it('"Current Location" shows only with the host hook, first, and stores what the host returns', async () => {
    openCellEditor(makeProperty('place'), null, makeAnchor(), makeEditorContext({ geocode: vi.fn().mockResolvedValue([]) }));
    expect(document.querySelector('[data-blok-database-place-current]')).toBeNull();
    PopoverRegistry.resetForTests();
    document.body.innerHTML = '';

    const onCommit = vi.fn();
    const currentLocation = vi.fn().mockResolvedValue({ name: 'Here', lat: 1, lon: 2 });

    openCellEditor(makeProperty('place'), null, makeAnchor(), makeEditorContext({ currentLocation, onCommit }));
    const current = document.querySelector<HTMLElement>('[data-blok-database-place-current]');

    expect(current?.textContent).toBe('tools.database.placeCurrentLocation');
    expect(current?.parentElement?.firstElementChild).toBe(current);
    current?.click();
    await settle();

    expect(onCommit).toHaveBeenCalledWith({ name: 'Here', lat: 1, lon: 2 });
  });

  it('"Current Location" that finds nothing stores nothing', async () => {
    const onCommit = vi.fn();

    openCellEditor(makeProperty('place'), null, makeAnchor(), makeEditorContext({ currentLocation: vi.fn().mockResolvedValue(null), onCommit }));
    document.querySelector<HTMLElement>('[data-blok-database-place-current]')?.click();
    await settle();

    expect(onCommit).not.toHaveBeenCalled();
  });
});
