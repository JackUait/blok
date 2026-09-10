import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest';

/**
 * Flipper is a collaborator, not the unit under test. Mocking it keeps the
 * suite deterministic (focus calls become recorded calls) and isolates this
 * file from mutations in flipper.ts itself.
 */
type MockFlipperShape = {
  options: Record<string, unknown>;
  activate: Mock<(items?: HTMLElement[]) => void>;
  deactivate: Mock<() => void>;
  removeOnFlip: Mock<(callback: () => void) => void>;
  focusFirst: Mock<() => void>;
  focusItem: Mock<(position: number, options?: { skipNextTab?: boolean }) => void>;
  hasFocus: Mock<() => boolean>;
  getHandleContentEditableTargets: Mock<() => boolean>;
  setActiveDescendantHost: Mock<(host: HTMLElement | null) => void>;
  readonly isActivated: boolean;
  triggerFlip: () => void;
};

const flipperRegistry = vi.hoisted(() => ({
  instances: [] as unknown[],
  ctor: null as (new (options: Record<string, unknown>) => unknown) | null,
  reset(): void {
    this.instances.length = 0;
  },
}));

vi.mock('../../../../../src/components/flipper', () => {
  class MockFlipper {
    public readonly options: Record<string, unknown>;

    public readonly onFlip = vi.fn((callback: () => void) => {
      this.flipCallbacks.add(callback);
    });

    public readonly removeOnFlip = vi.fn((callback: () => void) => {
      this.flipCallbacks.delete(callback);
    });

    public readonly activate = vi.fn((_items?: HTMLElement[]) => {
      this.activated = true;
    });

    public readonly deactivate = vi.fn(() => {
      this.activated = false;
    });

    public readonly focusFirst = vi.fn(() => {});

    public readonly focusItem = vi.fn((_position: number, _options?: { skipNextTab?: boolean }) => {});

    public readonly hasFocus = vi.fn(() => this.activated);

    public readonly getHandleContentEditableTargets = vi.fn(() => false);

    public readonly setActiveDescendantHost = vi.fn((_host: HTMLElement | null) => {});

    private activated = false;

    private readonly flipCallbacks = new Set<() => void>();

    constructor(options: Record<string, unknown>) {
      this.options = options;
      flipperRegistry.instances.push(this);
    }

    public get isActivated(): boolean {
      return this.activated;
    }

    public triggerFlip(): void {
      this.flipCallbacks.forEach(callback => callback());
    }
  }

  flipperRegistry.ctor = MockFlipper;

  return {
    ['__esModule']: true,
    Flipper: MockFlipper,
  };
});

import { PopoverDesktop } from '../../../../../src/components/utils/popover/popover-desktop';
import type { PopoverItem } from '../../../../../src/components/utils/popover/components/popover-item';
import { PopoverItemDefault } from '../../../../../src/components/utils/popover/components/popover-item/popover-item-default/popover-item-default';
import { PopoverItemType } from '@/types/utils/popover/popover-item-type';
import { PopoverEvent } from '@/types/utils/popover/popover-event';
import type { PopoverParams, PopoverPositionUpdate } from '@/types/utils/popover/popover';

type PopoverDesktopInternal = Omit<
  PopoverDesktop,
  | 'nodes' | 'items' | 'nestedPopover' | 'nestedPopoverTriggerItem'
  | 'suppressSyncHover' | 'suppressSyncHoverPointer' | 'previouslyHoveredItem'
  | 'nestedBelowResizeObserver' | 'promotedItemCache' | 'positionTracker'
  | 'flippableElements' | 'showNestedPopoverForItem' | 'destroyNestedPopoverIfExists'
  | 'handleHover' | 'handleMouseLeave' | 'showNestedItems'
> & {
  nodes: {
    popover: HTMLElement;
    popoverContainer: HTMLElement;
    items: HTMLElement;
    nothingFoundMessage: HTMLElement;
    resultsAnnouncer: HTMLElement;
    scrollbarThumb: HTMLElement;
    contextLabel?: HTMLElement;
  };
  items: PopoverItem[];
  nestedPopover: PopoverDesktop | null | undefined;
  nestedPopoverTriggerItem: PopoverItemDefault | null;
  suppressSyncHover: boolean;
  suppressSyncHoverPointer: { x: number; y: number } | null;
  previouslyHoveredItem: PopoverItemDefault | null;
  nestedBelowResizeObserver: { observe: Mock; disconnect: Mock } | null;
  promotedItemCache: { items: PopoverItemDefault[] } | null;
  positionTracker: { attach(): void; detach(): void } | undefined;
  flippableElements: HTMLElement[];
  showNestedPopoverForItem: (item: PopoverItemDefault) => PopoverDesktop;
  destroyNestedPopoverIfExists: (restoreFocus?: boolean) => void;
  handleHover: (event: Event) => void;
  handleMouseLeave: (event: Event) => void;
  showNestedItems: (item: PopoverItemDefault) => void;
};

const asInternal = (popover: PopoverDesktop): PopoverDesktopInternal =>
  popover as unknown as PopoverDesktopInternal;

const getFlipper = (index = 0): MockFlipperShape => flipperRegistry.instances[index] as MockFlipperShape;

const makeRect = (overrides: Partial<DOMRect> = {}): DOMRect => ({
  x: 0,
  y: 0,
  width: 0,
  height: 0,
  top: 0,
  right: 0,
  bottom: 0,
  left: 0,
  toJSON: () => ({}),
  ...overrides,
});

const ATTR_OPENED = 'data-blok-popover-opened';
const ATTR_NESTED = 'data-blok-nested';
const ATTR_HIDDEN = 'data-blok-hidden';
const ATTR_FOCUSED = 'data-blok-focused';
const ATTR_ITEM_ACTIVE = 'data-blok-popover-item-active';
const ATTR_ITEM_NO_HOVER = 'data-blok-popover-item-no-hover';
const ATTR_ITEM_NO_FOCUS = 'data-blok-popover-item-no-focus';
const ATTR_NOTHING_FOUND = 'data-blok-nothing-found-displayed';
const ATTR_TOP_LEVEL_GROUP = 'data-blok-top-level-group-label';
const ATTR_PROMOTED_GROUP = 'data-blok-promoted-group-label';
const ATTR_OPEN_LEFT = 'data-blok-popover-open-left';

const createdPopovers: PopoverDesktop[] = [];

/**
 * Builds a desktop popover. The default scope is a detached element mocked to
 * span the whole viewport, so scope bounds never constrain positioning unless
 * a test opts into a narrower scope.
 */
const createPopover = (
  params: Partial<PopoverParams> & { positionContext?: HTMLElement } = {}
): PopoverDesktop => {
  const scopeElement = params.scopeElement ?? document.createElement('div');

  document.body.appendChild(scopeElement);

  if (!params.scopeElement) {
    vi.spyOn(scopeElement, 'getBoundingClientRect').mockReturnValue(
      makeRect({
        top: 0,
        left: 0,
        right: window.innerWidth,
        bottom: window.innerHeight,
        width: window.innerWidth,
        height: window.innerHeight,
      })
    );
  }

  const popover = new PopoverDesktop({
    items: [
      { title: 'Alpha', name: 'alpha', onActivate: vi.fn() },
      { title: 'Zebra', name: 'zebra', onActivate: vi.fn() },
    ],
    ...params,
    scopeElement,
  } as PopoverParams);

  createdPopovers.push(popover);

  return popover;
};

const itemByName = (popover: PopoverDesktop, name: string): PopoverItemDefault => {
  const found = asInternal(popover).items.find(
    (item): item is PopoverItemDefault => item instanceof PopoverItemDefault && item.name === name
  );

  if (found === undefined) {
    throw new Error(`Expected a popover item named "${name}"`);
  }

  return found;
};

/** Hover event whose composed path runs through the given element only. */
const hoverOn = (element: Element, coords?: { clientX: number; clientY: number }): Event => {
  const event = new MouseEvent('mouseover', coords);

  Object.defineProperty(event, 'composedPath', { value: () => [element] });

  return event;
};

const parentWithChildren = (): PopoverParams['items'][number] => ({
  title: 'Convert',
  name: 'c-parent',
  children: {
    items: [
      { title: 'Convert', name: 'c-child', onActivate: vi.fn() },
      { title: 'Convoluted', name: 'c-long-child', onActivate: vi.fn() },
    ],
  },
});

/**
 * ResizeObserver double. The vitest setup polyfill is inert; these instances
 * record their callback so a test can fire it on demand.
 */
let originalResizeObserver: typeof ResizeObserver | undefined;

class ResizeObserverStub {
  public static instances: ResizeObserverStub[] = [];

  public readonly observe = vi.fn((element: Element) => {
    this.observed.push(element);
  });

  public readonly unobserve = vi.fn();

  public readonly disconnect = vi.fn();

  public readonly observed: Element[] = [];

  private readonly callback: ResizeObserverCallback;

  constructor(callback: ResizeObserverCallback) {
    this.callback = callback;
    ResizeObserverStub.instances.push(this);
  }

  public trigger(): void {
    this.callback([], this);
  }
}

let rafQueue: Map<number, FrameRequestCallback>;
let rafCounter: number;

/** Runs every pending animation frame callback (one burst). */
const flushAnimationFrame = (): void => {
  const pending = [...rafQueue.values()];

  rafQueue.clear();
  pending.forEach((callback) => callback(0));
};

beforeEach(() => {
  document.body.innerHTML = '';
  createdPopovers.length = 0;
  flipperRegistry.reset();
  ResizeObserverStub.instances = [];

  originalResizeObserver = window.ResizeObserver;
  (window as unknown as { ResizeObserver: unknown }).ResizeObserver = ResizeObserverStub;

  rafQueue = new Map();
  rafCounter = 0;
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback: FrameRequestCallback) => {
    rafCounter += 1;
    rafQueue.set(rafCounter, callback);

    return rafCounter;
  });
  vi.spyOn(window, 'cancelAnimationFrame').mockImplementation((id: number) => {
    rafQueue.delete(id);
  });
});

