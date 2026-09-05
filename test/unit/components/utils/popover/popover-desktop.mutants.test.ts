import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { PopoverDesktop } from '../../../../../src/components/utils/popover/popover-desktop';
import { DATA_ATTR } from '../../../../../src/components/constants/data-attributes';
import type { PopoverParams, PopoverParamsBase } from '@/types/utils/popover/popover';

/** Measured popover size reported for every element while a test opts in. */
const STUB_WIDTH = 300;
const STUB_HEIGHT = 200;

const originalOffsetWidth = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetWidth');
const originalOffsetHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetHeight');

/**
 * jsdom reports 0 for every layout box, which makes the popover measure itself
 * as 0x0 and never flip. Report a real size so placement can be exercised.
 */
const stubMeasuredSize = (): void => {
  Object.defineProperty(HTMLElement.prototype, 'offsetWidth', { configurable: true, get: () => STUB_WIDTH });
  Object.defineProperty(HTMLElement.prototype, 'offsetHeight', { configurable: true, get: () => STUB_HEIGHT });
};

const restoreMeasuredSize = (): void => {
  if (originalOffsetWidth !== undefined) {
    Object.defineProperty(HTMLElement.prototype, 'offsetWidth', originalOffsetWidth);
  }
  if (originalOffsetHeight !== undefined) {
    Object.defineProperty(HTMLElement.prototype, 'offsetHeight', originalOffsetHeight);
  }
};

const makeRect = (box: { top: number; left: number; width: number; height: number }): DOMRect => {
  return {
    x: box.left,
    y: box.top,
    top: box.top,
    left: box.left,
    width: box.width,
    height: box.height,
    right: box.left + box.width,
    bottom: box.top + box.height,
    toJSON: () => ({}),
  };
};

/** Full-viewport scope so the scope bounds never constrain placement. */
const createScope = (): HTMLElement => {
  const scope = document.createElement('div');

  document.body.appendChild(scope);
  vi.spyOn(scope, 'getBoundingClientRect').mockReturnValue(
    makeRect({ top: 0, left: 0, width: window.innerWidth, height: window.innerHeight })
  );

  return scope;
};

const createTrigger = (box: { top: number; left: number; width: number; height: number }): HTMLElement => {
  const trigger = document.createElement('button');

  document.body.appendChild(trigger);
  vi.spyOn(trigger, 'getBoundingClientRect').mockReturnValue(makeRect(box));

  return trigger;
};

const flatItems: PopoverParams['items'] = [
  { title: 'Alpha', name: 'alpha', onActivate: (): void => {} },
  { title: 'Beta', name: 'beta', onActivate: (): void => {} },
];

const nestingItems: PopoverParams['items'] = [
  {
    title: 'Parent',
    name: 'parent',
    children: {
      items: [{ title: 'Child', name: 'child', onActivate: (): void => {} }],
    },
  },
  { title: 'Sibling', name: 'sibling', onActivate: (): void => {} },
];

const openPopovers: PopoverDesktop[] = [];

type OpenParams = Partial<PopoverParamsBase> & { positionContext?: HTMLElement };

const track = (popover: PopoverDesktop): PopoverDesktop => {
  openPopovers.push(popover);
  document.body.appendChild(popover.getMountElement());

  return popover;
};

const openPopover = (params: OpenParams = {}): PopoverDesktop => {
  const popoverParams: PopoverParams = {
    ...params,
    items: params.items ?? flatItems,
    scopeElement: params.scopeElement ?? createScope(),
  };

  return track(new PopoverDesktop(popoverParams));
};

/** Virtual-anchor popovers need the position + lifecycle pair the type demands. */
const openVirtualPopover = (position: DOMRect): PopoverDesktop =>
  track(new PopoverDesktop({
    items: flatItems,
    scopeElement: createScope(),
    position,
    positionLifecycle: 'dismiss-on-nested-scroll',
  }));

const originalScrollX = Object.getOwnPropertyDescriptor(window, 'scrollX');
const originalScrollY = Object.getOwnPropertyDescriptor(window, 'scrollY');

const stubScroll = (x: number, y: number): void => {
  Object.defineProperty(window, 'scrollX', { configurable: true, get: () => x });
  Object.defineProperty(window, 'scrollY', { configurable: true, get: () => y });
};

