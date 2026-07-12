import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { PopoverDesktop } from '../../../src/components/utils/popover/popover-desktop';
import { PopoverRegistry } from '../../../src/components/utils/popover/popover-registry';
import { PopoverItemType } from '@/types/utils/popover/popover-item-type';

/**
 * POPOVER LIFECYCLE LAW — opening a child popover is never a dismissal of its
 * opener.
 *
 * The registry enforces mutual exclusion between popovers: registering one
 * hides every other. A submenu that opened from an item of the popover above it
 * is NOT "another popover" — if mutual exclusion tore its opener down, the
 * opener's Closed handlers would run (restoring focus, clearing selections,
 * destroying state) WHILE the child was still showing. That is exactly how the
 * table's row/column colour menu became unreachable from its grip.
 *
 * Two mechanisms keep this safe and both are pinned here:
 *   1. nested popovers never register (only root popovers with a trigger do), and
 *   2. even if one did, the registry skips ancestors that contain it.
 */
describe('a nested popover does not dismiss its opener', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    PopoverRegistry.resetForTests();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = '';
    PopoverRegistry.instance.destroy();
  });

  const openParentWithSubmenu = (): { parent: PopoverDesktop; trigger: HTMLElement } => {
    const trigger = document.createElement('button');

    document.body.appendChild(trigger);

    const child = document.createElement('div');

    child.setAttribute('data-blok-testid', 'submenu-content');

    const parent = new PopoverDesktop({
      trigger,
      items: [
        {
          title: 'Color',
          name: 'color',
          children: {
            items: [{ type: PopoverItemType.Html, element: child }],
            isFlippable: false,
          },
        },
      ],
    });

    parent.show();

    return { parent, trigger };
  };

  it('keeps the opener shown and registered when its submenu opens', () => {
    const { parent } = openParentWithSubmenu();
    const hideSpy = vi.spyOn(parent, 'hide');

    expect(parent.isShown).toBe(true);
    expect(PopoverRegistry.instance.hasOpenPopovers()).toBe(true);

    const item = parent.getElement().querySelector<HTMLElement>('[data-blok-item-name="color"]');

    expect(item).not.toBeNull();
    item?.click();

    // The submenu is mounted inside the opener...
    expect(parent.getElement().querySelector('[data-blok-testid="submenu-content"]')).not.toBeNull();
    // ...and the opener was neither hidden nor evicted from the registry.
    expect(hideSpy).not.toHaveBeenCalled();
    expect(parent.isShown).toBe(true);
    expect(PopoverRegistry.instance.hasOpenPopovers()).toBe(true);

    parent.destroy();
  });
});