afterEach(() => {
  if (originalResizeObserver !== undefined) {
    (window as unknown as { ResizeObserver: unknown }).ResizeObserver = originalResizeObserver;
  }

  for (const popover of createdPopovers) {
    try {
      popover.destroy();
    } catch {
      // A popover already torn down by its test must not mask the verdicts.
    }
  }

  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('PopoverDesktop — synthesized-hover suppression', () => {
  // pointerTracker is module state: this MUST stay the first test in the file
  // because it requires that no mousemove has ever been dispatched.
  it('arms a rAF-bounded window when no pointer position was ever observed', () => {
    const popover = createPopover();
    const instance = asInternal(popover);

    popover.show();

    expect(instance.suppressSyncHover).toBe(true);
    expect(instance.suppressSyncHoverPointer).toBeNull();

    // First frame only schedules the safety frame; the window stays armed.
    flushAnimationFrame();

    expect(instance.suppressSyncHover).toBe(true);

    flushAnimationFrame();

    expect(instance.suppressSyncHover).toBe(false);
  });

  it('treats every mouseover as synthesized while no pointer position was ever observed', () => {
    vi.useFakeTimers();

    const popover = createPopover({
      items: [
        { title: 'Plain', name: 'plain', onActivate: vi.fn() },
        parentWithChildren(),
      ],
    });
    const instance = asInternal(popover);
    const parentElement = itemByName(popover, 'c-parent').getElement();

    expect(parentElement).not.toBeNull();

    popover.show();

    // No snapshot exists, so the pre-fix behavior applies: swallow everything
    // until the safety frames release the window.
    instance.handleHover(hoverOn(parentElement as Element, { clientX: 1, clientY: 2 }));
    vi.advanceTimersByTime(100);

    expect(instance.nestedPopover).toBeFalsy();

    flushAnimationFrame();
    flushAnimationFrame();

    instance.handleHover(hoverOn(parentElement as Element, { clientX: 1, clientY: 2 }));
    vi.advanceTimersByTime(100);

    expect(instance.nestedPopover).toBeInstanceOf(PopoverDesktop);
  });

  it('captures the resting pointer at show() and swallows only the matching synthesized hover', () => {
    vi.useFakeTimers();
    document.dispatchEvent(new MouseEvent('mousemove', { clientX: 50, clientY: 60 }));

    const popover = createPopover({
      items: [
        { title: 'Plain', name: 'plain', onActivate: vi.fn() },
        parentWithChildren(),
      ],
    });
    const instance = asInternal(popover);
    const parentElement = itemByName(popover, 'c-parent').getElement();

    expect(parentElement).not.toBeNull();

    popover.show();

    expect(instance.suppressSyncHoverPointer).toEqual({ x: 50, y: 60 });
    expect(instance.suppressSyncHover).toBe(true);

    // Same coordinates the pointer was resting at: Chromium's post-paint hit
    // test must be swallowed, not steal hover state.
    instance.handleHover(hoverOn(parentElement as Element, { clientX: 50, clientY: 60 }));
    vi.advanceTimersByTime(100);

    expect(instance.nestedPopover).toBeFalsy();

    // Different coordinates: a genuine hover passes through and opens.
    instance.handleHover(hoverOn(parentElement as Element, { clientX: 10, clientY: 10 }));
    vi.advanceTimersByTime(100);

    expect(instance.nestedPopover).toBeInstanceOf(PopoverDesktop);
    expect(instance.nestedPopoverTriggerItem).toBe(itemByName(popover, 'c-parent'));
  });

  it('disarms on the first real pointer motion, even one that does not bubble', () => {
    vi.useFakeTimers();
    document.dispatchEvent(new MouseEvent('mousemove', { clientX: 50, clientY: 60 }));

    const popover = createPopover({ items: [parentWithChildren()] });
    const instance = asInternal(popover);
    const parentElement = itemByName(popover, 'c-parent').getElement();

    popover.show();
    expect(instance.suppressSyncHover).toBe(true);

    // bubbles:false — only a capture-phase document listener can see it.
    const mover = document.createElement('div');

    document.body.appendChild(mover);
    mover.dispatchEvent(new MouseEvent('mousemove', { bubbles: false }));

    expect(instance.suppressSyncHover).toBe(false);
    expect(instance.suppressSyncHoverPointer).toBeNull();

    // The old resting point is a genuine hover target again.
    instance.handleHover(hoverOn(parentElement as Element, { clientX: 50, clientY: 60 }));
    vi.advanceTimersByTime(100);

    expect(instance.nestedPopover).toBeInstanceOf(PopoverDesktop);
  });

  it('hide tears the suppression down so a later show starts from a known state', () => {
    document.dispatchEvent(new MouseEvent('mousemove', { clientX: 5, clientY: 6 }));

    const popover = createPopover();
    const instance = asInternal(popover);

    popover.show();
    expect(instance.suppressSyncHover).toBe(true);

    popover.hide();

    expect(instance.suppressSyncHover).toBe(false);
    expect(instance.suppressSyncHoverPointer).toBeNull();
  });
});

describe('PopoverDesktop — constructor wiring', () => {
  it('stamps data-blok-nested only when nesting level is above zero', () => {
    const nested = createPopover({ nestingLevel: 1 });
    const root = createPopover();

    expect(nested.nestingLevel).toBe(1);
    expect(nested.getElement()).toHaveAttribute(ATTR_NESTED, 'true');
    expect(root.nestingLevel).toBe(0);
    expect(root.getElement().hasAttribute(ATTR_NESTED)).toBe(false);
  });

  it('deactivates and re-subscribes a reused flipper instead of building a new one', () => {
    if (flipperRegistry.ctor === null) {
      throw new Error('Expected the mocked Flipper constructor');
    }

    const reusable = new flipperRegistry.ctor({}) as MockFlipperShape;
    const popover = createPopover({ flipper: reusable as unknown as PopoverParams['flipper'] });

    expect(popover.flipper).toBe(reusable);
    expect(reusable.deactivate).toHaveBeenCalledOnce();
    expect(reusable.removeOnFlip).toHaveBeenCalledOnce();
  });

  it('configures a fresh flipper with the full navigation key set', () => {
    createPopover();

    expect(getFlipper(0).options.allowedKeys).toEqual([9, 38, 40, 13, 39, 37]);
  });

  it('mirrors the search input onto the flipper as the active-descendant host', () => {
    const popover = createPopover({ searchable: true });
    const input = popover.getElement().querySelector('input');

    expect(input).not.toBeNull();
    expect(getFlipper(0).setActiveDescendantHost).toHaveBeenCalledWith(input);

    createPopover();

    expect(getFlipper(1).setActiveDescendantHost).not.toHaveBeenCalled();
  });

  it('runs without a flipper when flippable is false', () => {
    const popover = createPopover({ flippable: false });

    expect(popover.flipper).toBeUndefined();
    expect(popover.hasFocus()).toBe(false);
    expect(() => popover.show()).not.toThrow();
    expect(() => popover.filterItems('alpha')).not.toThrow();
  });
});

describe('PopoverDesktop — show() side effects', () => {
  it('locks --width to the measured width for auto width', () => {
    const popover = createPopover({ trigger: document.createElement('button') });
    const instance = asInternal(popover);

    vi.spyOn(instance, 'size', 'get').mockReturnValue({ height: 120, width: 250 });

    popover.show();

    expect(popover.getElement().style.getPropertyValue('--popover-height')).toBe('120px');
    expect(popover.getElement().style.getPropertyValue('--width')).toBe('250px');
    // Anchored popovers pin the CSS-var offsets to zero; pixels go inline.
    expect(popover.getElement().style.getPropertyValue('--popover-top')).toBe('0px');
    expect(popover.getElement().style.getPropertyValue('--popover-left')).toBe('0px');
  });

  it('locks --width to minWidth when the measurement is narrower', () => {
    const popover = createPopover({ minWidth: '300px' });
    const instance = asInternal(popover);

    vi.spyOn(instance, 'size', 'get').mockReturnValue({ height: 120, width: 250 });

    popover.show();

    expect(popover.getElement().style.getPropertyValue('--width')).toBe('300px');
  });

  it('focuses the search field, not an item, when a search field is present', async () => {
    const popover = createPopover({ searchable: true });
    const input = popover.getElement().querySelector('input');

    expect(input).not.toBeNull();

    popover.show();
    await Promise.resolve();

    expect(input).toHaveFocus();
    expect(getFlipper(0).focusItem).not.toHaveBeenCalled();
  });

  it('pre-focuses the first item via the flipper under keyboard modality', async () => {
    const popover = createPopover({ items: [parentWithChildren()] });

    popover.show();
    await Promise.resolve();

    expect(getFlipper(0).focusItem).toHaveBeenCalledWith(0, { skipNextTab: true });
  });

  it('skips item pre-focus when autoFocusFirstItem is false', async () => {
    const popover = createPopover({ autoFocusFirstItem: false });

    popover.show();
    await Promise.resolve();

    expect(getFlipper(0).focusItem).not.toHaveBeenCalled();
  });

  it('non-anchored popovers position through CSS calc variables when boxed in', () => {
    const popover = createPopover();
    const instance = asInternal(popover);

    vi.spyOn(instance, 'size', 'get').mockReturnValue({ height: 400, width: 300 });
    vi.spyOn(instance.nodes.popoverContainer, 'getBoundingClientRect').mockReturnValue(
      makeRect({ top: 500, bottom: 560, left: 800, right: 900, width: 100, height: 60 })
    );

    popover.show();

    expect(popover.getElement().style.getPropertyValue('--popover-top'))
      .toBe('calc(-1 * (0.5rem + var(--popover-height)))');
    expect(popover.getElement().style.getPropertyValue('--popover-left'))
      .toBe('calc(-1 * var(--width) + 100%)');
  });

  it('non-anchored popovers keep 0px calc offsets when space surrounds them', () => {
    const popover = createPopover();
    const instance = asInternal(popover);

    vi.spyOn(instance.nodes.popoverContainer, 'getBoundingClientRect').mockReturnValue(
      makeRect({ top: 10, bottom: 70, left: 10, right: 110, width: 100, height: 60 })
    );

    popover.show();

    expect(popover.getElement().style.getPropertyValue('--popover-top')).toBe('0px');
    expect(popover.getElement().style.getPropertyValue('--popover-left')).toBe('0px');
  });
});

describe('PopoverDesktop — anchoring geometry', () => {
  it('aligns to leftAlignElement instead of the trigger', () => {
    const trigger = document.createElement('button');
    const leftAlignElement = document.createElement('div');

    document.body.appendChild(trigger);
    document.body.appendChild(leftAlignElement);

    vi.spyOn(trigger, 'getBoundingClientRect').mockReturnValue(
      makeRect({ top: 100, bottom: 140, left: 50, right: 90, width: 40, height: 40 })
    );
    vi.spyOn(leftAlignElement, 'getBoundingClientRect').mockReturnValue(
      makeRect({ top: 100, bottom: 140, left: 200, right: 600, width: 400, height: 40 })
    );

    const popover = createPopover({ trigger, leftAlignElement });
    const instance = asInternal(popover);

    vi.spyOn(instance, 'size', 'get').mockReturnValue({ height: 100, width: 150 });

    popover.show();

    expect(popover.getElement().style.left).toBe('200px');
    expect(popover.getElement().style.top).toBe('148px');
  });

  it('docks the menu to the anchor side named by asideSide with the viewport margin floor', () => {
    const trigger = document.createElement('button');

    document.body.appendChild(trigger);
    vi.spyOn(trigger, 'getBoundingClientRect').mockReturnValue(
      makeRect({ top: 0, bottom: 24, left: 400, right: 418, width: 18, height: 24 })
    );

    const popover = createPopover({
      trigger,
      placeLeftOfAnchor: true,
      asideSide: 'right',
      viewportMargin: 30,
    });
    const instance = asInternal(popover);

    vi.spyOn(instance, 'size', 'get').mockReturnValue({ height: 300, width: 200 });

    popover.show();

    // Right of the anchor: 418 + 8. Centering would put the top at 12; the
    // 30px margin floor lifts it.
    expect(popover.getElement().style.left).toBe('426px');
    expect(popover.getElement().style.top).toBe('30px');
    expect(popover.getElement().hasAttribute(ATTR_OPEN_LEFT)).toBe(false);
    expect(popover.getElement().getAttribute('data-align')).toBe('start');
  });

  it('constrains placement to a narrow scope element', () => {
    const scopeElement = document.createElement('div');

    document.body.appendChild(scopeElement);
    vi.spyOn(scopeElement, 'getBoundingClientRect').mockReturnValue(
      makeRect({ top: 0, left: 0, right: 600, bottom: 768, width: 600, height: 768 })
    );

    const trigger = document.createElement('button');

    document.body.appendChild(trigger);
    vi.spyOn(trigger, 'getBoundingClientRect').mockReturnValue(
      makeRect({ top: 100, bottom: 140, left: 500, right: 540, width: 40, height: 40 })
    );

    const popover = createPopover({ trigger, scopeElement });
    const instance = asInternal(popover);

    vi.spyOn(instance, 'size', 'get').mockReturnValue({ height: 100, width: 200 });

    popover.show();

    // No room on the right of the trigger inside the 600px scope → flip left.
    expect(popover.getElement()).toHaveAttribute(ATTR_OPEN_LEFT);
    expect(popover.getElement().style.left).toBe('340px');
  });

  it('falls back to the trigger rect captured at construction when the live rect collapses', () => {
    const trigger = document.createElement('button');

    document.body.appendChild(trigger);

    const rectSpy = vi.spyOn(trigger, 'getBoundingClientRect').mockReturnValue(
      makeRect({ top: 200, bottom: 230, left: 400, right: 420, width: 20, height: 30 })
    );

    const popover = createPopover({ trigger });
    const instance = asInternal(popover);

    vi.spyOn(instance, 'size', 'get').mockReturnValue({ height: 120, width: 200 });

    rectSpy.mockReturnValue(makeRect({}));

    popover.show();

    expect(popover.getElement().style.top).not.toBe('0px');
    expect(popover.getElement().style.left).not.toBe('0px');
  });

  it('keeps following a healthy live trigger rather than its construction-time snapshot', () => {
    const trigger = document.createElement('button');

    document.body.appendChild(trigger);

    const rectSpy = vi.spyOn(trigger, 'getBoundingClientRect').mockReturnValue(
      makeRect({ top: 100, bottom: 140, left: 400, right: 440, width: 40, height: 40 })
    );

    const popover = createPopover({ trigger });
    const instance = asInternal(popover);

    vi.spyOn(instance, 'size', 'get').mockReturnValue({ height: 100, width: 150 });

    rectSpy.mockReturnValue(
      makeRect({ top: 100, bottom: 140, left: 500, right: 540, width: 40, height: 40 })
    );

    popover.show();

    expect(popover.getElement().style.left).toBe('500px');
  });
});

describe('PopoverDesktop — position tracker', () => {
  const triggerAt = (left: number): { trigger: HTMLElement; rectSpy: Mock } => {
    const trigger = document.createElement('button');

    document.body.appendChild(trigger);

    const rectSpy = vi.spyOn(trigger, 'getBoundingClientRect')
      .mockReturnValue(makeRect({ top: 100, bottom: 140, left, right: left + 40, width: 40, height: 40 }));

    return { trigger, rectSpy };
  };

  it('repositions while open when the trigger moves and the window resizes', () => {
    const { trigger, rectSpy } = triggerAt(100);
    const popover = createPopover({ trigger });
    const instance = asInternal(popover);

    vi.spyOn(instance, 'size', 'get').mockReturnValue({ height: 100, width: 150 });

    popover.show();
    expect(popover.getElement().style.left).toBe('100px');

    rectSpy.mockReturnValue(makeRect({ top: 100, bottom: 140, left: 300, right: 340, width: 40, height: 40 }));
    window.dispatchEvent(new Event('resize'));

    expect(popover.getElement().style.left).toBe('300px');
  });

  it('keeps the size cache across scrolls but re-measures on resize', () => {
    const { trigger } = triggerAt(100);
    const popover = createPopover({ trigger });

    popover.show();

    const before = asInternal(popover).size;

    window.dispatchEvent(new Event('scroll'));

    expect(asInternal(popover).size).toBe(before);

    window.dispatchEvent(new Event('resize'));

    expect(asInternal(popover).size).not.toBe(before);
  });

  it('fails closed on a nested scroll when the virtual anchor has no live context', () => {
    const scrollSource = document.createElement('div');

    document.body.appendChild(scrollSource);

    const popover = createPopover({ position: makeRect({ top: 100, bottom: 200, left: 100, right: 300 }) });

    popover.show();
    expect(popover.isShown).toBe(true);

    scrollSource.dispatchEvent(new Event('scroll'));

    expect(popover.isShown).toBe(false);
  });

  it('keeps a virtual anchor with a measurable live context through nested scrolls', () => {
    const scrollSource = document.createElement('div');
    const context = document.createElement('div');

    document.body.append(scrollSource, context);
    vi.spyOn(context, 'getBoundingClientRect').mockReturnValue(
      makeRect({ top: 100, bottom: 300, left: 100, right: 300, width: 200, height: 200 })
    );

    const popover = createPopover({
      position: makeRect({ top: 100, bottom: 200, left: 100, right: 300 }),
      positionContext: context,
    });

    popover.show();

    scrollSource.dispatchEvent(new Event('scroll'));

    expect(popover.isShown).toBe(true);
  });

  it('attaches no tracker for a non-anchored popover, so resize never invalidates its size', () => {
    const popover = createPopover();

    popover.show();

    const before = asInternal(popover).size;

    window.dispatchEvent(new Event('resize'));

    expect(asInternal(popover).size).toBe(before);
    expect(popover.getElement().style.top).toBe('');
    expect(popover.getElement().style.left).toBe('');
  });
});

describe('PopoverDesktop — updatePosition', () => {
  it('accepts the legacy one-argument call shape without throwing', () => {
    const popover = createPopover();

    expect(() =>
      popover.updatePosition(
        makeRect({ top: 110, bottom: 126, left: 300, right: 300, width: 0, height: 16 }),
        undefined as unknown as PopoverPositionUpdate
      )
    ).not.toThrow();
  });

  it('does not write pixel styles before the popover is shown', () => {
    const popover = createPopover();

    popover.updatePosition(
      makeRect({ top: 110, bottom: 126, left: 300, right: 300, width: 0, height: 16 }),
      { positionLifecycle: 'dismiss-on-nested-scroll' }
    );

    expect(popover.getElement().style.top).toBe('');
    expect(popover.getElement().style.left).toBe('');
  });

  it('repositions and re-stamps the resolved side when already shown', () => {
    const trigger = document.createElement('button');

    document.body.appendChild(trigger);
    vi.spyOn(trigger, 'getBoundingClientRect').mockReturnValue(
      makeRect({ top: 500, bottom: 540, left: 50, right: 200, width: 150, height: 40 })
    );

    const popover = createPopover({ trigger });
    const instance = asInternal(popover);

    vi.spyOn(instance, 'size', 'get').mockReturnValue({ height: 300, width: 150 });

    const originalInnerHeight = window.innerHeight;

    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 600, writable: true });

    try {
      popover.show();

      expect(popover.getElement().getAttribute('data-side')).toBe('top');

      popover.updatePosition(
        makeRect({ top: 100, bottom: 140, left: 50, right: 200, width: 150, height: 40 }),
        { positionLifecycle: 'dismiss-on-nested-scroll' }
      );

      expect(popover.getElement().style.left).toBe('50px');
      expect(popover.getElement().style.top).toBe('148px');
      expect(popover.getElement().getAttribute('data-side')).toBe('bottom');
    } finally {
      Object.defineProperty(window, 'innerHeight', { configurable: true, value: originalInnerHeight, writable: true });
    }
  });
});