const restoreScroll = (): void => {
  if (originalScrollX !== undefined) {
    Object.defineProperty(window, 'scrollX', originalScrollX);
  }
  if (originalScrollY !== undefined) {
    Object.defineProperty(window, 'scrollY', originalScrollY);
  }
};

const getItemElement = (popover: PopoverDesktop, title: string): HTMLElement => {
  const el = popover.getElement().querySelector(`[${DATA_ATTR.popoverItem}][data-item-name="${title}"]`);

  if (el instanceof HTMLElement) {
    return el;
  }

  const byText = [...popover.getElement().querySelectorAll<HTMLElement>(`[${DATA_ATTR.popoverItem}]`)]
    .find(candidate => candidate.textContent?.includes(title));

  if (byText === undefined) {
    throw new Error(`popover item "${title}" not rendered`);
  }

  return byText;
};

const fireMouse = (target: EventTarget, type: string, x: number, y: number): void => {
  target.dispatchEvent(new MouseEvent(type, { bubbles: true, clientX: x, clientY: y }));
};

beforeEach(() => {
  vi.clearAllMocks();
  document.body.innerHTML = '';
});

afterEach(() => {
  // A leaked position tracker would keep answering resize events raised by the
  // next test.
  openPopovers.splice(0).forEach(popover => popover.destroy());
  restoreScroll();
  restoreMeasuredSize();
  vi.useRealTimers();
  vi.restoreAllMocks();
  document.body.innerHTML = '';
});

describe('PopoverDesktop — active descendant focus host', () => {
  it('reports back the host it was given', () => {
    const popover = openPopover();
    const host = document.createElement('div');

    host.textContent = 'combobox host';
    popover.setActiveDescendantHost(host);

    // The registry treats focus on this element as "inside" the popover, so a
    // lost host dismisses the menu on every keystroke in the combobox.
    expect(popover.getFocusHost()).toBe(host);

  });

  it('has no focus host until one is set', () => {
    const popover = openPopover();

    expect(popover.getFocusHost()).toBeNull();

  });
});

describe('PopoverDesktop — resolved side stamping', () => {
  it('stamps bottom/start when the trigger has room below and to the right', () => {
    stubMeasuredSize();

    const popover = openPopover({ trigger: createTrigger({ top: 10, left: 10, width: 50, height: 20 }) });

    popover.show();

    const root = popover.getElement();

    expect(root.getAttribute('data-side')).toBe('bottom');
    expect(root.getAttribute('data-align')).toBe('start');
    expect(root.hasAttribute(DATA_ATTR.popoverOpenTop)).toBe(false);
    expect(root.hasAttribute(DATA_ATTR.popoverOpenLeft)).toBe(false);

  });

  it('stamps top/end when the trigger sits near the bottom-right corner', () => {
    stubMeasuredSize();

    const trigger = createTrigger({
      top: window.innerHeight - 68,
      left: window.innerWidth - 124,
      width: 50,
      height: 20,
    });
    const popover = openPopover({ trigger });

    popover.show();

    const root = popover.getElement();

    // Wrong flags here open the menu off-screen and animate from the wrong
    // transform-origin.
    expect(root.getAttribute('data-side')).toBe('top');
    expect(root.getAttribute('data-align')).toBe('end');
    expect(root.hasAttribute(DATA_ATTR.popoverOpenTop)).toBe(true);
    expect(root.hasAttribute(DATA_ATTR.popoverOpenLeft)).toBe(true);

  });
});

