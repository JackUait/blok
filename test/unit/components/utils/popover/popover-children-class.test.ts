import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { PopoverDesktop } from '../../../../../src/components/utils/popover/popover-desktop';
import type { PopoverItemParams } from '../../../../../types/utils/popover/popover-item';

const itemEl = (name: string): HTMLElement | null => document.querySelector<HTMLElement>(`[data-blok-item-name="${name}"]`);
const listRoot = (): HTMLElement | null => itemEl('two')?.closest<HTMLElement>('[data-blok-nested]') ?? null;

/** A host styles one submenu on its own, as the database's Calculate menu. */
describe('Popover: children.class', () => {
  const popovers: PopoverDesktop[] = [];
  const open = (children: Partial<NonNullable<Extract<PopoverItemParams, { children: unknown }>['children']>>): void => {
    const popover = new PopoverDesktop({
      items: [{ title: 'Calculate', name: 'calc', children: { clickOnly: true, items: [{ title: '2', name: 'two', onActivate: vi.fn() }], ...children } }],
    });

    popovers.push(popover);
    document.body.appendChild(popover.getElement());
    popover.show();
    itemEl('calc')?.click();
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    popovers.splice(0).forEach((popover) => popover.destroy());
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  it('stamps the class on the submenu', () => {
    open({ class: 'my-list' });

    expect(listRoot()?.getAttribute('data-blok-popover-custom-class')).toBe('my-list');
  });

  it('leaves a submenu without it unmarked', () => {
    open({});

    expect(listRoot()).not.toBeNull();
    expect(listRoot()?.hasAttribute('data-blok-popover-custom-class')).toBe(false);
  });
});