describe('PopoverDesktop — hide', () => {
  it('clears the explicit anchor and pixel styles on hide', () => {
    const trigger = document.createElement('button');
    const leftAlignElement = document.createElement('div');

    document.body.append(trigger, leftAlignElement);
    vi.spyOn(trigger, 'getBoundingClientRect').mockReturnValue(
      makeRect({ top: 100, bottom: 140, left: 50, right: 90, width: 40, height: 40 })
    );
    vi.spyOn(leftAlignElement, 'getBoundingClientRect').mockReturnValue(
      makeRect({ top: 100, bottom: 140, left: 200, right: 600, width: 400, height: 40 })
    );

    const popover = createPopover({ trigger, leftAlignElement });

    popover.updatePosition(
      makeRect({ top: 110, bottom: 126, left: 500, right: 500, width: 0, height: 16 }),
      { positionLifecycle: 'dismiss-on-nested-scroll' }
    );
    popover.show();
    expect(popover.getElement().style.left).toBe('500px');

    popover.hide();

    expect(popover.getElement().style.top).toBe('');
    expect(popover.getElement().style.left).toBe('');

    popover.show();

    // The stale caret rect is gone: alignment falls back to leftAlignElement.
    expect(popover.getElement().style.left).toBe('200px');
  });

  it('detaches the position tracker on hide so later resizes leave the size cache alone', () => {
    const trigger = document.createElement('button');

    document.body.appendChild(trigger);
    vi.spyOn(trigger, 'getBoundingClientRect').mockReturnValue(
      makeRect({ top: 100, bottom: 140, left: 100, right: 140, width: 40, height: 40 })
    );

    const popover = createPopover({ trigger });

    popover.show();
    popover.hide();

    const before = asInternal(popover).size;

    window.dispatchEvent(new Event('resize'));

    expect(asInternal(popover).size).toBe(before);
  });
});

