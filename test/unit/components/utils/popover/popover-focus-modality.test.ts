import { describe, it, expect, afterEach, vi } from 'vitest';

import { PopoverDesktop } from '../../../../../src/components/utils/popover/popover-desktop';
import { DATA_ATTR } from '../../../../../src/components/constants/data-attributes';
import type { PopoverParams } from '@/types/utils/popover/popover';

const items: PopoverParams['items'] = [
  { title: 'Alpha', name: 'alpha', onActivate: (): void => {} },
  { title: 'Beta', name: 'beta', onActivate: (): void => {} },
];

const openPopovers: PopoverDesktop[] = [];

/**
 * Dispatched on an element rather than on `document`: the Flipper's own keydown
 * handler reads attributes off the event target, and `document` has none.
 */
const gesture = (type: 'keydown' | 'pointerdown'): void => {
  document.body.dispatchEvent(new Event(type, { bubbles: true }));
};

const createPopover = (): PopoverDesktop => {
  const scope = document.createElement('div');

  document.body.appendChild(scope);

  const popover = new PopoverDesktop({
    items,
    scopeElement: scope,
  });

  openPopovers.push(popover);
  document.body.appendChild(popover.getMountElement());

  return popover;
};

/** Titles of the items currently carrying Blok's own focus cursor. */
const focusedTitles = (popover: PopoverDesktop): string[] => {
  return [ ...popover.getElement().querySelectorAll<HTMLElement>(`[${DATA_ATTR.popoverItem}]`) ]
    .filter(el => el.getAttribute(DATA_ATTR.focused) === 'true')
    .map(el => el.textContent?.trim() ?? '');
};

/** show() places the initial cursor in a microtask. */
const showAndSettle = async (popover: PopoverDesktop): Promise<void> => {
  popover.show();
  await Promise.resolve();
};

afterEach(() => {
  openPopovers.splice(0).forEach(popover => popover.destroy());
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

describe('PopoverDesktop — the focus cursor is keyboard-only', () => {
  it('places no focus cursor when the popover was opened by a pointer', async () => {
    gesture('pointerdown');

    const popover = createPopover();

    await showAndSettle(popover);

    expect(focusedTitles(popover)).toEqual([]);
  });

  it('places the cursor on the first item when the popover was opened from the keyboard', async () => {
    gesture('keydown');

    const popover = createPopover();

    await showAndSettle(popover);

    expect(focusedTitles(popover)).toEqual([ 'Alpha' ]);
  });

  it('restores the cursor as soon as the user returns to the keyboard', async () => {
    gesture('pointerdown');

    const pointerOpened = createPopover();

    await showAndSettle(pointerOpened);
    expect(focusedTitles(pointerOpened)).toEqual([]);

    gesture('keydown');

    const keyboardOpened = createPopover();

    await showAndSettle(keyboardOpened);
    expect(focusedTitles(keyboardOpened)).toEqual([ 'Alpha' ]);
  });
});
