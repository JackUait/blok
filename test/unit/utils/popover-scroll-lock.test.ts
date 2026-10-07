import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PopoverDesktop } from '../../../src/components/utils/popover/popover-desktop';
import { PopoverInline } from '../../../src/components/utils/popover/popover-inline';
import { PopoverRegistry } from '../../../src/components/utils/popover/popover-registry';
import type { PopoverItemDefault } from '../../../src/components/utils/popover/components/popover-item';
import type { PopoverItemParams } from '@/types/utils/popover/popover-item';

vi.mock('../../../src/components/utils', async () => {
  const actual = await vi.importActual('../../../src/components/utils');

  return {
    ...actual,
    isMobileScreen: vi.fn(() => false),
    isIosDevice: false,
  };
});

const SCROLL_LOCKED = 'data-blok-scroll-locked';

const items = (): PopoverItemParams[] => [
  { title: 'One', name: 'one', onActivate: vi.fn() },
  { title: 'Two', name: 'two', onActivate: vi.fn() },
];

const makeTrigger = (): HTMLElement => {
  const trigger = document.createElement('button');

  document.body.appendChild(trigger);

  return trigger;
};

const isPageLocked = (): boolean => document.body.hasAttribute(SCROLL_LOCKED);

const opened: Array<{ destroy: () => void }> = [];

const track = <T extends { destroy: () => void }>(popover: T): T => {
  opened.push(popover);

  return popover;
};

describe('popover menus lock page scroll', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    PopoverRegistry.resetForTests();
  });

  afterEach(() => {
    opened.splice(0).forEach(popover => popover.destroy());
    document.body.innerHTML = '';
    document.body.style.overflow = '';
    vi.restoreAllMocks();
  });

  it('locks while a menu is open and releases on hide', () => {
    const popover = track(new PopoverDesktop({ items: items(), trigger: makeTrigger() }));

    popover.show();

    expect(isPageLocked()).toBe(true);
    expect(document.body.style.overflow).toBe('hidden');

    popover.hide();

    expect(isPageLocked()).toBe(false);
    expect(document.body.style.overflow).toBe('');
  });

  it('releases the lock when an open menu is destroyed without hide', () => {
    const popover = new PopoverDesktop({ items: items(), trigger: makeTrigger() });

    popover.show();
    popover.destroy();

    expect(isPageLocked()).toBe(false);
  });

  it('locks a menu placed by position instead of a trigger', () => {
    const popover = track(new PopoverDesktop({
      items: items(),
      position: new DOMRect(10, 10, 0, 0),
      positionContext: makeTrigger(),
    }));

    popover.show();

    expect(isPageLocked()).toBe(true);
  });

  it('keeps the page locked while one menu hands off to another', () => {
    const first = track(new PopoverDesktop({ items: items(), trigger: makeTrigger() }));
    const second = track(new PopoverDesktop({ items: items(), trigger: makeTrigger() }));
    const unlocks: boolean[] = [];
    const observer = new MutationObserver(() => unlocks.push(isPageLocked()));

    first.show();
    observer.observe(document.body, { attributes: true, attributeFilter: [ SCROLL_LOCKED ] });
    second.show();
    observer.disconnect();

    expect(unlocks).toEqual([]);
    expect(isPageLocked()).toBe(true);

    second.hide();

    expect(isPageLocked()).toBe(false);
  });

  it('does not lock for the inline formatting bar, but locks its dropdowns', () => {
    const inline = track(new PopoverInline({
      items: [ {
        title: 'Turn into',
        name: 'convert',
        children: { items: items() },
      } ],
    }));

    document.body.appendChild(inline.getElement());
    inline.show();

    expect(isPageLocked()).toBe(false);

    const convert = (inline as unknown as { items: PopoverItemDefault[] }).items[0];

    (inline as unknown as { showNestedItems: (item: PopoverItemDefault) => void }).showNestedItems(convert);

    expect(isPageLocked()).toBe(true);

    inline.hide();

    expect(isPageLocked()).toBe(false);
  });
});