describe('PopoverDesktop — size measurement', () => {
  it('serves repeated reads from the size cache', () => {
    const popover = createPopover();

    const first = asInternal(popover).size;
    const second = asInternal(popover).size;

    expect(second).toBe(first);
  });

  it('measures on a styled detached clone, then removes it', () => {
    const popover = createPopover();
    const instance = asInternal(popover);

    let clone: HTMLElement | undefined;

    const originalAppend = document.body.appendChild.bind(document.body);

    vi.spyOn(document.body, 'appendChild').mockImplementation((node: Node) => {
      if (node instanceof HTMLElement && node.hasAttribute(ATTR_OPENED)) {
        clone = node;
      }

      return originalAppend(node);
    });

    popover.invalidateSizeCache();
    void instance.size;

    expect(clone).toBeDefined();
    expect(clone?.style.visibility).toBe('hidden');
    expect(clone?.style.position).toBe('absolute');
    expect(clone?.style.top).toBe('-1000px');
    expect(clone?.getAttribute(ATTR_OPENED)).toBe('true');
    expect(clone?.isConnected).toBe(false);
  });
});

describe('PopoverDesktop — flippable elements', () => {
  it('collects enabled item roots plus the interactive controls of html items', () => {
    const htmlElement = document.createElement('div');
    const htmlButton = document.createElement('button');
    const htmlInput = document.createElement('input');

    htmlElement.append(htmlButton, htmlInput);

    const popover = createPopover({
      items: [
        { title: 'Enabled', name: 'enabled', onActivate: vi.fn() },
        { title: 'Disabled', name: 'disabled', onActivate: vi.fn(), isDisabled: true },
        { type: PopoverItemType.Separator },
        { type: PopoverItemType.Html, name: 'custom-html', element: htmlElement },
      ],
    });

    const enabledElement = itemByName(popover, 'enabled').getElement();

    expect(enabledElement).not.toBeNull();
    expect(asInternal(popover).flippableElements).toEqual([enabledElement, htmlButton, htmlInput]);
  });
});

describe('PopoverDesktop — flip hook', () => {
  it('refreshes the focused item on flip and survives a flip with nothing focused', () => {
    const popover = createPopover();
    const instance = asInternal(popover);
    const alpha = itemByName(popover, 'alpha');
    const alphaElement = alpha.getElement();

    expect(alphaElement).not.toBeNull();

    alphaElement?.setAttribute(ATTR_FOCUSED, 'true');
    alphaElement?.setAttribute(ATTR_ITEM_NO_HOVER, 'true');
    alphaElement?.setAttribute(ATTR_ITEM_NO_FOCUS, 'true');

    getFlipper(0).triggerFlip();

    expect(alphaElement?.hasAttribute(ATTR_ITEM_NO_HOVER)).toBe(false);
    expect(alphaElement?.hasAttribute(ATTR_ITEM_NO_FOCUS)).toBe(false);

    alphaElement?.removeAttribute(ATTR_FOCUSED);

    expect(() => getFlipper(0).triggerFlip()).not.toThrow();
    expect(instance.items.length).toBeGreaterThan(0);
  });
});

