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

  it('an address-only place shows in full, and its card titles the first part over the rest (research/20 §1d, notion-live-3 hover-16)', () => {
    const street = { address: 'Eiffel Tower Ln, Paris, TN 38242, United States' };
    const cell = renderCellValue(makeProperty('place'), street, makeEditorContext());
    const card = hoverCard(cell);

    expect(card?.querySelector('[data-blok-database-place-card-name]')?.textContent).toBe('Eiffel Tower Ln');
    expect(card?.querySelector('[data-blok-database-place-card-address]')?.textContent).toBe('Paris, TN 38242, United States');
    expect(cell.textContent).toBe(street.address);
  });

  it('an address with no comma is the card title alone', () => {
    const cell = renderCellValue(makeProperty('place'), { address: 'Atlantis' }, makeEditorContext());
    const card = hoverCard(cell);

    expect(card?.querySelector('[data-blok-database-place-card-name]')?.textContent).toBe('Atlantis');
    expect(card?.querySelector('[data-blok-database-place-card-address]')).toBeNull();
  });

  it('notion-spec-2 §19.18: the card is its own surface, its left edge on the cell, 6px below the row, after the hint delay', () => {
    const tableCell = document.createElement('div');
    const cell = renderCellValue(makeProperty('place'), EIFFEL, makeEditorContext());

    tableCell.setAttribute('data-blok-database-table-cell', '');
    tableCell.appendChild(cell);
    const options = vi.mocked(onHover).mock.calls.find(([element]) => element === cell)?.[2];

    expect(options).toMatchObject({ placement: 'bottom', align: 'start', gap: 6, surface: true });
    expect(options?.delay).toBeUndefined();
    expect(options?.anchor?.(cell)).toBe(tableCell);
    // Off a table (a card, the row page) the value itself is the anchor.
    expect(options?.anchor?.(document.createElement('span'))).toBeInstanceOf(HTMLSpanElement);
  });

  it('the card draws the host mini-map only once it is on screen, and drops it when the card closes', () => {
    vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'cancelAnimationFrame', 'setTimeout'] });
    const destroy = vi.fn();
    const attached: boolean[] = [];
    const renderPlace = vi.fn((container: HTMLElement) => {
      attached.push(container.isConnected);

      return { destroy };
    });
    const cell = renderCellValue(makeProperty('place'), EIFFEL, makeEditorContext({ renderPlace }));
    const card = hoverCard(cell);
    const map = card?.querySelector<HTMLElement>('[data-blok-database-place-card-map]');
    const bubble = document.createElement('div');

    if (card === undefined) throw new Error('no card');
    document.body.appendChild(cell);
    cell.dispatchEvent(new MouseEvent('mouseenter'));
    vi.advanceTimersByTime(100);
    expect(renderPlace).not.toHaveBeenCalled();

    // The hint shows its content after its delay.
    bubble.setAttribute('data-state', 'open');
    bubble.appendChild(card);
    document.body.appendChild(bubble);
    vi.advanceTimersByTime(50);
    expect(renderPlace).toHaveBeenCalledTimes(1);
    expect(renderPlace).toHaveBeenCalledWith(map, EIFFEL);
    expect(attached).toEqual([true]);

    cell.dispatchEvent(new MouseEvent('mouseenter'));
    vi.advanceTimersByTime(50);
    expect(renderPlace).toHaveBeenCalledTimes(1);

    bubble.setAttribute('data-state', 'closed');
    vi.advanceTimersByTime(50);
    expect(destroy).toHaveBeenCalledTimes(1);

    bubble.setAttribute('data-state', 'open');
    cell.dispatchEvent(new MouseEvent('mouseenter'));
    vi.advanceTimersByTime(50);
    expect(renderPlace).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
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
