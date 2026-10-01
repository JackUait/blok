import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { PopoverDesktop } from '../../../../../src/components/utils/popover/popover-desktop';
import { PopoverItemDefault } from '../../../../../src/components/utils/popover/components/popover-item/popover-item-default/popover-item-default';
import { resyncPortalDirections } from '../../../../../src/components/utils/portal-direction';

const rect = (left: number, top: number, width: number, height: number): DOMRect => ({
  left,
  top,
  width,
  height,
  right: left + width,
  bottom: top + height,
  x: left,
  y: top,
  toJSON: () => ({}),
});

interface Internal {
  items: unknown[];
  nestedPopover: PopoverDesktop | null | undefined;
  showNestedItems: (item: PopoverItemDefault) => void;
}

const mountEditor = (): { editor: HTMLElement; trigger: HTMLButtonElement } => {
  const editor = document.createElement('div');
  const trigger = document.createElement('button');

  editor.setAttribute('data-blok-editor', '');
  editor.style.direction = 'ltr';
  editor.appendChild(trigger);
  document.body.appendChild(editor);
  vi.spyOn(trigger, 'getBoundingClientRect').mockReturnValue(rect(100, 100, 40, 20));

  return { editor, trigger };
};

describe('PopoverDesktop — runtime direction flip', () => {
  const popovers: PopoverDesktop[] = [];

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    popovers.forEach(popover => popover.destroy());
    popovers.length = 0;
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  const open = (trigger: HTMLElement): PopoverDesktop => {
    const popover = new PopoverDesktop({
      trigger,
      items: [
        { title: 'Alpha', name: 'alpha', onActivate: vi.fn() },
        { title: 'Convert', name: 'parent', children: { items: [ { title: 'Child', name: 'child', onActivate: vi.fn() } ] } },
      ],
    });

    popovers.push(popover);
    popover.show();

    return popover;
  };

  it('re-places an open menu for the new direction', () => {
    const { editor, trigger } = mountEditor();
    const popover = open(trigger);
    const element = popover.getElement();
    const ltrLeft = element.style.left;

    editor.style.direction = 'rtl';
    resyncPortalDirections(editor);

    expect(element.getAttribute('dir')).toBe('rtl');
    // An RTL menu lines up with the trigger's right edge.
    expect(element.style.left).not.toBe(ltrLeft);

    const fresh = mountEditor();

    fresh.editor.style.direction = 'rtl';

    expect(element.style.left).toBe(open(fresh.trigger).getElement().style.left);
  });

  it('keeps an open submenu when an update leaves the direction as it was', () => {
    const { editor, trigger } = mountEditor();
    const popover = open(trigger);
    const internal = popover as unknown as Internal;
    const parent = internal.items.find(
      (item): item is PopoverItemDefault => item instanceof PopoverItemDefault && item.name === 'parent'
    );

    if (parent === undefined) {
      throw new Error('Missing parent item');
    }
    internal.showNestedItems(parent);
    const nested = internal.nestedPopover;

    expect(nested).toBeInstanceOf(PopoverDesktop);

    resyncPortalDirections(editor);

    expect(internal.nestedPopover).toBe(nested);
  });

  it('closes an open submenu, which was placed for the old side', () => {
    const { editor, trigger } = mountEditor();
    const popover = open(trigger);
    const internal = popover as unknown as Internal;
    const parent = internal.items.find(
      (item): item is PopoverItemDefault => item instanceof PopoverItemDefault && item.name === 'parent'
    );

    if (parent === undefined) {
      throw new Error('Missing parent item');
    }
    internal.showNestedItems(parent);
    expect(internal.nestedPopover).toBeInstanceOf(PopoverDesktop);

    editor.style.direction = 'rtl';
    resyncPortalDirections(editor);

    expect(internal.nestedPopover ?? null).toBeNull();
  });
});
