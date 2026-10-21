import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { PopoverDesktop } from '../../../../../src/components/utils/popover/popover-desktop';

const key = (target: HTMLElement, name: 'ArrowUp' | 'ArrowDown' | 'Enter', keyCode: number): void => {
  target.dispatchEvent(new KeyboardEvent('keydown', { key: name, code: name, keyCode, bubbles: true }));
};

/** research/30 §B7c: the "/" menu's footer "Close menu  esc". */
describe('PopoverDesktop footer', () => {
  let popover: PopoverDesktop;
  let onActivate: ReturnType<typeof vi.fn<() => void>>;

  const footer = (): HTMLElement => {
    const el = popover.getElement().querySelector<HTMLElement>('[data-blok-testid="popover-footer-action"]');

    if (el === null) {
      throw new Error('no footer');
    }

    return el;
  };
  const focusedName = (): string | null => {
    const el = popover.getElement().querySelector('[data-blok-focused="true"]');

    return el === null ? null : el.getAttribute('data-blok-item-name') ?? el.getAttribute('data-blok-testid');
  };

  beforeEach(() => {
    vi.clearAllMocks();
    onActivate = vi.fn<() => void>();
    popover = new PopoverDesktop({
      items: [
        { title: 'Alpha', name: 'alpha', onActivate: vi.fn() },
        { title: 'Beta', name: 'beta', onActivate: vi.fn() },
      ],
    });
    popover.setFooter({ label: 'Close menu', shortcut: 'esc', onActivate });
    document.body.appendChild(popover.getElement());
  });

  afterEach(() => {
    popover.destroy();
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  it('reads "Close menu" with "esc" on its right, outside the scrolling list', () => {
    const el = footer();

    expect(el.textContent).toBe('Close menuesc');
    expect(el.getAttribute('role')).toBe('button');
    expect(el.querySelector('[aria-hidden="true"]')?.textContent).toBe('esc');
    expect(el.closest('[data-blok-popover-items]')).toBeNull();
    expect(el.closest('[data-blok-popover-container]')).not.toBeNull();
  });

  it('is reached by ArrowUp from the first row, and ArrowUp from it goes to the last row', () => {
    popover.show();
    key(popover.getElement(), 'ArrowDown', 40);
    expect(focusedName()).toBe('alpha');

    key(popover.getElement(), 'ArrowUp', 38);
    expect(focusedName()).toBe('popover-footer-action');

    key(popover.getElement(), 'ArrowUp', 38);
    expect(focusedName()).toBe('beta');
  });

  it('runs its action on Enter and on click', () => {
    popover.show();
    key(popover.getElement(), 'ArrowUp', 38);
    key(popover.getElement(), 'Enter', 13);
    expect(onActivate).toHaveBeenCalledTimes(1);

    footer().click();
    expect(onActivate).toHaveBeenCalledTimes(2);
  });

  it('keeps the caret where it is on mousedown', () => {
    const event = new MouseEvent('mousedown', { bubbles: true, cancelable: true });

    footer().dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
  });

  it('stays after a search, and a query with no match highlights nothing', () => {
    popover.show();
    popover.filterItems('beta');
    expect(focusedName()).toBe('beta');
    expect(footer().isConnected).toBe(true);

    popover.filterItems('zzz');
    expect(focusedName()).toBeNull();
    key(popover.getElement(), 'ArrowUp', 38);
    expect(focusedName()).toBe('popover-footer-action');
  });

  it('has no hint and paints its highlight with the rows\' neutral tokens', () => {
    const classes = footer().className.split(' ');
    const row = popover.getElement().querySelector<HTMLElement>('[data-blok-item-name="alpha"]');

    expect(footer().hasAttribute('aria-describedby')).toBe(false);
    expect(classes).toContain('data-[blok-focused="true"]:bg-item-focus-bg');
    expect(classes).toContain('can-hover:hover:bg-item-hover-bg');
    expect(classes).toContain('text-popover-item-label');
    expect(row?.className).toContain('data-[blok-focused="true"]:bg-item-focus-bg');
    expect(footer().className).not.toMatch(/blue|accent|link/);
  });
});
