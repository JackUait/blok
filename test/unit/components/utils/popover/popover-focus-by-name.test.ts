import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { PopoverDesktop } from '../../../../../src/components/utils/popover/popover-desktop';
import { PopoverRegistry } from '../../../../../src/components/utils/popover/popover-registry';

const itemEl = (name: string): HTMLElement | null => document.querySelector<HTMLElement>(`[data-blok-item-name="${name}"]`);
const focused = (): string[] => [...document.querySelectorAll<HTMLElement>('[data-blok-focused="true"]')].map((el) => el.getAttribute('data-blok-item-name') ?? '');

/**
 * A menu drawn again after a pick puts the cursor back on the row the pick
 * came from (notion-spec-2 §8: "Number format" stays highlighted).
 */
describe('PopoverDesktop.focusItemByName', () => {
  const popovers: PopoverDesktop[] = [];
  const open = (): PopoverDesktop => {
    const trigger = document.createElement('button');

    document.body.append(trigger);
    const popover = new PopoverDesktop({
      trigger,
      autoFocusFirstItem: false,
      items: [
        { title: 'Rename', name: 'rename', onActivate: vi.fn() },
        {
          title: 'Edit',
          name: 'edit',
          children: {
            items: [
              { title: 'Format', name: 'format', children: { items: [{ title: 'Euro', name: 'euro', onActivate: vi.fn() }] } },
              { title: 'Decimals', name: 'decimals', onActivate: vi.fn() },
            ],
          },
        },
      ],
    });

    popovers.push(popover);
    document.body.appendChild(popover.getElement());
    popover.show();

    return popover;
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

  it('highlights the named row of the menu', () => {
    const popover = open();

    expect(popover.focusItemByName('rename')).toBe(true);
    expect(focused()).toEqual(['rename']);
  });

  it('highlights a row of the open submenu', () => {
    const popover = open();

    popover.activateItemByName('edit');

    expect(itemEl('decimals')).not.toBeNull();
    expect(popover.focusItemByName('decimals')).toBe(true);
    expect(focused()).toEqual(['decimals']);
  });

  it('changes nothing when no shown row has the name', () => {
    const popover = open();

    popover.focusItemByName('rename');

    expect(popover.focusItemByName('euro')).toBe(false);
    expect(focused()).toEqual(['rename']);
  });
});
