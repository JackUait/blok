import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { openCellEditor } from '../../../../../src/tools/database/cells';
import { PopoverRegistry } from '../../../../../src/components/utils/popover/popover-registry';
import type { PlaceValue } from '../../../../../src/tools/database/types';
import { editorRoot, makeAnchor, makeEditorContext, makeProperty, press } from './helpers';

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
    expect(editorRoot()).toBeNull();
  });

  it('picking the place a cell already holds still stores it whole', async () => {
    const onCommit = vi.fn();
    const geocode = vi.fn().mockResolvedValue([EIFFEL]);

    openCellEditor(makeProperty('place'), { address: EIFFEL.address }, makeAnchor(), makeEditorContext({ geocode, onCommit }));
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

  it('Enter still stores the typed text as an address', async () => {
    const onCommit = vi.fn();
    const geocode = vi.fn().mockResolvedValue([EIFFEL]);

    openCellEditor(makeProperty('place'), null, makeAnchor(), makeEditorContext({ geocode, onCommit }));
    type('1 Main St');
    press(field(), 'Enter');

    expect(onCommit).toHaveBeenCalledWith({ address: '1 Main St' });
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