describe('PopoverDesktop — nested submenu lifecycle', () => {
  it('opens beside the trigger item for the keyboard path and positions by the item offset', () => {
    const popover = createPopover({ items: [parentWithChildren()] });
    const instance = asInternal(popover);
    const parentItem = itemByName(popover, 'c-parent');
    const parentElement = parentItem.getElement();

    expect(parentElement).not.toBeNull();

    if (parentElement !== null) {
      Object.defineProperty(parentElement, 'offsetTop', { configurable: true, get: () => 75 });
    }
    Object.defineProperty(instance.nodes.items, 'scrollTop', { configurable: true, value: 25 });
    Object.defineProperty(instance.nodes.popoverContainer, 'offsetTop', { configurable: true, get: () => 100 });

    // Attach the parent first: the nested popover's own show() re-parents any
    // disconnected mount target to document.body.
    popover.show();

    const nested = instance.showNestedPopoverForItem(parentItem);

    expect(instance.nestedPopover).toBe(nested);
    expect(nested.getElement().hasAttribute(ATTR_NESTED)).toBe(true);
    expect(popover.getElement().contains(nested.getMountElement())).toBe(true);
    expect(nested.getMountElement().style.getPropertyValue('--trigger-item-top')).toBe('150px');
    expect(nested.getElement().getAttribute('data-side')).toBe('right');
    expect(parentElement).toHaveAttribute('aria-expanded', 'true');
    expect(getFlipper(0).deactivate).toHaveBeenCalled();
  });

  it('runs the whole nested lifecycle without a flipper when flippable is false', () => {
    const popover = createPopover({ flippable: false, items: [parentWithChildren()] });
    const instance = asInternal(popover);
    const parentItem = itemByName(popover, 'c-parent');

    expect(() => instance.showNestedItems(parentItem)).not.toThrow();
    expect(instance.nestedPopover).toBeInstanceOf(PopoverDesktop);
    expect(() => instance.destroyNestedPopoverIfExists()).not.toThrow();
    expect(instance.nestedPopover).toBeNull();
  });

  it('refreshes the trigger active state on clicks inside the submenu', () => {
    let isBold = true;

    const popover = createPopover({
      items: [
        {
          title: 'Bold Parent',
          name: 'bold-parent',
          isActive: () => isBold,
          children: {
            items: [
              {
                title: 'Clear Child',
                name: 'clear-child',
                onActivate: () => {
                  isBold = false;
                },
              },
            ],
          },
        },
      ],
    });
    const instance = asInternal(popover);
    const parentItem = itemByName(popover, 'bold-parent');

    // showNestedItems records the trigger item; showNestedPopoverForItem alone
    // leaves it null, which is what gates the click refresh.
    popover.show();
    instance.showNestedItems(parentItem);

    const nested = instance.nestedPopover;

    expect(nested).toBeInstanceOf(PopoverDesktop);

    expect(parentItem.getElement()).toHaveAttribute(ATTR_ITEM_ACTIVE, 'true');

    const childItem = asInternal(nested as PopoverDesktop).items.find(
      (item): item is PopoverItemDefault => item instanceof PopoverItemDefault && item.name === 'clear-child'
    );
    const childElement = childItem?.getElement();

    expect(childElement).not.toBeNull();
    childElement?.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    expect(parentItem.getElement()?.hasAttribute(ATTR_ITEM_ACTIVE)).toBe(false);
  });

  it('cancels a pending grace close when the keyboard asks for the submenu again', () => {
    vi.useFakeTimers();
    const popover = createPopover({
      items: [
        { title: 'Plain', name: 'plain', onActivate: vi.fn() },
        parentWithChildren(),
      ],
    });
    const instance = asInternal(popover);
    const parentItem = itemByName(popover, 'c-parent');
    const parentElement = parentItem.getElement();

    instance.handleHover(hoverOn(parentElement as Element));
    vi.advanceTimersByTime(100);

    const opened = instance.nestedPopover;

    expect(opened).toBeInstanceOf(PopoverDesktop);

    // Pointer wanders onto chrome → grace close scheduled at +300ms.
    instance.handleHover(hoverOn(instance.nodes.popoverContainer));

    // Keyboard re-asks for the same submenu before the grace elapses.
    instance.showNestedItems(parentItem);

    vi.advanceTimersByTime(400);

    expect(instance.nestedPopover).toBe(opened);
  });

  it('abandons a sibling hover open-intent when the keyboard opens another submenu', () => {
    vi.useFakeTimers();
    const popover = createPopover({
      items: [
        parentWithChildren(),
        {
          title: 'Sibling',
          name: 'sibling',
          children: {
            items: [{ title: 'Other', name: 'other', onActivate: vi.fn() }],
          },
        },
      ],
    });
    const instance = asInternal(popover);
    const parentItem = itemByName(popover, 'c-parent');
    const siblingItem = itemByName(popover, 'sibling');

    instance.handleHover(hoverOn(siblingItem.getElement() as Element));

    // Before the 100ms intent elapses, the keyboard opens the parent submenu.
    instance.showNestedItems(parentItem);
    vi.advanceTimersByTime(100);

    expect(instance.nestedPopoverTriggerItem).toBe(parentItem);
  });

  it('hasNode answers false without crashing when no submenu is open', () => {
    const popover = createPopover({ items: [parentWithChildren()] });

    expect(popover.hasNode(document.createElement('span'))).toBe(false);
    expect(popover.hasNode(asInternal(popover).nodes.popover)).toBe(true);
  });

  it('hasNode reports nodes of the open submenu', () => {
    const popover = createPopover({ items: [parentWithChildren()] });
    const instance = asInternal(popover);
    const nested = instance.showNestedPopoverForItem(itemByName(popover, 'c-parent'));

    expect(popover.hasNode(nested.getElement())).toBe(true);
    expect(popover.hasNode(nested.getMountElement())).toBe(true);
    expect(popover.hasNode(document.createElement('span'))).toBe(false);
  });

  it('destroy with restoreFocus refocuses the trigger item and not the first item', () => {
    const popover = createPopover({
      items: [
        { title: 'Plain', name: 'plain', onActivate: vi.fn() },
        parentWithChildren(),
      ],
    });
    const instance = asInternal(popover);
    const parentItem = itemByName(popover, 'c-parent');
    const parentElement = parentItem.getElement();

    expect(parentElement).not.toBeNull();

    instance.showNestedItems(parentItem);
    instance.destroyNestedPopoverIfExists();

    const triggerIndex = instance.flippableElements.indexOf(parentElement as HTMLElement);

    expect(triggerIndex).toBeGreaterThanOrEqual(0);
    expect(getFlipper(0).focusItem).toHaveBeenCalledWith(triggerIndex, { skipNextTab: false });
    expect(getFlipper(0).focusFirst).not.toHaveBeenCalled();
    expect(parentElement).toHaveAttribute('aria-expanded', 'false');
  });

  it('falls back to the first item when the trigger is not flippable', () => {
    const popover = createPopover({
      items: [
        {
          title: 'Gone',
          name: 'gone',
          isDisabled: true,
          children: {
            items: [{ title: 'Child', name: 'child', onActivate: vi.fn() }],
          },
        },
      ],
    });
    const instance = asInternal(popover);

    instance.showNestedItems(itemByName(popover, 'gone'));
    instance.destroyNestedPopoverIfExists();

    expect(getFlipper(0).focusFirst).toHaveBeenCalledOnce();
    expect(getFlipper(0).focusItem).not.toHaveBeenCalled();
  });

  it('pointer-driven close emits Closed, removes the element, and keeps focus untouched', () => {
    const popover = createPopover({ items: [parentWithChildren()] });
    const instance = asInternal(popover);
    const parentItem = itemByName(popover, 'c-parent');
    const nested = instance.showNestedPopoverForItem(parentItem);
    const nestedMount = nested.getMountElement();
    const closedSpy = vi.fn();

    nested.on(PopoverEvent.Closed, closedSpy);

    instance.destroyNestedPopoverIfExists(false);

    expect(instance.nestedPopover).toBeNull();
    expect(instance.nestedPopoverTriggerItem).toBeNull();
    expect(nestedMount.isConnected).toBe(false);
    expect(nestedMount.hasAttribute(ATTR_OPENED)).toBe(false);
    expect(popover.getElement().contains(nestedMount)).toBe(false);
    expect(getFlipper(0).focusFirst).not.toHaveBeenCalled();
    expect(getFlipper(0).focusItem).not.toHaveBeenCalled();
  });
});

describe('PopoverDesktop — hover open/close intents', () => {
  it('cancels the deferred open when the pointer settles on chrome', () => {
    vi.useFakeTimers();
    const popover = createPopover({
      items: [
        { title: 'Plain', name: 'plain', onActivate: vi.fn() },
        parentWithChildren(),
      ],
    });
    const instance = asInternal(popover);
    const parentElement = itemByName(popover, 'c-parent').getElement();

    instance.handleHover(hoverOn(parentElement as Element));
    instance.handleHover(hoverOn(instance.nodes.popoverContainer));

    vi.advanceTimersByTime(100);

    expect(instance.nestedPopover).toBeFalsy();
  });

  it('re-hovering the trigger inside the intent window keeps the original deadline', () => {
    vi.useFakeTimers();
    const popover = createPopover({ items: [parentWithChildren()] });
    const instance = asInternal(popover);
    const parentElement = itemByName(popover, 'c-parent').getElement();
    const hover = hoverOn(parentElement as Element);

    instance.handleHover(hover);
    vi.advanceTimersByTime(90);

    instance.handleHover(hover);
    vi.advanceTimersByTime(10);

    expect(instance.nestedPopover).toBeInstanceOf(PopoverDesktop);
  });

  it('a close scheduled with no submenu open must not kill a submenu opened inside its window', () => {
    vi.useFakeTimers();
    const popover = createPopover({
      items: [
        { title: 'Plain', name: 'plain', onActivate: vi.fn() },
        parentWithChildren(),
      ],
    });
    const instance = asInternal(popover);
    const parentElement = itemByName(popover, 'c-parent').getElement();

    // Chrome hover with NO submenu: schedules nothing in the correct code.
    instance.handleHover(hoverOn(instance.nodes.popoverContainer));
    vi.advanceTimersByTime(50);

    instance.handleHover(hoverOn(parentElement as Element));
    vi.advanceTimersByTime(100);

    expect(instance.nestedPopover).toBeInstanceOf(PopoverDesktop);

    vi.advanceTimersByTime(200);

    expect(instance.nestedPopover).toBeInstanceOf(PopoverDesktop);
  });

  it('the grace close keeps its original deadline when the pointer keeps wandering', () => {
    vi.useFakeTimers();
    const popover = createPopover({
      items: [
        { title: 'Plain', name: 'plain', onActivate: vi.fn() },
        parentWithChildren(),
      ],
    });
    const instance = asInternal(popover);
    const parentElement = itemByName(popover, 'c-parent').getElement();
    const plainElement = itemByName(popover, 'plain').getElement();

    instance.handleHover(hoverOn(parentElement as Element));
    vi.advanceTimersByTime(100);

    instance.handleHover(hoverOn(instance.nodes.popoverContainer));
    vi.advanceTimersByTime(150);

    instance.handleHover(hoverOn(plainElement as Element));
    vi.advanceTimersByTime(150);

    // 300ms since the pointer LEFT THE TRIGGER, not since the last row change.
    expect(instance.nestedPopover).toBeFalsy();
  });

  it('cancels the grace close when the pointer returns to the trigger in time', () => {
    vi.useFakeTimers();
    const popover = createPopover({ items: [parentWithChildren()] });
    const instance = asInternal(popover);
    const parentElement = itemByName(popover, 'c-parent').getElement();

    instance.handleHover(hoverOn(parentElement as Element));
    vi.advanceTimersByTime(100);

    const opened = instance.nestedPopover;

    instance.handleHover(hoverOn(instance.nodes.popoverContainer));
    vi.advanceTimersByTime(200);
    instance.handleHover(hoverOn(parentElement as Element));
    vi.advanceTimersByTime(400);

    expect(instance.nestedPopover).toBe(opened);
  });

  it('pointer close does not restore keyboard focus', () => {
    vi.useFakeTimers();
    const popover = createPopover({
      items: [
        { title: 'Plain', name: 'plain', onActivate: vi.fn() },
        parentWithChildren(),
      ],
    });
    const instance = asInternal(popover);
    const parentElement = itemByName(popover, 'c-parent').getElement();
    const plainElement = itemByName(popover, 'plain').getElement();

    instance.handleHover(hoverOn(parentElement as Element));
    vi.advanceTimersByTime(100);

    instance.handleHover(hoverOn(plainElement as Element));
    vi.advanceTimersByTime(300);

    expect(instance.nestedPopover).toBeNull();
    expect(getFlipper(0).focusFirst).not.toHaveBeenCalled();
    expect(getFlipper(0).focusItem).not.toHaveBeenCalled();
  });

  it('pointer swapping to a sibling trigger reopens for the sibling and survives the stale close', () => {
    vi.useFakeTimers();
    const popover = createPopover({
      items: [
        parentWithChildren(),
        {
          title: 'Sibling',
          name: 'sibling',
          children: {
            items: [{ title: 'Other', name: 'other', onActivate: vi.fn() }],
          },
        },
      ],
    });
    const instance = asInternal(popover);
    const parentItem = itemByName(popover, 'c-parent');
    const siblingItem = itemByName(popover, 'sibling');

    instance.handleHover(hoverOn(parentItem.getElement() as Element));
    vi.advanceTimersByTime(100);

    instance.handleHover(hoverOn(siblingItem.getElement() as Element));
    vi.advanceTimersByTime(100);

    expect(instance.nestedPopoverTriggerItem).toBe(siblingItem);

    vi.advanceTimersByTime(400);

    expect(instance.nestedPopover).toBeInstanceOf(PopoverDesktop);
    expect(instance.nestedPopoverTriggerItem).toBe(siblingItem);
  });

  it('hovering a plain sibling abandons a sibling open intent and closes the submenu', () => {
    vi.useFakeTimers();
    const popover = createPopover({
      items: [
        parentWithChildren(),
        { title: 'Plain', name: 'plain', onActivate: vi.fn() },
        {
          title: 'Sibling',
          name: 'sibling',
          children: {
            items: [{ title: 'Other', name: 'other', onActivate: vi.fn() }],
          },
        },
      ],
    });
    const instance = asInternal(popover);
    const plainElement = itemByName(popover, 'plain').getElement();
    const siblingElement = itemByName(popover, 'sibling').getElement();

    instance.handleHover(hoverOn(siblingElement as Element));
    vi.advanceTimersByTime(100);

    expect(instance.nestedPopover).toBeInstanceOf(PopoverDesktop);

    instance.handleHover(hoverOn(plainElement as Element));
    vi.advanceTimersByTime(300);

    expect(instance.nestedPopover).toBeNull();
  });

  it('entering the open submenu cancels the pending grace close', () => {
    vi.useFakeTimers();
    const popover = createPopover({ items: [parentWithChildren()] });
    const instance = asInternal(popover);
    const parentElement = itemByName(popover, 'c-parent').getElement();

    instance.handleHover(hoverOn(parentElement as Element));
    vi.advanceTimersByTime(100);

    const opened = instance.nestedPopover;

    expect(opened).toBeInstanceOf(PopoverDesktop);

    instance.handleHover(hoverOn(instance.nodes.popoverContainer));
    opened?.getMountElement().dispatchEvent(new MouseEvent('pointerenter'));

    vi.advanceTimersByTime(400);

    expect(instance.nestedPopover).toBe(opened);
  });

  it('a hover targeted inside the open submenu cancels the pending grace close', () => {
    vi.useFakeTimers();
    const popover = createPopover({ items: [parentWithChildren()] });
    const instance = asInternal(popover);
    const parentElement = itemByName(popover, 'c-parent').getElement();

    instance.handleHover(hoverOn(parentElement as Element));
    vi.advanceTimersByTime(100);

    const opened = instance.nestedPopover;

    expect(opened).toBeInstanceOf(PopoverDesktop);

    instance.handleHover(hoverOn(instance.nodes.popoverContainer));

    const inside = new MouseEvent('mouseover');

    Object.defineProperty(inside, 'target', { value: asInternal(opened as PopoverDesktop).nodes.popoverContainer });
    Object.defineProperty(inside, 'composedPath', { value: () => [opened?.getMountElement() as Node] });
    instance.handleHover(inside);

    vi.advanceTimersByTime(400);

    expect(instance.nestedPopover).toBe(opened);
  });

  it('hover over a promoted item activates it through the click pipeline', () => {
    const childActivate = vi.fn();
    const popover = createPopover({
      items: [
        {
          title: 'Convert',
          name: 'c-parent',
          children: {
            items: [{ title: 'Convert', name: 'c-child', onActivate: childActivate }],
          },
        },
      ],
    });
    const instance = asInternal(popover);

    popover.show();
    popover.filterItems('convert');

    const childItem = instance.promotedItemCache?.items.find(item => item.name === 'c-child');
    const childElement = childItem?.getElement();

    expect(childItem).toBeDefined();
    expect(childElement).not.toBeNull();
    expect(childElement?.isConnected).toBe(true);

    childElement?.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    expect(childActivate).toHaveBeenCalledOnce();
  });
});

