import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { PopoverDesktop } from '../../../../../src/components/utils/popover/popover-desktop';
import type { PopoverItemParams } from '../../../../../types/utils/popover/popover-item';

const itemEl = (name: string): HTMLElement | null => document.querySelector<HTMLElement>(`[data-blok-item-name="${name}"]`);

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

/**
 * A row with a submenu and its own action (research/30 §9b, the CSV Date type):
 * a click or Enter runs the action, ArrowRight and hover open the submenu.
 */
describe('PopoverDesktop: a row with children and its own onActivate', () => {
  const onParent = vi.fn();
  const onChild = vi.fn();
  const items = (withAction: boolean): PopoverItemParams[] => [
    { title: 'Other', name: 'other', onActivate: vi.fn() },
    {
      title: 'Parent',
      name: 'parent',
      ...(withAction ? { onActivate: onParent, closeOnActivate: true } : {}),
      children: { items: [{ title: 'Child', name: 'child', onActivate: onChild }] },
    },
  ];
  const open = (withAction = true): PopoverDesktop => {
    const popover = new PopoverDesktop({ items: items(withAction) });

    document.body.appendChild(popover.getElement());
    document.body.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: 1, clientY: 1 }));
    popover.show();

    return popover;
  };
  const popovers: PopoverDesktop[] = [];

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    popovers.splice(0).forEach((popover) => popover.destroy());
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  it('a click runs the action and does not open the submenu', () => {
    const popover = open();

    popovers.push(popover);
    itemEl('parent')?.click();

    expect(onParent).toHaveBeenCalledTimes(1);
    expect(itemEl('child')).toBeNull();
  });

  it('ArrowRight opens the submenu without running the action', () => {
    const popover = open();

    popovers.push(popover);
    focusRow(popover, 'parent');
    key(popover, 'ArrowRight', 39);

    expect(itemEl('child')).not.toBeNull();
    expect(onParent).not.toHaveBeenCalled();
  });

  it('Enter runs the action', () => {
    const popover = open();

    popovers.push(popover);
    focusRow(popover, 'parent');
    key(popover, 'Enter', 13);

    expect(onParent).toHaveBeenCalledTimes(1);
    expect(itemEl('child')).toBeNull();
  });

  it('a hover opens the submenu without running the action', async () => {
    const popover = open();

    popovers.push(popover);
    document.body.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: 5, clientY: 5 }));
    itemEl('parent')?.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, clientX: 9, clientY: 9 }));
    await new Promise((resolve) => setTimeout(resolve, 150));

    expect(itemEl('child')).not.toBeNull();
    expect(onParent).not.toHaveBeenCalled();
  });

  it('without its own action a click still opens the submenu', () => {
    const popover = open(false);

    popovers.push(popover);
    itemEl('parent')?.click();

    expect(itemEl('child')).not.toBeNull();
  });

  it('without its own action ArrowRight still opens the submenu', () => {
    const popover = open(false);

    popovers.push(popover);
    focusRow(popover, 'parent');
    key(popover, 'ArrowRight', 39);

    expect(itemEl('child')).not.toBeNull();
  });
});
