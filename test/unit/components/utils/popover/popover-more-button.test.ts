import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { PopoverDesktop } from '../../../../../src/components/utils/popover/popover-desktop';
import { PopoverMobile } from '../../../../../src/components/utils/popover/popover-mobile';
import { destroy as destroyTooltip, HINT_DELAY } from '../../../../../src/components/utils/tooltip';
import type { PopoverItemParams } from '../../../../../types/utils/popover/popover-item';

const itemEl = (name: string): HTMLElement | null => document.querySelector<HTMLElement>(`[data-blok-item-name="${name}"]`);
const moreOf = (name: string): HTMLElement | null => itemEl(name)?.querySelector<HTMLElement>('[data-blok-popover-item-more]') ?? null;

const key = (popover: PopoverDesktop, name: 'ArrowDown' | 'ArrowRight' | 'Enter', keyCode: number): void => {
  popover.getElement().dispatchEvent(new KeyboardEvent('keydown', { key: name, code: name, keyCode, bubbles: true }));
};

const focusRow = (popover: PopoverDesktop, name: string): void => {
  for (const _ of [0, 1, 2, 3]) {
    if (itemEl(name)?.getAttribute('data-blok-focused') === 'true') return;
    key(popover, 'ArrowDown', 40);
  }
  if (itemEl(name)?.getAttribute('data-blok-focused') !== 'true') throw new Error(`could not focus ${name}`);
};

const hover = (el: HTMLElement | null, x: number): void => {
  document.body.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: x, clientY: x }));
  el?.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, clientX: x, clientY: x }));
  el?.dispatchEvent(new MouseEvent('mouseenter', { clientX: x, clientY: x }));
};

/**
 * research/30 X1, research/33 §3.8: a template row has a "…" button. A click
 * on the row uses the template; only a click on "…" opens its submenu.
 */
