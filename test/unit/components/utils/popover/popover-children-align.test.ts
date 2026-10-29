import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { PopoverDesktop } from '../../../../../src/components/utils/popover/popover-desktop';
import type { PopoverItemParams } from '../../../../../types/utils/popover/popover-item';

const itemEl = (name: string): HTMLElement | null => document.querySelector<HTMLElement>(`[data-blok-item-name="${name}"]`);

const rect = (left: number, top: number, width: number, height: number): DOMRect => DOMRect.fromRect({ x: left, y: top, width, height });

/**
 * notion-spec-2 §25.6 (editprop-select.txt): the header menu's Edit property submenu has its top on the
 * row's top (246.4), not centred on the row as Notion's group submenus are (§17).
 */
describe('Popover: children.align', () => {
  const popovers: PopoverDesktop[] = [];
  const open = (align?: 'start'): PopoverDesktop => {
    const items: PopoverItemParams[] = [
      { title: 'Other', name: 'other', onActivate: vi.fn() },
      { title: 'Edit', name: 'edit', children: { ...(align === undefined ? {} : { align }), items: [{ title: 'Sort', name: 'sort', onActivate: vi.fn() }] } },
    ];
    const popover = new PopoverDesktop({ items });

    popovers.push(popover);
    document.body.appendChild(popover.getElement());
    popover.show();

    return popover;
  };

  /** The Edit row at 300..520 x 400..428 in a menu at 280,180; the submenu is 182 tall. */
  const placeRow = (popover: PopoverDesktop): void => {
    const row = itemEl('edit');

    if (row === null) throw new Error('no Edit row');
    vi.spyOn(row, 'getBoundingClientRect').mockReturnValue(rect(300, 400, 220, 28));
    vi.spyOn(popover.getElement(), 'getBoundingClientRect').mockReturnValue(rect(280, 180, 240, 400));
    vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(182);
  };

  const submenu = (): HTMLElement | null => itemEl('sort')?.closest<HTMLElement>('[data-blok-popover-container]') ?? null;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(window, 'innerHeight', 'get').mockReturnValue(900);
  });

  afterEach(() => {
    popovers.splice(0).forEach((popover) => popover.destroy());
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  it('puts the submenu top on the row top', () => {
    const popover = open('start');

    placeRow(popover);
    itemEl('edit')?.click();

    // Row top 400, in the menu's space (top 180).
    expect(submenu()?.style.top).toBe('220px');
  });

  it('centres the submenu on the row by default', () => {
    const popover = open();

    placeRow(popover);
    itemEl('edit')?.click();

    // Row centre 414 - 91, in the menu's space.
    expect(submenu()?.style.top).toBe('143px');
  });
});