describe('PopoverDesktop — mouseleave', () => {
  it('closes the open submenu a grace period after the pointer leaves for an outside node', () => {
    vi.useFakeTimers();
    const popover = createPopover({ items: [parentWithChildren()] });
    const instance = asInternal(popover);
    const parentElement = itemByName(popover, 'c-parent').getElement();

    instance.handleHover(hoverOn(parentElement as Element));
    vi.advanceTimersByTime(100);

    const outside = document.createElement('div');

    document.body.appendChild(outside);

    instance.handleMouseLeave(new MouseEvent('mouseleave', { relatedTarget: outside }));

    expect(instance.previouslyHoveredItem).toBeNull();

    vi.advanceTimersByTime(299);
    expect(instance.nestedPopover).toBeInstanceOf(PopoverDesktop);

    vi.advanceTimersByTime(1);
    expect(instance.nestedPopover).toBeNull();
  });

  it('keeps the submenu when the pointer moved into it', () => {
    vi.useFakeTimers();
    const popover = createPopover({ items: [parentWithChildren()] });
    const instance = asInternal(popover);
    const parentElement = itemByName(popover, 'c-parent').getElement();

    instance.handleHover(hoverOn(parentElement as Element));
    vi.advanceTimersByTime(100);

    const nested = instance.nestedPopover;

    expect(nested).toBeInstanceOf(PopoverDesktop);

    instance.handleMouseLeave(new MouseEvent('mouseleave', { relatedTarget: nested?.getElement() }));

    vi.advanceTimersByTime(400);

    expect(instance.nestedPopover).toBe(nested);
  });

  it('a leave with no related target abandons a pending open intent', () => {
    vi.useFakeTimers();
    const popover = createPopover({ items: [parentWithChildren()] });
    const instance = asInternal(popover);
    const parentElement = itemByName(popover, 'c-parent').getElement();

    instance.handleHover(hoverOn(parentElement as Element));
    instance.handleMouseLeave(new MouseEvent('mouseleave'));

    vi.advanceTimersByTime(100);

    expect(instance.nestedPopover).toBeFalsy();
  });
});