describe('Popover: children.moreButton', () => {
  const onRow = vi.fn();
  const onChild = vi.fn();
  const items = (): PopoverItemParams[] => [
    { title: 'Hover parent', name: 'hover-parent', children: { items: [{ title: 'Hover child', name: 'hover-child', onActivate: vi.fn() }] } },
    {
      title: 'Row',
      name: 'row',
      onActivate: onRow,
      closeOnActivate: true,
      children: { moreButton: { label: 'Edit this template' }, items: [{ title: 'Child', name: 'child', onActivate: onChild }] },
    },
  ];
  const popovers: Array<PopoverDesktop | PopoverMobile> = [];
  const open = (): PopoverDesktop => {
    const popover = new PopoverDesktop({ items: items() });

    popovers.push(popover);
    document.body.appendChild(popover.getElement());
    document.body.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: 1, clientY: 1 }));
    popover.show();

    return popover;
  };

  beforeEach(() => {
    vi.clearAllMocks();
    destroyTooltip();
  });

  afterEach(() => {
    vi.useRealTimers();
    popovers.splice(0).forEach((popover) => popover.destroy());
    destroyTooltip();
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  it('draws "…" in place of the chevron, hidden from assistive tech', () => {
    open();

    const more = moreOf('row');

    expect(more).not.toBeNull();
    expect(more?.querySelector('svg')).not.toBeNull();
    expect(more?.getAttribute('aria-hidden')).toBe('true');
    expect(more?.hasAttribute('tabindex')).toBe(false);
    expect(itemEl('row')?.querySelector('[data-blok-testid="popover-item-chevron-right"]')).toBeNull();
    // The row still says it has a submenu.
    expect(itemEl('row')?.getAttribute('aria-expanded')).toBe('false');
    // Rows without the lever keep their chevron.
    expect(moreOf('hover-parent')).toBeNull();
    expect(itemEl('hover-parent')?.querySelector('[data-blok-testid="popover-item-chevron-right"]')).not.toBeNull();
  });

  it('a click on "…" opens the submenu and does not run the row action', () => {
    open();
    moreOf('row')?.click();

    expect(itemEl('child')).not.toBeNull();
    expect(onRow).not.toHaveBeenCalled();
  });

  it('a click on the row runs its action and does not open the submenu', () => {
    open();
    itemEl('row')?.click();

    expect(onRow).toHaveBeenCalledTimes(1);
    expect(itemEl('child')).toBeNull();
  });

  it('hovering the row never opens the submenu', () => {
    vi.useFakeTimers();
    open();
    hover(itemEl('row'), 9);
    vi.advanceTimersByTime(2000);

    expect(itemEl('child')).toBeNull();
    expect(onRow).not.toHaveBeenCalled();
  });

  it('moving onto the row from an open hover submenu does not open the row submenu', () => {
    vi.useFakeTimers();
    open();
    hover(itemEl('hover-parent'), 9);
    vi.advanceTimersByTime(1000);
    expect(itemEl('hover-child')).not.toBeNull();

    hover(itemEl('row'), 20);
    vi.advanceTimersByTime(2000);

    expect(itemEl('child')).toBeNull();
  });

  it('"…" shows its label as a hint after the hint delay', () => {
    vi.useFakeTimers();
    open();

    const more = moreOf('row');

    if (more === null) throw new Error('no "…"');
    vi.spyOn(more, 'getBoundingClientRect').mockReturnValue(DOMRect.fromRect({ x: 300, y: 300, width: 24, height: 24 }));
    more.dispatchEvent(new MouseEvent('mouseenter'));
    vi.advanceTimersByTime(HINT_DELAY - 1);
    expect(document.querySelector('[data-blok-testid="tooltip"]')?.getAttribute('data-blok-shown')).not.toBe('true');
    vi.advanceTimersByTime(1);
    expect(document.querySelector('[data-blok-testid="tooltip"]')?.getAttribute('data-blok-shown')).toBe('true');
    expect(document.querySelector('[data-blok-testid="tooltip-content"]')?.textContent).toBe('Edit this template');
  });

  it('ArrowRight opens the submenu, Enter runs the row action', () => {
    const popover = open();

    focusRow(popover, 'row');
    key(popover, 'ArrowRight', 39);
    expect(itemEl('child')).not.toBeNull();
    expect(onRow).not.toHaveBeenCalled();
  });

  // research/35 §14: ArrowRight in the "…" submenu does nothing. ArrowLeft still closes it:
  // Blok keeps the menu pattern there (Notion's ArrowLeft did nothing).
  it('ArrowRight in the "…" submenu does nothing', () => {
    const popover = open();

    focusRow(popover, 'row');
    key(popover, 'ArrowRight', 39);
    key(popover, 'ArrowDown', 40);
    expect(itemEl('child')?.getAttribute('data-blok-focused')).toBe('true');

    key(popover, 'ArrowRight', 39);
    expect(itemEl('child')?.getAttribute('data-blok-focused')).toBe('true');
    expect(onChild).not.toHaveBeenCalled();
  });

  it.each([[true, true], [false, false]])('Escape in the "…" submenu with escapeClosesSubmenuFirst %s keeps the menu: %s', (opt, kept) => {
    const trigger = document.createElement('button');

    document.body.appendChild(trigger);
    const popover = new PopoverDesktop({ items: items(), trigger });

    popovers.push(popover);
    document.body.appendChild(popover.getElement());
    popover.show();
    popover.escapeClosesSubmenuFirst = opt;
    focusRow(popover, 'row');
    key(popover, 'ArrowRight', 39);
    key(popover, 'ArrowDown', 40);
    itemEl('child')?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', keyCode: 27, bubbles: true, cancelable: true }));

    expect(itemEl('child')).toBeNull();
    expect(popover.getElement().hasAttribute('data-blok-popover-opened') || popover.getElement().querySelector('[data-blok-popover-opened]') !== null).toBe(kept);
  });

  it('Enter on the row runs its action', () => {
    const popover = open();

    focusRow(popover, 'row');
    key(popover, 'Enter', 13);

    expect(onRow).toHaveBeenCalledTimes(1);
    expect(itemEl('child')).toBeNull();
  });

  const openMobile = (): PopoverMobile => {
    const popover = new PopoverMobile({ items: items() });

    popovers.push(popover);
    document.body.appendChild(popover.getElement());
    popover.show();

    return popover;
  };

  it('on mobile a tap on the row runs its action and does not open the submenu', () => {
    openMobile();
    itemEl('row')?.click();

    expect(onRow).toHaveBeenCalledTimes(1);
    expect(itemEl('child')).toBeNull();
  });

  it('on mobile a tap on "…" opens the submenu and does not run the row action', () => {
    openMobile();
    moreOf('row')?.click();

    expect(itemEl('child')).not.toBeNull();
    expect(onRow).not.toHaveBeenCalled();
  });
});
