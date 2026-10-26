import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { PopoverDesktop } from '../../../../../src/components/utils/popover/popover-desktop';
import type { PopoverItemParams } from '../../../../../types/utils/popover/popover-item';

const itemEl = (name: string): HTMLElement | null => document.querySelector<HTMLElement>(`[data-blok-item-name="${name}"]`);

const hover = (el: HTMLElement | null, x: number): void => {
  document.body.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: x, clientY: x }));
  el?.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, clientX: x, clientY: x }));
};

const rect = (left: number, top: number, width: number, height: number): DOMRect => DOMRect.fromRect({ x: left, y: top, width, height });

/**
 * notion-spec-2 §11: Notion's Color list is a dropdown on the Color button. It opens on click or
 * a key, never on hover, over or under the button, and moving over other rows leaves it open.
 */
describe('Popover: children.placement dropdown', () => {
  const items = (): PopoverItemParams[] => [
    { title: 'Other', name: 'other', onActivate: vi.fn() },
    {
      title: 'Color',
      name: 'color',
      valueLabel: 'Green',
      children: { placement: 'dropdown', items: [{ title: 'Red', name: 'red', onActivate: vi.fn() }] },
    },
  ];
  const popovers: PopoverDesktop[] = [];
  const open = (): PopoverDesktop => {
    const popover = new PopoverDesktop({ items: items() });

    popovers.push(popover);
    document.body.appendChild(popover.getElement());
    document.body.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: 1, clientY: 1 }));
    popover.show();

    return popover;
  };

  /** The Color row at 300..534 x 400..428, its value at 409..486, in a menu at 280,180. */
  const placeRow = (popover: PopoverDesktop): void => {
    const row = itemEl('color');
    const value = row?.querySelector<HTMLElement>('[data-blok-popover-item-value]');

    if (row === null || value === null || value === undefined) throw new Error('no Color row');
    vi.spyOn(row, 'getBoundingClientRect').mockReturnValue(rect(300, 400, 234, 28));
    vi.spyOn(value, 'getBoundingClientRect').mockReturnValue(rect(409, 405, 77, 18));
    vi.spyOn(popover.getElement(), 'getBoundingClientRect').mockReturnValue(rect(280, 180, 300, 400));
  };

  const listBox = (): HTMLElement | null =>
    itemEl('red')?.closest<HTMLElement>('[data-blok-popover-container]') ?? null;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
    popovers.splice(0).forEach((popover) => popover.destroy());
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  it('hovering the row never opens the list', () => {
    vi.useFakeTimers();
    open();
    hover(itemEl('color'), 9);
    vi.advanceTimersByTime(2000);

    expect(itemEl('red')).toBeNull();
  });

  it('a click on the row opens the list', () => {
    open();
    itemEl('color')?.click();

    expect(itemEl('red')).not.toBeNull();
  });

  // Notion's button pads the value 8px and stands 4px past the 28px row on each side.
  it('opens under the button, its start edge on the button\'s', () => {
    vi.spyOn(window, 'innerHeight', 'get').mockReturnValue(900);
    const popover = open();

    placeRow(popover);
    itemEl('color')?.click();

    // Button left 409 - 8 = 401, bottom 428 + 4 = 432; in the menu's space (280, 180).
    expect(listBox()?.style.left).toBe('121px');
    expect(listBox()?.style.top).toBe('252px');
  });

  it('opens over the button when there is no room under it', () => {
    vi.spyOn(window, 'innerHeight', 'get').mockReturnValue(436);
    const popover = open();

    placeRow(popover);
    itemEl('color')?.click();

    // jsdom measures the list 0 tall: its bottom, and so its top, sits on the button top 400 - 4.
    expect(listBox()?.style.top).toBe('216px');
    expect(listBox()?.closest('[data-blok-popover][data-side]')?.getAttribute('data-side')).toBe('top');
  });

  it('stays open while the pointer crosses other rows', () => {
    vi.useFakeTimers();
    open();
    itemEl('color')?.click();
    hover(itemEl('other'), 20);
    vi.advanceTimersByTime(2000);

    expect(itemEl('red')).not.toBeNull();
  });

  it('a click elsewhere in the menu closes the list', () => {
    open();
    itemEl('color')?.click();
    itemEl('other')?.click();

    expect(itemEl('red')).toBeNull();
  });
});