describe('PopoverDesktop — filterItems and search', () => {
  it('hides non-matches, ranks matches, and reorders the container by score', () => {
    const popover = createPopover({
      items: [
        { title: 'Zebra', name: 'zebra', onActivate: vi.fn() },
        { title: 'Alpha Beta', name: 'alpha-beta', onActivate: vi.fn() },
        { title: 'Alpha', name: 'alpha', onActivate: vi.fn() },
      ],
    });
    const instance = asInternal(popover);

    popover.show();
    popover.filterItems('alpha');

    const alphaElement = itemByName(popover, 'alpha').getElement();
    const alphaBetaElement = itemByName(popover, 'alpha-beta').getElement();
    const zebraElement = itemByName(popover, 'zebra').getElement();

    expect(alphaElement).not.toHaveAttribute(ATTR_HIDDEN);
    expect(zebraElement).toHaveAttribute(ATTR_HIDDEN, 'true');

    const order = Array.from(instance.nodes.items.children);

    expect(order.indexOf(alphaElement as HTMLElement)).toBeGreaterThanOrEqual(0);
    expect(order.indexOf(alphaElement as HTMLElement)).toBeLessThan(order.indexOf(alphaBetaElement as HTMLElement));
  });

  it('restores the original container order when the query is cleared', () => {
    const popover = createPopover({
      items: [
        { title: 'Zebra', name: 'zebra', onActivate: vi.fn() },
        { title: 'Alpha', name: 'alpha', onActivate: vi.fn() },
      ],
    });
    const instance = asInternal(popover);

    popover.show();

    const originalOrder = Array.from(instance.nodes.items.children);

    popover.filterItems('alpha');
    popover.filterItems('');

    expect(Array.from(instance.nodes.items.children)).toEqual(originalOrder);
    expect(itemByName(popover, 'zebra').getElement()).not.toHaveAttribute(ATTR_HIDDEN);
  });

  it('an empty query never reorders around separators', () => {
    const popover = createPopover({
      items: [
        { title: 'Alpha', name: 'alpha', onActivate: vi.fn() },
        { type: PopoverItemType.Separator },
        { title: 'Zebra', name: 'zebra', onActivate: vi.fn() },
      ],
    });
    const instance = asInternal(popover);

    popover.show();

    const originalOrder = Array.from(instance.nodes.items.children);

    popover.filterItems('alpha');
    popover.filterItems('');

    expect(Array.from(instance.nodes.items.children)).toEqual(originalOrder);
  });

  it('promotes matching nested children under a labeled group separator', () => {
    const popover = createPopover({
      items: [
        { title: 'Plain', name: 'plain', onActivate: vi.fn() },
        {
          title: 'Convert',
          name: 'c-parent',
          children: {
            items: [
              { title: 'Convert', name: 'c-child', onActivate: vi.fn() },
              { title: 'Unrelated', name: 'c-other', onActivate: vi.fn() },
            ],
          },
        },
      ],
    });
    const instance = asInternal(popover);

    popover.show();
    popover.filterItems('convert');

    const childItem = instance.promotedItemCache?.items.find(item => item.name === 'c-child');

    expect(childItem).toBeDefined();
    expect(childItem?.getElement()?.isConnected).toBe(true);

    const separator = instance.nodes.items.querySelector(`[${ATTR_PROMOTED_GROUP}]`);

    expect(separator).not.toBeNull();
    expect(separator?.textContent).toBe('Convert');
    expect(separator?.getAttribute('role')).toBe('separator');
    expect(separator?.tagName).toBe('DIV');

    // Same title at the top level is deduplicated away; the plain row hides.
    expect(itemByName(popover, 'c-parent').getElement()).toHaveAttribute(ATTR_HIDDEN, 'true');
    expect(itemByName(popover, 'plain').getElement()).toHaveAttribute(ATTR_HIDDEN, 'true');
  });

  it('ranks promoted children within a group by score', () => {
    const popover = createPopover({
      items: [
        {
          title: 'Convert',
          name: 'c-parent',
          children: {
            items: [
              { title: 'Iconvert', name: 'c-weak', onActivate: vi.fn() },
              { title: 'Conv', name: 'c-strong', onActivate: vi.fn() },
            ],
          },
        },
      ],
    });
    const instance = asInternal(popover);

    popover.filterItems('conv');

    const strongElement = instance.promotedItemCache?.items.find(item => item.name === 'c-strong')?.getElement();
    const weakElement = instance.promotedItemCache?.items.find(item => item.name === 'c-weak')?.getElement();

    expect(strongElement).toBeDefined();
    expect(weakElement).toBeDefined();

    const order = Array.from(instance.nodes.items.children);

    // Declared order is weak-then-strong; ranking must append strong first.
    expect(order.indexOf(strongElement as HTMLElement)).toBeLessThan(order.indexOf(weakElement as HTMLElement));
  });

  it('keeps a toggle control with the same title as a promoted entry', () => {
    const popover = createPopover({
      items: [
        { title: 'Convert', name: 'c-toggle', toggle: true, onActivate: vi.fn() },
        {
          title: 'Convert',
          name: 'c-parent',
          children: {
            items: [{ title: 'Convert', name: 'c-child', onActivate: vi.fn() }],
          },
        },
      ],
    });

    popover.filterItems('convert');

    expect(itemByName(popover, 'c-toggle').getElement()).not.toHaveAttribute(ATTR_HIDDEN);
    expect(itemByName(popover, 'c-parent').getElement()).toHaveAttribute(ATTR_HIDDEN, 'true');
  });

  it('renders one top-level group header only while both match sets are non-empty', () => {
    const popover = createPopover({
      messages: { actions: 'Custom Acts' },
      items: [
        { title: 'Convert Speed', name: 'c-speed', onActivate: vi.fn() },
        {
          title: 'Convert',
          name: 'c-parent',
          children: {
            items: [{ title: 'Convert', name: 'c-child', onActivate: vi.fn() }],
          },
        },
      ],
    });
    const instance = asInternal(popover);

    popover.filterItems('convert');

    const headers = instance.nodes.items.querySelectorAll(`[${ATTR_TOP_LEVEL_GROUP}]`);

    expect(headers).toHaveLength(1);
    expect(headers[0]?.textContent).toBe('Custom Acts');

    // A second non-empty search must not stack a second header.
    popover.filterItems('conv');

    expect(instance.nodes.items.querySelectorAll(`[${ATTR_TOP_LEVEL_GROUP}]`)).toHaveLength(1);

    // Clearing removes the header entirely.
    popover.filterItems('');

    expect(instance.nodes.items.querySelectorAll(`[${ATTR_TOP_LEVEL_GROUP}]`)).toHaveLength(0);
  });

  it('reuses the promoted item cache across non-empty searches', () => {
    const popover = createPopover({
      searchable: true,
      items: [
        {
          title: 'Convert',
          name: 'c-parent',
          children: {
            items: [{ title: 'Convert', name: 'c-child', onActivate: vi.fn() }],
          },
        },
      ],
    });
    const instance = asInternal(popover);
    const input = popover.getElement().querySelector('input');

    expect(input).not.toBeNull();

    (input as HTMLInputElement).value = 'convert';
    input?.dispatchEvent(new Event('input'));

    const firstCache = instance.promotedItemCache;
    const firstElement = instance.promotedItemCache?.items.find(item => item.name === 'c-child')?.getElement();

    (input as HTMLInputElement).value = 'conver';
    input?.dispatchEvent(new Event('input'));

    expect(instance.promotedItemCache).toBe(firstCache);
    expect(instance.promotedItemCache?.items.find(item => item.name === 'c-child')?.getElement()).toBe(firstElement);
  });

  it('ranks promoted groups by their best score in the search path', () => {
    const popover = createPopover({
      searchable: true,
      items: [
        {
          title: 'Group One',
          name: 'group-one',
          children: {
            items: [{ title: 'Convoluted', name: 'one-child', onActivate: vi.fn() }],
          },
        },
        {
          title: 'Group Two',
          name: 'group-two',
          children: {
            items: [
              { title: 'CxxOxxNxxV', name: 'two-weak', onActivate: vi.fn() },
              { title: 'Conv', name: 'two-strong', onActivate: vi.fn() },
            ],
          },
        },
        {
          title: 'Group Three',
          name: 'group-three',
          children: {
            items: [{ title: 'Iconvert', name: 'three-child', onActivate: vi.fn() }],
          },
        },
      ],
    });
    const input = popover.getElement().querySelector('input');

    (input as HTMLInputElement).value = 'conv';
    input?.dispatchEvent(new Event('input'));

    const labels = [...popover.getElement().querySelectorAll(`[${ATTR_PROMOTED_GROUP}]`)]
      .map(el => el.textContent);

    // Best scores: Group Two 100 (exact), Group One 90 (prefix), Group Three 75
    // (substring). Insertion order is One, Two, Three — the sort must reorder.
    expect(labels).toEqual(['Group Two', 'Group One', 'Group Three']);
  });

  it('clearing the search input restores the unfiltered list', () => {
    const popover = createPopover({
      searchable: true,
      items: [
        { title: 'Alpha', name: 'alpha', onActivate: vi.fn() },
        { title: 'Zebra', name: 'zebra', onActivate: vi.fn() },
      ],
    });
    const input = popover.getElement().querySelector('input');

    (input as HTMLInputElement).value = 'alpha';
    input?.dispatchEvent(new Event('input'));

    expect(itemByName(popover, 'zebra').getElement()).toHaveAttribute(ATTR_HIDDEN, 'true');

    (input as HTMLInputElement).value = '';
    input?.dispatchEvent(new Event('input'));

    expect(itemByName(popover, 'zebra').getElement()).not.toHaveAttribute(ATTR_HIDDEN);
    expect(itemByName(popover, 'alpha').getElement()).not.toHaveAttribute(ATTR_HIDDEN);
  });

  it('reactivates the flipper with the ranked elements and refocuses the first match', () => {
    const popover = createPopover({
      items: [
        { title: 'Alpha', name: 'alpha', onActivate: vi.fn() },
        { title: 'Zebra', name: 'zebra', onActivate: vi.fn() },
      ],
    });

    popover.show();
    getFlipper(0).activate.mockClear();
    getFlipper(0).focusItem.mockClear();

    const alphaElement = itemByName(popover, 'alpha').getElement();

    popover.filterItems('alpha');

    expect(getFlipper(0).deactivate).toHaveBeenCalledOnce();
    expect(getFlipper(0).activate).toHaveBeenCalledWith([alphaElement]);
    expect(getFlipper(0).focusItem).toHaveBeenCalledWith(0, { skipNextTab: true });
  });

  it('does not touch an inactive flipper when filtering before show', () => {
    const popover = createPopover();

    popover.filterItems('alpha');

    expect(getFlipper(0).activate).not.toHaveBeenCalled();
    expect(getFlipper(0).deactivate).not.toHaveBeenCalled();
  });

  it('promotes listbox children with option roles and menu children with menuitem roles', () => {
    const menuPopover = createPopover({
      items: [
        {
          title: 'Convert',
          name: 'c-parent',
          children: {
            items: [{ title: 'Convert', name: 'c-child', onActivate: vi.fn() }],
          },
        },
      ],
    });
    const listboxPopover = createPopover({
      listbox: true,
      items: [
        {
          title: 'Convert',
          name: 'c-parent',
          children: {
            items: [{ title: 'Convert', name: 'l-child', onActivate: vi.fn() }],
          },
        },
      ],
    });

    menuPopover.filterItems('convert');
    listboxPopover.filterItems('convert');

    const menuChild = asInternal(menuPopover).promotedItemCache?.items.find(item => item.name === 'c-child');
    const listboxChild = asInternal(listboxPopover).promotedItemCache?.items.find(item => item.name === 'l-child');

    expect(menuChild?.getElement()?.getAttribute('role')).toBe('menuitem');
    expect(listboxChild?.getElement()?.getAttribute('role')).toBe('option');
  });

  it('excludes permanently hidden names from the promoted cache', () => {
    const popover = createPopover({
      items: [
        {
          title: 'Convert',
          name: 'c-parent',
          children: {
            items: [
              { title: 'Cattle', name: 'c-cattle', onActivate: vi.fn() },
              { title: 'Cavern', name: 'c-cavern', onActivate: vi.fn() },
            ],
          },
        },
      ],
    });
    const instance = asInternal(popover);

    popover.toggleItemHiddenByName('c-cattle', true);
    popover.filterItems('c');

    const names = instance.promotedItemCache?.items.map(item => item.name) ?? [];

    expect(names).toEqual(['c-cavern']);
  });

  it('hides separators and html items for non-empty queries and restores them when cleared', () => {
    const headerElement = document.createElement('div');

    headerElement.textContent = 'Basic blocks';

    const popover = createPopover({
      items: [
        { type: PopoverItemType.Separator },
        { type: PopoverItemType.Html, element: headerElement, name: 'header-html' },
        { title: 'Alpha', name: 'alpha', onActivate: vi.fn() },
      ],
    });
    const instance = asInternal(popover);
    const separatorElement = instance.items[0]?.getElement();

    popover.filterItems('alpha');

    expect(separatorElement).toHaveAttribute(ATTR_HIDDEN, 'true');
    expect(headerElement.parentElement).toHaveAttribute(ATTR_HIDDEN, 'true');

    popover.filterItems('');

    expect(separatorElement).not.toHaveAttribute(ATTR_HIDDEN);
  });

  it('announces the result count, the empty state, and clears for the unfiltered list', () => {
    const popover = createPopover({
      messages: { nothingFound: 'Nope', searchResults: 'Got {count} hits' },
      items: [
        { title: 'Alpha', name: 'alpha', onActivate: vi.fn() },
        { title: 'Alpine', name: 'alpine', onActivate: vi.fn() },
      ],
    });
    const instance = asInternal(popover);
    const announcer = instance.nodes.resultsAnnouncer;

    popover.filterItems('alp');

    expect(announcer.textContent).toBe('Got 2 hits');

    popover.filterItems('zzz');

    expect(announcer.textContent).toBe('Nope');
    expect(instance.nodes.nothingFoundMessage).toHaveAttribute(ATTR_NOTHING_FOUND, 'true');

    popover.filterItems('');

    expect(announcer.textContent).toBe('');
  });

  it('hides the context label for a non-empty query and restores it when cleared', () => {
    const popover = createPopover({ contextLabel: 'Text' });
    const instance = asInternal(popover);
    const label = instance.nodes.contextLabel;

    expect(label).toBeDefined();

    popover.filterItems('alpha');

    expect(label?.getAttribute(ATTR_HIDDEN)).toBe('true');
    expect(label?.classList.contains('hidden')).toBe(true);

    popover.filterItems('');

    expect(label?.hasAttribute(ATTR_HIDDEN)).toBe(false);
    expect(label?.classList.contains('hidden')).toBe(false);
  });

  it('keeps the announcer silent for non-empty results when no template is supplied', () => {
    const popover = createPopover();
    const instance = asInternal(popover);

    popover.filterItems('alpha');

    expect(instance.nodes.resultsAnnouncer.textContent).toBe('');
  });

  it('recalculates the pixel position after filtering on a trigger popover', () => {
    const trigger = document.createElement('button');

    document.body.appendChild(trigger);
    vi.spyOn(trigger, 'getBoundingClientRect').mockReturnValue(
      makeRect({ top: 100, bottom: 140, left: 50, right: 90, width: 40, height: 40 })
    );

    const popover = createPopover({ trigger });
    const instance = asInternal(popover);

    vi.spyOn(instance, 'size', 'get').mockReturnValue({ height: 50, width: 200 });

    popover.show();
    popover.filterItems('alpha');

    // anchor.bottom(140) + offset(8); aligned to the trigger's left edge.
    expect(popover.getElement().style.top).toBe('148px');
    expect(popover.getElement().style.left).toBe('50px');
  });

  it('keeps an item hidden by name through a filter cycle', () => {
    const popover = createPopover({
      items: [
        { title: 'Alpha', name: 'alpha', onActivate: vi.fn() },
        { title: 'Beta', name: 'beta', onActivate: vi.fn() },
      ],
    });

    popover.show();
    popover.toggleItemHiddenByName('alpha', true);
    popover.filterItems('');

    expect(itemByName(popover, 'alpha').getElement()).toHaveAttribute(ATTR_HIDDEN, 'true');
    expect(itemByName(popover, 'beta').getElement()).not.toHaveAttribute(ATTR_HIDDEN);

    popover.toggleItemHiddenByName('alpha', false);
    popover.filterItems('');

    expect(itemByName(popover, 'alpha').getElement()).not.toHaveAttribute(ATTR_HIDDEN);
  });
});

