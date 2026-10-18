import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { openCellEditor, renderCellValue } from '../../../../../src/tools/database/cells';
import { PopoverRegistry } from '../../../../../src/components/utils/popover/popover-registry';
import { onHover } from '../../../../../src/components/utils/tooltip';
import type * as Tooltip from '../../../../../src/components/utils/tooltip';
import { editorRoot, makeAnchor, makeEditorContext, makeProperty } from './helpers';

vi.mock('../../../../../src/components/utils/tooltip', async (importOriginal) => ({
  ...await importOriginal<typeof Tooltip>(),
  onHover: vi.fn(),
}));

const EIFFEL = { name: 'Eiffel Tower', address: '5 Avenue Anatole France, 75007 Paris, France' };

/** The card the cell handed the hover lever. */
const hoverCard = (cell: HTMLElement): HTMLElement | undefined => {
  const call = vi.mocked(onHover).mock.calls.find(([element]) => element === cell);

  return call?.[1] instanceof HTMLElement ? call[1] : undefined;
};

describe('place cell (research/20 §1d)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    PopoverRegistry.resetForTests();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  it('a filled cell hovers into a card with the name and the address', () => {
    const cell = renderCellValue(makeProperty('place'), EIFFEL, makeEditorContext());
    const card = hoverCard(cell);

    expect(cell.textContent).toBe('Eiffel Tower');
    expect(card?.querySelector('[data-blok-database-place-card-name]')?.textContent).toBe('Eiffel Tower');
    expect(card?.querySelector('[data-blok-database-place-card-address]')?.textContent).toBe(EIFFEL.address);
    expect(card?.querySelector('[data-blok-database-place-card-map]')).toBeNull();
  });

  it('the card draws the host mini-map once, on the first hover, when the host can draw one', () => {
    const renderPlace = vi.fn();
    const cell = renderCellValue(makeProperty('place'), EIFFEL, makeEditorContext({ renderPlace }));
    const map = hoverCard(cell)?.querySelector<HTMLElement>('[data-blok-database-place-card-map]');

    expect(renderPlace).not.toHaveBeenCalled();
    cell.dispatchEvent(new MouseEvent('mouseenter'));
    cell.dispatchEvent(new MouseEvent('mouseenter'));

    expect(renderPlace).toHaveBeenCalledTimes(1);
    expect(renderPlace).toHaveBeenCalledWith(map, EIFFEL);
  });

  it('an empty place has no hover card', () => {
    const cell = renderCellValue(makeProperty('place'), null, makeEditorContext());

    expect(hoverCard(cell)).toBeUndefined();
  });

  it('the editor links the place to a Google Maps search in a new tab', () => {
    openCellEditor(makeProperty('place'), EIFFEL, makeAnchor(), makeEditorContext());
    const link = editorRoot()?.querySelector<HTMLAnchorElement>('[data-blok-database-place-google-maps]');

    expect(link?.href).toBe(`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${EIFFEL.name},${EIFFEL.address}`)}`);
    expect(link?.target).toBe('_blank');
    expect(link?.rel.split(' ')).toContain('noopener');
    expect(link?.textContent).toBe('tools.database.placeOpenInGoogleMaps');
  });

  it('an empty place has no Google Maps link', () => {
    openCellEditor(makeProperty('place'), null, makeAnchor(), makeEditorContext());

    expect(editorRoot()?.querySelector('[data-blok-database-place-google-maps]')).toBeNull();
  });
});
