import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { PopoverDesktop } from '../../../../../src/components/utils/popover/popover-desktop';
import type { PopoverCurrentItem } from '../../../../../src/components/utils/popover/popover-desktop';

const itemEl = (popover: PopoverDesktop, name: string): HTMLElement => {
  const el = popover.getElement().querySelector<HTMLElement>(`[data-blok-item-name="${name}"]`);

  if (el === null) {
    throw new Error(`no item ${name}`);
  }

  return el;
};

const hover = (el: HTMLElement, x: number, y: number): void => {
  el.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, clientX: x, clientY: y }));
};

describe('PopoverDesktop current item', () => {
  let popover: PopoverDesktop;
  let seen: Array<PopoverCurrentItem | null>;

  beforeEach(() => {
    vi.clearAllMocks();
    seen = [];
    popover = new PopoverDesktop({
      items: [
        { title: 'Alpha', name: 'alpha', onActivate: vi.fn() },
        { title: 'Beta', name: 'beta', onActivate: vi.fn() },
      ],
    });
    document.body.appendChild(popover.getElement());
    popover.onCurrentItemChange((current) => seen.push(current));
    // The pointer is somewhere on the page before the menu opens.
    document.body.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: 1, clientY: 1 }));
  });

  afterEach(() => {
    popover.destroy();
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  it('reports a genuinely hovered row with its name and element', () => {
    popover.show();
    document.body.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: 5, clientY: 5 }));
    hover(itemEl(popover, 'beta'), 7, 9);

    expect(seen.at(-1)).toEqual({ name: 'beta', element: itemEl(popover, 'beta'), source: 'pointer' });
  });

  it('ignores the hover the browser synthesizes under a parked pointer on open', () => {
    document.body.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: 40, clientY: 40 }));
    popover.show();
    hover(itemEl(popover, 'alpha'), 40, 40);

    expect(seen.filter((entry) => entry !== null)).toEqual([]);
  });

  it('reports each row only once while the pointer stays on it', () => {
    popover.show();
    document.body.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: 5, clientY: 5 }));
    hover(itemEl(popover, 'alpha'), 5, 5);
    hover(itemEl(popover, 'alpha'), 6, 6);

    expect(seen.filter((entry) => entry?.name === 'alpha')).toHaveLength(1);
  });

  it('reports the keyboard-focused row after an arrow key', () => {
    popover.show();
    popover.getElement().dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', code: 'ArrowDown', keyCode: 40, bubbles: true }));

    const last = seen.at(-1);

    expect(last?.source).toBe('keyboard');
    expect(['alpha', 'beta']).toContain(last?.name);
  });

  it('clears when the pointer leaves the menu', () => {
    popover.show();
    document.body.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: 5, clientY: 5 }));
    hover(itemEl(popover, 'beta'), 7, 9);
    popover.getElement().querySelector('[data-blok-popover-container]')
      ?.dispatchEvent(new MouseEvent('mouseleave', { relatedTarget: document.body }));

    expect(seen.at(-1)).toBeNull();
  });

  it('clears when the menu hides', () => {
    popover.show();
    document.body.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: 5, clientY: 5 }));
    hover(itemEl(popover, 'beta'), 7, 9);
    popover.hide();

    expect(seen.at(-1)).toBeNull();
  });
});