describe('PopoverDesktop — anchored repositioning', () => {
  it('follows a trigger that moved while the popover stayed open', () => {
    stubMeasuredSize();

    const trigger = createTrigger({ top: 100, left: 100, width: 50, height: 20 });
    const popover = openPopover({ trigger });

    popover.show();

    const initialTop = popover.getElement().style.top;

    vi.spyOn(trigger, 'getBoundingClientRect').mockReturnValue(
      makeRect({ top: 300, left: 100, width: 50, height: 20 })
    );
    window.dispatchEvent(new Event('resize'));

    expect(popover.getElement().style.top).not.toBe(initialTop);
    expect(popover.getElement().style.top).toBe('328px');

  });

  it('shifts the captured anchor by how far its position context moved', () => {
    stubMeasuredSize();

    const context = document.createElement('div');

    document.body.appendChild(context);
    vi.spyOn(context, 'getBoundingClientRect').mockReturnValue(
      makeRect({ top: 0, left: 0, width: 500, height: 500 })
    );

    const trigger = createTrigger({ top: 100, left: 120, width: 50, height: 20 });
    const popover = openPopover({ trigger, positionContext: context });

    popover.show();
    expect(popover.getElement().style.top).toBe('128px');

    // The context dropped 50px and the trigger vanished: the menu must follow
    // the context down, not drift up by the same amount.
    vi.spyOn(context, 'getBoundingClientRect').mockReturnValue(
      makeRect({ top: 50, left: 0, width: 500, height: 500 })
    );
    vi.spyOn(trigger, 'getBoundingClientRect').mockReturnValue(
      makeRect({ top: 0, left: 0, width: 0, height: 0 })
    );
    window.dispatchEvent(new Event('resize'));

    expect(popover.getElement().style.top).toBe('178px');
  });

  it('shifts a flipped anchor by the context delta on both axes', () => {
    stubMeasuredSize();

    const context = document.createElement('div');

    document.body.appendChild(context);
    vi.spyOn(context, 'getBoundingClientRect').mockReturnValue(
      makeRect({ top: 0, left: 0, width: 500, height: 500 })
    );

    const trigger = createTrigger({ top: 700, left: 900, width: 50, height: 20 });
    const popover = openPopover({ trigger, positionContext: context });

    popover.show();
    expect(popover.getElement().style.top).toBe('492px');
    expect(popover.getElement().style.left).toBe('650px');

    // Flipped placement reads the anchor's top and right edges, which a
    // one-sided shift would leave behind while the other edges move.
    vi.spyOn(context, 'getBoundingClientRect').mockReturnValue(
      makeRect({ top: 50, left: 30, width: 500, height: 500 })
    );
    vi.spyOn(trigger, 'getBoundingClientRect').mockReturnValue(
      makeRect({ top: 0, left: 0, width: 0, height: 0 })
    );
    window.dispatchEvent(new Event('resize'));

    expect(popover.getElement().style.top).toBe('542px');
    expect(popover.getElement().style.left).toBe('680px');
  });

  it('cancels out page scroll when replaying a captured anchor with no context', () => {
    stubMeasuredSize();

    const trigger = createTrigger({ top: 100, left: 120, width: 50, height: 20 });
    const popover = openPopover({ trigger });

    popover.show();

    // Captured at scroll 0. After scrolling, the viewport-relative anchor moves
    // back by the scroll delta while the document-space result stays put.
    stubScroll(100, 100);
    vi.spyOn(trigger, 'getBoundingClientRect').mockReturnValue(
      makeRect({ top: 0, left: 0, width: 0, height: 0 })
    );
    window.dispatchEvent(new Event('resize'));

    expect(popover.getElement().style.top).toBe('128px');
    expect(popover.getElement().style.left).toBe('120px');
  });

  it('keeps the last position when the trigger collapses to a zero box', () => {
    stubMeasuredSize();

    const trigger = createTrigger({ top: 100, left: 120, width: 50, height: 20 });
    const popover = openPopover({ trigger });

    popover.show();

    // A collapsed live rect must fall back to the anchor captured at
    // construction, not slide the menu to the document origin.
    vi.spyOn(trigger, 'getBoundingClientRect').mockReturnValue(
      makeRect({ top: 0, left: 0, width: 0, height: 0 })
    );
    window.dispatchEvent(new Event('resize'));

    expect(popover.getElement().style.top).toBe('128px');
    expect(popover.getElement().style.left).toBe('120px');

  });

  it('re-applies top, left and side when updatePosition runs on an open popover', () => {
    stubMeasuredSize();

    const popover = openVirtualPopover(makeRect({ top: 10, left: 10, width: 1, height: 1 }));

    popover.show();
    popover.updatePosition(
      makeRect({ top: 400, left: 500, width: 1, height: 1 }),
      { positionLifecycle: 'dismiss-on-nested-scroll' }
    );

    expect(popover.getElement().style.top).toBe('409px');
    expect(popover.getElement().style.left).toBe('500px');
    expect(popover.getElement().getAttribute('data-side')).toBe('bottom');

  });

  it('re-stamps the resolved side when a scroll flips the placement', () => {
    stubMeasuredSize();

    const trigger = createTrigger({ top: 10, left: 10, width: 50, height: 20 });
    const popover = openPopover({ trigger });

    popover.show();
    expect(popover.getElement().getAttribute('data-side')).toBe('bottom');

    vi.spyOn(trigger, 'getBoundingClientRect').mockReturnValue(
      makeRect({ top: window.innerHeight - 68, left: window.innerWidth - 124, width: 50, height: 20 })
    );
    window.dispatchEvent(new Event('resize'));

    // Only moving top/left without re-stamping leaves the animation origin and
    // any side-keyed CSS pointing at the old edge.
    expect(popover.getElement().getAttribute('data-side')).toBe('top');
    expect(popover.getElement().getAttribute('data-align')).toBe('end');
  });

  it('opens against a trigger that was already collapsed before show', () => {
    stubMeasuredSize();

    const trigger = createTrigger({ top: 0, left: 0, width: 0, height: 0 });
    const popover = openPopover({ trigger });

    // No anchor was captured for an unmeasurable trigger, so the fallback must
    // stay on the live rect instead of replaying a snapshot that never existed.
    expect(() => popover.show()).not.toThrow();
    expect(popover.getElement().style.top).toBe('8px');
  });

  it('clears the inline position on hide so a reopen cannot reuse it', () => {
    stubMeasuredSize();

    const popover = openPopover({ trigger: createTrigger({ top: 100, left: 100, width: 50, height: 20 }) });

    popover.show();
    expect(popover.getElement().style.top).not.toBe('');

    popover.hide();

    expect(popover.getElement().style.top).toBe('');
    expect(popover.getElement().style.left).toBe('');

  });
});

