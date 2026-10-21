import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { PopoverDesktop } from '../../../../../src/components/utils/popover/popover-desktop';
import { PopoverRegistry } from '../../../../../src/components/utils/popover/popover-registry';

const itemEl = (name: string): HTMLElement | null => document.querySelector<HTMLElement>(`[data-blok-item-name="${name}"]`);
const isOpen = (popover: PopoverDesktop): boolean => popover.getElement().hasAttribute('data-blok-popover-opened');

/**
 * A row that opens a modal keeps its menu open behind it (research/30 B3:
 * Notion's delete-last-view dialog). The dialog is outside the menu, so
 * without the hold a press or focus in it closes the menu.
 */
describe('PopoverDesktop.holdOpen', () => {
  const popovers: PopoverDesktop[] = [];
  const open = (): { popover: PopoverDesktop; dialog: HTMLButtonElement } => {
    const trigger = document.createElement('button');
    const dialog = document.createElement('button');

    document.body.append(trigger, dialog);
    const popover = new PopoverDesktop({
      trigger,
      items: [
        { title: 'Rename', name: 'rename', onActivate: vi.fn() },
        { title: 'Delete', name: 'delete', onActivate: vi.fn() },
      ],
    });

    popovers.push(popover);
    document.body.appendChild(popover.getElement());
    popover.show();

    return { popover, dialog };
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    popovers.splice(0).forEach((popover) => popover.destroy());
    PopoverRegistry.resetForTests();
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  it('a press and focus outside leave a held menu open', () => {
    const { popover, dialog } = open();

    popover.holdOpen();
    dialog.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    dialog.focus();

    expect(isOpen(popover)).toBe(true);
  });

  it('after the release the menu closes on an outside press again, and the named row has the cursor', () => {
    const { popover, dialog } = open();
    const release = popover.holdOpen();

    dialog.focus();
    release('delete');

    expect(isOpen(popover)).toBe(true);
    expect(itemEl('delete')?.getAttribute('data-blok-focused')).toBe('true');

    dialog.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));

    expect(isOpen(popover)).toBe(false);
  });

  it('a release after the menu closed does not bring it back', () => {
    const { popover } = open();
    const release = popover.holdOpen();

    popover.hide();
    release('delete');

    expect(isOpen(popover)).toBe(false);
    expect(PopoverRegistry.instance.hasOpenPopovers()).toBe(false);
  });
});
