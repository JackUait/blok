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
 * notion-spec-2 §16.1: Number format, Decimal places and Calculate open on a click only. The list
 * drops under the row, its end edge on the row's, and a layer covers the panel while it is open.
 */
describe('Popover: children.clickOnly and placement under', () => {
  const items = (placement?: 'under'): PopoverItemParams[] => [
    { title: 'Type', name: 'type', children: { items: [{ title: 'Text', name: 'text', onActivate: vi.fn() }] } },
    {
      title: 'Decimal places',
      name: 'decimals',
      valueLabel: 'Default',
      children: { clickOnly: true, ...(placement === undefined ? {} : { placement }), width: '200px', items: [{ title: '2', name: 'two', onActivate: vi.fn() }] },
    },
  ];
  const popovers: PopoverDesktop[] = [];
  const open = (placement?: 'under'): PopoverDesktop => {
    const popover = new PopoverDesktop({ items: items(placement) });

    popovers.push(popover);
    document.body.appendChild(popover.getElement());
    document.body.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: 1, clientY: 1 }));
    popover.show();

    return popover;
  };

  /** The Decimal places row at 300..534 x 400..428, in a menu at 280,180. The list is 200 wide. */
  const placeRow = (popover: PopoverDesktop): void => {
    const row = itemEl('decimals');

    if (row === null) throw new Error('no Decimal places row');
    vi.spyOn(row, 'getBoundingClientRect').mockReturnValue(rect(300, 400, 234, 28));
    vi.spyOn(popover.getElement(), 'getBoundingClientRect').mockReturnValue(rect(280, 180, 300, 400));
    vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(200);
  };

  const listBox = (): HTMLElement | null =>
    itemEl('two')?.closest<HTMLElement>('[data-blok-popover-container]') ?? null;
  const cover = (): HTMLElement | null => document.querySelector<HTMLElement>('[data-blok-popover-cover]');

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
    popovers.splice(0).forEach((popover) => popover.destroy());
    document.body.innerHTML = '';
    document.documentElement.removeAttribute('dir');
    vi.restoreAllMocks();
  });

  it('hovering the row never opens the list', () => {
    vi.useFakeTimers();
    open();
    hover(itemEl('decimals'), 9);
    vi.advanceTimersByTime(3000);

    expect(itemEl('two')).toBeNull();
  });

  it('keeps the chevron and draws no dropdown button', () => {
    open();

    expect(itemEl('decimals')?.querySelector('[data-blok-popover-item-icon-chevron-right]')).not.toBeNull();
    expect(itemEl('decimals')?.querySelector('[data-blok-popover-item-dropdown-button]')).toBeNull();
  });

  it('a click on the row opens the list', () => {
    open();
    itemEl('decimals')?.click();

    expect(itemEl('two')).not.toBeNull();
  });

  it('while the list is open, hovering another row opens nothing and the list stays', () => {
    vi.useFakeTimers();
    open();
    itemEl('decimals')?.click();
    hover(itemEl('type'), 20);
    vi.advanceTimersByTime(2000);

    expect(itemEl('text')).toBeNull();
    expect(itemEl('two')).not.toBeNull();
  });

  it('covers the menu while the list is open; a click on the cover closes the list', () => {
    open();

    expect(cover()).toBeNull();
    itemEl('decimals')?.click();

    expect(cover()).not.toBeNull();
    expect(cover()?.contains(itemEl('two'))).toBe(false);

    cover()?.click();

    expect(itemEl('two')).toBeNull();
    expect(cover()).toBeNull();
  });

  it('other rows still open on hover', () => {
    vi.useFakeTimers();
    open();
    hover(itemEl('type'), 20);
    vi.advanceTimersByTime(2000);

    expect(itemEl('text')).not.toBeNull();
  });

  it('placement under: the list drops from the row\'s bottom edge, its end edge on the row\'s', () => {
    vi.spyOn(window, 'innerHeight', 'get').mockReturnValue(900);
    vi.spyOn(window, 'innerWidth', 'get').mockReturnValue(1200);
    const popover = open('under');

    placeRow(popover);
    itemEl('decimals')?.click();

    // Row right 534 - 200 = 334, row bottom 428; in the menu's space (280, 180).
    expect(listBox()?.style.left).toBe('54px');
    expect(listBox()?.style.top).toBe('248px');
  });

  it('placement under, right to left: the list\'s left edge sits on the row\'s', () => {
    document.documentElement.setAttribute('dir', 'rtl');
    vi.spyOn(window, 'innerHeight', 'get').mockReturnValue(900);
    vi.spyOn(window, 'innerWidth', 'get').mockReturnValue(1200);
    const popover = open('under');

    placeRow(popover);
    itemEl('decimals')?.click();

    expect(listBox()?.style.left).toBe('20px');
  });
});