describe('PopoverDesktop — nested submenu placement', () => {
  it('opens the submenu beside the parent, overlapping its trailing edge', () => {
    stubMeasuredSize();

    const popover = openPopover({ items: nestingItems });

    popover.show();

    const container = popover.getElement().querySelector(`[${DATA_ATTR.popoverContainer}]`);

    if (!(container instanceof HTMLElement)) {
      throw new Error('popover container missing');
    }
    vi.spyOn(container, 'getBoundingClientRect').mockReturnValue(
      makeRect({ top: 50, left: 40, width: 200, height: 100 })
    );
    vi.spyOn(popover.getElement(), 'getBoundingClientRect').mockReturnValue(
      makeRect({ top: 50, left: 40, width: 200, height: 100 })
    );

    getItemElement(popover, 'Parent').dispatchEvent(new MouseEvent('click', { bubbles: true }));

    const nestedRoot = popover.getElement().querySelector(`[${DATA_ATTR.nested}]`);

    if (!(nestedRoot instanceof HTMLElement)) {
      throw new Error('nested popover missing');
    }

    const nestedContainer = nestedRoot.querySelector(`[${DATA_ATTR.popoverContainer}]`);

    if (!(nestedContainer instanceof HTMLElement)) {
      throw new Error('nested container missing');
    }

    // Submenus always open right of the parent with a 4px overlap, expressed
    // relative to the parent root. A different side or offset leaves a dead
    // gap the pointer cannot cross.
    expect(nestedRoot.getAttribute('data-side')).toBe('right');
    expect(nestedRoot.getAttribute('data-align')).toBe('center');
    expect(nestedContainer.style.position).toBe('absolute');
    expect(nestedContainer.style.left).toBe('196px');

  });
});

describe('PopoverDesktop — nested submenu vertical centering', () => {
  it('centers the submenu on its trigger item and clamps it into the viewport', () => {
    stubMeasuredSize();

    const popover = openPopover({ items: nestingItems });

    popover.show();

    const container = popover.getElement().querySelector(`[${DATA_ATTR.popoverContainer}]`);

    if (!(container instanceof HTMLElement)) {
      throw new Error('popover container missing');
    }
    vi.spyOn(container, 'getBoundingClientRect').mockReturnValue(
      makeRect({ top: 50, left: 40, width: 200, height: 100 })
    );
    vi.spyOn(popover.getElement(), 'getBoundingClientRect').mockReturnValue(
      makeRect({ top: 50, left: 40, width: 200, height: 100 })
    );

    const triggerItem = getItemElement(popover, 'Parent');

    vi.spyOn(triggerItem, 'getBoundingClientRect').mockReturnValue(
      makeRect({ top: 100, left: 40, width: 200, height: 30 })
    );

    triggerItem.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    const nestedRoot = popover.getElement().querySelector(`[${DATA_ATTR.nested}]`);

    if (!(nestedRoot instanceof HTMLElement)) {
      throw new Error('nested popover missing');
    }

    const nestedContainer = nestedRoot.querySelector(`[${DATA_ATTR.popoverContainer}]`);

    if (!(nestedContainer instanceof HTMLElement)) {
      throw new Error('nested container missing');
    }

    // Trigger centre 115, submenu 200 tall, parent root top 50:
    // (115 - 200 / 2) - 50 = -35.
    expect(nestedContainer.style.top).toBe('-35px');
  });
});