describe('PopoverDesktop — nested below placement', () => {
  const belowItem = (): PopoverParams['items'][number] => ({
    title: 'Link Field',
    name: 'link-field',
    children: {
      placement: 'below',
      items: [{ title: 'Child', name: 'child', onActivate: vi.fn() }],
    },
  });

  it('opens below the parent popover with a resize observer on the nested container', () => {
    const popover = createPopover({ items: [belowItem()] });
    const instance = asInternal(popover);

    vi.spyOn(instance.nodes.popoverContainer, 'getBoundingClientRect').mockReturnValue(
      makeRect({ left: 300, top: 200, right: 640, bottom: 290, width: 340, height: 90 })
    );
    vi.spyOn(instance.nodes.popover, 'getBoundingClientRect').mockReturnValue(
      makeRect({ left: 280, top: 180, right: 660, bottom: 300, width: 380, height: 120 })
    );

    const nested = instance.showNestedPopoverForItem(itemByName(popover, 'link-field'));

    expect(nested.getElement().getAttribute('data-side')).toBe('bottom');
    expect(nested.getElement().getAttribute('data-align')).toBe('start');

    const nestedContainer = asInternal(nested).nodes.popoverContainer;

    expect(nestedContainer.style.left).toBe('20px');
    expect(nestedContainer.style.top).toBe('114px');

    const observer = instance.nestedBelowResizeObserver;

    expect(observer).not.toBeNull();
    expect(observer?.observe).toHaveBeenCalledWith(nestedContainer);
  });

  it('attaches no resize observer for a beside-placement submenu', () => {
    const popover = createPopover({ items: [parentWithChildren()] });
    const instance = asInternal(popover);

    instance.showNestedPopoverForItem(itemByName(popover, 'c-parent'));

    expect(instance.nestedBelowResizeObserver).toBeNull();
  });

  it('re-clamps the below card on the observer callback once content drives a wider width', () => {
    const popover = createPopover({ items: [belowItem()] });
    const instance = asInternal(popover);

    vi.spyOn(instance.nodes.popoverContainer, 'getBoundingClientRect').mockReturnValue(
      makeRect({ left: 800, top: 200, right: 1140, bottom: 290, width: 340, height: 90 })
    );
    vi.spyOn(instance.nodes.popover, 'getBoundingClientRect').mockReturnValue(
      makeRect({ left: 780, top: 180, right: 1160, bottom: 300, width: 380, height: 120 })
    );

    instance.showNestedPopoverForItem(itemByName(popover, 'link-field'));

    const nested = instance.nestedPopover;
    const nestedContainer = nested === null || nested === undefined
      ? undefined
      : asInternal(nested).nodes.popoverContainer;

    expect(nestedContainer).toBeDefined();
    expect(nestedContainer?.style.left).toBe('20px');

    // Content grew: the card no longer fits left-aligned inside the viewport,
    // so placement pins its right edge to the margin via `right`.
    if (nestedContainer !== undefined) {
      Object.defineProperty(nestedContainer, 'offsetWidth', { configurable: true, value: 300 });
      Object.defineProperty(nestedContainer, 'offsetHeight', { configurable: true, value: 120 });
    }

    const observer = ResizeObserverStub.instances[ResizeObserverStub.instances.length - 1];

    observer.trigger();
    flushAnimationFrame();

    expect(nestedContainer?.style.left).toBe('auto');
    // right = parentRootRect.right(1160) - (innerWidth(1024) - margin(8)) = 144.
    expect(nestedContainer?.style.right).toBe('144px');
  });
});

describe('PopoverDesktop — nested beside placement geometry', () => {
  it('slides a wide submenu back inside the left viewport margin and centers on the trigger', () => {
    const popover = createPopover({
      items: [
        {
          title: 'Wide Trigger',
          name: 'wide-trigger',
          children: {
            items: [{ title: 'Child', name: 'child', onActivate: vi.fn() }],
          },
        },
      ],
    });
    const instance = asInternal(popover);

    vi.spyOn(instance.nodes.popoverContainer, 'getBoundingClientRect').mockReturnValue(
      makeRect({ left: -100, top: 100, right: 0, bottom: 190, width: 100, height: 90 })
    );
    vi.spyOn(instance.nodes.popover, 'getBoundingClientRect').mockReturnValue(
      makeRect({ left: -120, top: 80, right: 20, bottom: 210, width: 140, height: 130 })
    );

    const triggerItem = itemByName(popover, 'wide-trigger');
    const triggerElement = triggerItem.getElement();

    expect(triggerElement).not.toBeNull();

    if (triggerElement !== null) {
      vi.spyOn(triggerElement, 'getBoundingClientRect').mockReturnValue(
        makeRect({ top: 120, bottom: 160, left: -90, right: -10, width: 80, height: 40 })
      );
    }

    const sizeSpy = vi.spyOn(PopoverDesktop.prototype, 'size', 'get')
      .mockReturnValue({ width: 320, height: 80 });

    try {
      const nested = instance.showNestedPopoverForItem(triggerItem);
      const nestedContainer = asInternal(nested).nodes.popoverContainer;

      // viewportLeft = right(0) - overlap(4) = -4, clamped up to the 8px margin,
      // then converted into the parent-root space (root.left = -120): 8 + 120 = 128.
      expect(nestedContainer.style.left).toBe('128px');

      // Centered on the trigger item: centerY(140) - height/2(40) = 100,
      // converted into the parent-root space (root.top = 80): 100 - 80 = 20.
      expect(nestedContainer.style.top).toBe('20px');
      expect(nested.getElement().getAttribute('data-side')).toBe('right');
      expect(nested.getElement().getAttribute('data-align')).toBe('center');
    } finally {
      sizeSpy.mockRestore();
    }
  });

  it('uses the CSS calc fallback when the submenu has no measurable height yet', () => {
    const popover = createPopover({ items: [parentWithChildren()] });
    const instance = asInternal(popover);

    vi.spyOn(instance.nodes.popoverContainer, 'getBoundingClientRect').mockReturnValue(
      makeRect({ left: 300, top: 200, right: 640, bottom: 290, width: 340, height: 90 })
    );
    vi.spyOn(instance.nodes.popover, 'getBoundingClientRect').mockReturnValue(
      makeRect({ left: 280, top: 180, right: 660, bottom: 300, width: 380, height: 120 })
    );

    const nested = instance.showNestedPopoverForItem(itemByName(popover, 'c-parent'));
    const nestedContainer = asInternal(nested).nodes.popoverContainer;

    expect(nestedContainer.style.top)
      .toBe('calc(var(--trigger-item-top) - var(--popover-height) / 2 + var(--item-height) / 2)');
  });
});