describe('PopoverDesktop — synthesized hover suppression', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  const nestedRootOf = (popover: PopoverDesktop): Element | null =>
    popover.getElement().querySelector(`[${DATA_ATTR.nested}]`);

  it('ignores the post-paint mouseover fired at the parked pointer position', () => {
    fireMouse(document, 'mousemove', 25, 25);

    const popover = openPopover({ items: nestingItems });

    popover.show();

    fireMouse(getItemElement(popover, 'Parent'), 'mouseover', 25, 25);
    vi.advanceTimersByTime(500);

    expect(nestedRootOf(popover)).toBeNull();

  });

  it('opens the submenu for a hover at coordinates the pointer actually moved to', () => {
    fireMouse(document, 'mousemove', 25, 25);

    const popover = openPopover({ items: nestingItems });

    popover.show();

    fireMouse(getItemElement(popover, 'Parent'), 'mouseover', 400, 300);
    vi.advanceTimersByTime(500);

    expect(nestedRootOf(popover)).not.toBeNull();

  });

  it('treats a hover sharing only the parked X coordinate as genuine', () => {
    fireMouse(document, 'mousemove', 25, 25);

    const popover = openPopover({ items: nestingItems });

    popover.show();

    fireMouse(getItemElement(popover, 'Parent'), 'mouseover', 25, 300);
    vi.advanceTimersByTime(500);

    expect(nestedRootOf(popover)).not.toBeNull();
  });

  it('treats a hover sharing only the parked Y coordinate as genuine', () => {
    fireMouse(document, 'mousemove', 25, 25);

    const popover = openPopover({ items: nestingItems });

    popover.show();

    fireMouse(getItemElement(popover, 'Parent'), 'mouseover', 400, 25);
    vi.advanceTimersByTime(500);

    expect(nestedRootOf(popover)).not.toBeNull();
  });

  it('closes the submenu when the pointer moves onto a different item', () => {
    fireMouse(document, 'mousemove', 25, 25);

    const popover = openPopover({ items: nestingItems });

    popover.show();

    fireMouse(getItemElement(popover, 'Parent'), 'mouseover', 400, 300);
    vi.advanceTimersByTime(500);
    expect(nestedRootOf(popover)).not.toBeNull();

    fireMouse(getItemElement(popover, 'Sibling'), 'mouseover', 400, 340);

    expect(nestedRootOf(popover)).toBeNull();

  });

  it('keeps an open submenu when the pointer settles on its own trigger item', () => {
    fireMouse(document, 'mousemove', 25, 25);

    const popover = openPopover({ items: nestingItems });

    popover.show();

    getItemElement(popover, 'Parent').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(nestedRootOf(popover)).not.toBeNull();

    // Hovering the trigger of an already-open submenu must not tear it down and
    // reschedule it — that flickers the submenu closed under the pointer.
    fireMouse(getItemElement(popover, 'Parent'), 'mouseover', 400, 300);

    expect(nestedRootOf(popover)).not.toBeNull();
  });

  it('opens nothing when the pointer rests on an item without children', () => {
    fireMouse(document, 'mousemove', 25, 25);

    const popover = openPopover({ items: nestingItems });

    popover.show();

    fireMouse(getItemElement(popover, 'Sibling'), 'mouseover', 400, 340);
    vi.advanceTimersByTime(500);

    expect(nestedRootOf(popover)).toBeNull();
  });

  it('closes the submenu when the pointer leaves the popover entirely', () => {
    fireMouse(document, 'mousemove', 25, 25);

    const popover = openPopover({ items: nestingItems });

    popover.show();

    fireMouse(getItemElement(popover, 'Parent'), 'mouseover', 400, 300);
    vi.advanceTimersByTime(500);
    expect(nestedRootOf(popover)).not.toBeNull();

    const container = popover.getElement().querySelector(`[${DATA_ATTR.popoverContainer}]`);

    if (!(container instanceof HTMLElement)) {
      throw new Error('popover container missing');
    }
    container.dispatchEvent(new MouseEvent('mouseleave', { bubbles: false, relatedTarget: document.body }));

    expect(nestedRootOf(popover)).toBeNull();

  });
});
