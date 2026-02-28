import { describe, it, expect, beforeEach, afterEach, vi, type MockInstance, type Mock } from 'vitest';



type SearchPayload = { query: string; items: unknown[] };

type MockFlipperShape = {
  activate: Mock<(items?: HTMLElement[]) => void>;
  deactivate: Mock<() => void>;
  focusFirst: Mock<() => void>;
  focusItem: Mock<(position: number, options?: { skipNextTab?: boolean }) => void>;
  onFlip: Mock<(callback: () => void) => void>;
  removeOnFlip: Mock<(callback: () => void) => void>;
  getHandleContentEditableTargets: Mock<() => boolean>;
  triggerFlip: () => void;
  lastActivatedWith: HTMLElement[] | undefined;
  readonly isActivated: boolean;
  hasFocus: () => boolean;
};

type MockSearchInputShape = {
  on: Mock<(event: string, handler: (payload: SearchPayload) => void) => void>;
  getElement: Mock<() => HTMLElement>;
  focus: Mock<() => void>;
  clear: Mock<() => void>;
  destroy: Mock<() => void>;
  emitSearch: (payload: SearchPayload) => void;
  element: HTMLElement;
  items: unknown[];
  placeholder: string | undefined;
};

const flipperRegistry = vi.hoisted(() => ({
  instances: [] as unknown[],
  reset(): void {
    this.instances.length = 0;
  },
}));

vi.mock('../../../src/components/flipper', () => {
  class MockFlipper {
    public readonly onFlip = vi.fn((callback: () => void) => {
      this.flipCallbacks.add(callback);
    });

    public readonly removeOnFlip = vi.fn((callback: () => void) => {
      this.flipCallbacks.delete(callback);
    });

    public readonly activate = vi.fn((items?: HTMLElement[]) => {
      this.activated = true;
      this.lastActivatedWith = items;
    });

    public readonly deactivate = vi.fn(() => {
      this.activated = false;
    });

    public readonly focusFirst = vi.fn(() => {});

    public readonly focusItem = vi.fn((_position: number, _options?: { skipNextTab?: boolean }) => {});

    public readonly hasFocus = vi.fn(() => this.activated);

    public readonly getHandleContentEditableTargets = vi.fn(() => false);

    public lastActivatedWith: HTMLElement[] | undefined;

    private activated = false;

    private readonly flipCallbacks = new Set<() => void>();

    constructor(_options: unknown) {
      flipperRegistry.instances.push(this);
    }

    public get isActivated(): boolean {
      return this.activated;
    }

    public triggerFlip(): void {
      this.flipCallbacks.forEach(callback => callback());
    }
  }

  return {
    ['__esModule']: true,
    Flipper: MockFlipper,
  };
});

const searchInputRegistry = vi.hoisted(() => ({
  instances: [] as unknown[],
  reset(): void {
    this.instances.length = 0;
  },
}));

vi.mock('../../../src/components/utils/popover/components/search-input', async (importOriginal) => {
  // Import the real matchesSearchQuery so filterItems() works in tests
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion -- importOriginal returns unknown, assertion needed for property access
  const actual = await importOriginal() as { matchesSearchQuery: (item: unknown, query: string) => boolean };

  const SearchInputEvent = {
    Search: 'search' as const,
  };

  class MockSearchInput {
    public readonly on = vi.fn((event: string, handler: (payload: SearchPayload) => void) => {
      const handlers = this.handlers.get(event) ?? [];

      handlers.push(handler);
      this.handlers.set(event, handlers);
    });

    public readonly getElement = vi.fn(() => this.element);

    public readonly focus = vi.fn(() => {});

    public readonly clear = vi.fn(() => {});

    public readonly destroy = vi.fn(() => {});

    public readonly element: HTMLElement;

    public readonly items: unknown[];

    public readonly placeholder: string | undefined;

    private readonly handlers = new Map<string, Array<(payload: SearchPayload) => void>>();

    constructor({ items, placeholder }: { items: unknown[]; placeholder?: string }) {
      this.items = items;
      this.placeholder = placeholder;
      this.element = document.createElement('div');
      this.element.setAttribute('data-blok-testid', 'mock-search-input');

      searchInputRegistry.instances.push(this);
    }

    public emitSearch(payload: SearchPayload): void {
      this.handlers.get(SearchInputEvent.Search)?.forEach(handler => handler(payload));
    }
  }

  return {
    ['__esModule']: true,
    SearchInput: MockSearchInput,
    SearchInputEvent,
    matchesSearchQuery: actual.matchesSearchQuery,
  };
});

const getMockFlipper = (index = 0): MockFlipperShape => {
  return flipperRegistry.instances[index] as MockFlipperShape;
};

const getMockSearchInput = (index = 0): MockSearchInputShape => {
  return searchInputRegistry.instances[index] as MockSearchInputShape;
};

import { PopoverDesktop } from '../../../src/components/utils/popover/popover-desktop';
import { PopoverItemType } from '@/types/utils/popover/popover-item-type';
import type { PopoverParams } from '@/types/utils/popover/popover';
import { PopoverEvent } from '@/types/utils/popover/popover-event';
import { CSSVariables } from '../../../src/components/utils/popover/popover.const';
import { DATA_ATTR } from '../../../src/components/constants/data-attributes';
import { PopoverItemDefault, PopoverItemSeparator } from '../../../src/components/utils/popover/components/popover-item';
import { Flipper } from '../../../src/components/flipper';

type PopoverDesktopInternal = Omit<PopoverDesktop, 'shouldOpenBottom' | 'shouldOpenRight'> & {
  flippableElements: HTMLElement[];
  size: { height: number; width: number };
  setTriggerItemPosition: (nestedPopoverEl: HTMLElement, item: PopoverItemDefault) => void;
  showNestedPopoverForItem: (item: PopoverItemDefault) => PopoverDesktop;
  destroyNestedPopoverIfExists: () => void;
  handleHover: (event: Event) => void;
  readonly itemsDefault: PopoverItemDefault[];
  readonly items: Array<PopoverItemDefault | PopoverItemSeparator>;
  nodes: {
    popover: HTMLElement;
    popoverContainer: HTMLElement;
    items: HTMLElement;
    nothingFoundMessage: HTMLElement;
  };
  nestedPopover: PopoverDesktop | null | undefined;
  nestedPopoverTriggerItem: PopoverItemDefault | null;
};

const createRect = (overrides: Partial<DOMRect>): DOMRect => ({
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

const createDefaultItems = (): PopoverParams['items'] => [
  {
    title: 'First',
    name: 'first',
    onActivate: vi.fn(),
  },
  {
    title: 'Second',
    name: 'second',
    onActivate: vi.fn(),
  },
];

const createPopover = (params: Partial<PopoverParams> = {}): PopoverDesktop => {
  const scopeElement = params.scopeElement ?? document.createElement('div');

  document.body.appendChild(scopeElement);

  const popoverParams: PopoverParams = {
    items: params.items ?? createDefaultItems(),
    scopeElement,
    ...params,
  };

  return new PopoverDesktop(popoverParams);
};

let rafSpy: MockInstance<(callback: FrameRequestCallback) => number> | undefined;

beforeEach(() => {
  document.body.innerHTML = '';

  flipperRegistry.reset();
  searchInputRegistry.reset();

  if (typeof window.requestAnimationFrame !== 'function') {
    window.requestAnimationFrame = ((callback: FrameRequestCallback) => {
      callback(0);

      return 0;
    }) as typeof window.requestAnimationFrame;
  }

  rafSpy = vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback: FrameRequestCallback) => {
    callback(0);

    return 0;
  });
});

afterEach(() => {
  rafSpy?.mockRestore();
  vi.restoreAllMocks();
});

describe('PopoverDesktop', () => {
  describe('constructor', () => {
    it('adds nested class when instantiated with nesting level greater than zero', () => {
      const popover = createPopover({ nestingLevel: 1 });

      expect(popover.nestingLevel).toBe(1);
      expect(popover.getElement()).toHaveAttribute(DATA_ATTR.nested);
    });

    it('reuses provided flipper instance and attaches flip handler', () => {
      const reusableFlipper = new Flipper({});
      const popover = createPopover({ flipper: reusableFlipper });

      // Verify the popover uses the provided flipper instance
      expect((popover as unknown as PopoverDesktopInternal).flipper).toBe(reusableFlipper);

      // Verify flipper state reflects the attachment (deactivated initially, not activated)
      expect(reusableFlipper.isActivated).toBe(false);
    });
  });

  describe('accessors', () => {
    it('reflects flipper focus state when available', () => {
      const popover = createPopover();
      const flipper = getMockFlipper();

      expect(popover.hasFocus()).toBe(false);

      flipper.activate();

      expect(popover.hasFocus()).toBe(true);

      const nonFlippablePopover = createPopover({ flippable: false });

      expect(nonFlippablePopover.hasFocus()).toBe(false);
    });

    it('exposes scroll position of the items container', () => {
      const popover = createPopover();
      const instance = popover as unknown as PopoverDesktopInternal;

      instance.nodes.items.scrollTop = 24;

      expect(popover.scrollTop).toBe(24);

      instance.nodes.items = null as unknown as HTMLElement;

      expect(popover.scrollTop).toBe(0);
    });

    it('returns zero offset when popover container is missing', () => {
      const popover = createPopover();
      const instance = popover as unknown as PopoverDesktopInternal;
      const container = document.createElement('div');

      Object.defineProperty(container, 'offsetTop', {
        configurable: true,
        get: () => 120,
      });

      instance.nodes.popoverContainer = container;

      expect(popover.offsetTop).toBe(120);

      instance.nodes.popoverContainer = null as unknown as HTMLElement;

      expect(popover.offsetTop).toBe(0);
    });
  });

  describe('destroy', () => {
    it('hides popover and cleans up DOM when destroyed', () => {
      const popover = createPopover();

      // Show the popover first to verify hiding actually happens
      popover.show();

      expect(popover.getElement()).toHaveAttribute('data-blok-popover-opened');

      // Destroy should hide the popover and clean up
      popover.destroy();

      // Verify the popover is no longer visible
      expect(popover.getElement()).not.toHaveAttribute('data-blok-popover-opened');

      // Verify flipper is deactivated as part of cleanup
      const flipper = getMockFlipper();
      expect(flipper.deactivate).toHaveBeenCalled();
    });
  });

  describe('setTriggerItemPosition', () => {
    it('calculates trigger position relative to scroll offset', () => {
      const popover = createPopover();
      const instance = popover as unknown as PopoverDesktopInternal;
      const nestedElement = document.createElement('div');
      const triggerItem = instance.itemsDefault[0];
      const triggerElement = triggerItem.getElement();

      expect(triggerElement).not.toBeNull();

      if (triggerElement) {
        Object.defineProperty(triggerElement, 'offsetTop', {
          configurable: true,
          get: () => 75,
        });
      }

      instance.nodes.items.scrollTop = 25;

      Object.defineProperty(instance.nodes.popoverContainer, 'offsetTop', {
        configurable: true,
        get: () => 100,
      });

      instance.setTriggerItemPosition(nestedElement, triggerItem);

      expect(nestedElement.style.getPropertyValue(CSSVariables.TriggerItemTop)).toBe('150px');
    });
  });

  describe('position helpers', () => {
    it('determines when popover should stay below the trigger', () => {
      const scopeElement = document.createElement('div');
      const popover = createPopover({ scopeElement });
      const instance = popover as unknown as PopoverDesktopInternal;

      vi.spyOn(instance, 'size', 'get').mockReturnValue({ height: 150,
        width: 100 });
      vi.spyOn(instance.nodes.popoverContainer, 'getBoundingClientRect').mockReturnValue(
        createRect({ top: 50 })
      );
      vi.spyOn(scopeElement, 'getBoundingClientRect').mockReturnValue(
        createRect({ top: 40,
          bottom: 500 })
      );

      expect((instance as unknown as { shouldOpenBottom: boolean }).shouldOpenBottom).toBe(true);
    });

    it('opens upward when there is not enough space below', () => {
      const scopeElement = document.createElement('div');
      const popover = createPopover({ scopeElement });
      const instance = popover as unknown as PopoverDesktopInternal;

      vi.spyOn(instance, 'size', 'get').mockReturnValue({ height: 300,
        width: 100 });
      vi.spyOn(instance.nodes.popoverContainer, 'getBoundingClientRect').mockReturnValue(
        createRect({ top: 400 })
      );
      vi.spyOn(scopeElement, 'getBoundingClientRect').mockReturnValue(
        createRect({ top: 0,
          bottom: 600 })
      );

      const originalInnerHeight = window.innerHeight;

      Object.defineProperty(window, 'innerHeight', {
        configurable: true,
        value: 600,
        writable: true,
      });

      try {
        expect((instance as unknown as { shouldOpenBottom: boolean }).shouldOpenBottom).toBe(false);
      } finally {
        Object.defineProperty(window, 'innerHeight', {
          configurable: true,
          value: originalInnerHeight,
          writable: true,
        });
      }
    });

    it('chooses opening to the right when there is no space on the left', () => {
      const scopeElement = document.createElement('div');
      const popover = createPopover({ scopeElement });
      const instance = popover as unknown as PopoverDesktopInternal;

      vi.spyOn(instance, 'size', 'get').mockReturnValue({ height: 100,
        width: 200 });
      vi.spyOn(instance.nodes.popover, 'getBoundingClientRect').mockReturnValue(
        createRect({ left: 50,
          right: 150 })
      );
      vi.spyOn(scopeElement, 'getBoundingClientRect').mockReturnValue(
        createRect({ left: 0,
          right: 600 })
      );

      expect((instance as unknown as { shouldOpenRight: boolean }).shouldOpenRight).toBe(true);
    });

    it('opens to the left when the right side is constrained', () => {
      const scopeElement = document.createElement('div');
      const popover = createPopover({ scopeElement });
      const instance = popover as unknown as PopoverDesktopInternal;

      vi.spyOn(instance, 'size', 'get').mockReturnValue({ height: 100,
        width: 300 });
      vi.spyOn(instance.nodes.popover, 'getBoundingClientRect').mockReturnValue(
        createRect({ left: 400,
          right: 500 })
      );
      vi.spyOn(scopeElement, 'getBoundingClientRect').mockReturnValue(
        createRect({ left: 0,
          right: 650 })
      );

      const originalInnerWidth = window.innerWidth;

      Object.defineProperty(window, 'innerWidth', {
        configurable: true,
        value: 600,
        writable: true,
      });

      try {
        expect((instance as unknown as { shouldOpenRight: boolean }).shouldOpenRight).toBe(false);
      } finally {
        Object.defineProperty(window, 'innerWidth', {
          configurable: true,
          value: originalInnerWidth,
          writable: true,
        });
      }
    });
  });


  describe('flippableElements', () => {
    it('includes only enabled default items and wrapper element from HTML items', () => {
      const htmlElement = document.createElement('div');
      const htmlButton = document.createElement('button');
      const htmlInput = document.createElement('input');

      htmlElement.append(htmlButton, htmlInput);

      const popover = createPopover({
        items: [
          {
            title: 'Enabled',
            name: 'enabled',
            onActivate: vi.fn(),
          },
          {
            title: 'Disabled',
            name: 'disabled',
            onActivate: vi.fn(),
            isDisabled: true,
          },
          {
            type: PopoverItemType.Separator,
          },
          {
            type: PopoverItemType.Html,
            name: 'custom-html',
            element: htmlElement,
          },
        ],
      });
      const instance = popover as unknown as PopoverDesktopInternal;
      const defaultElement = instance.itemsDefault[0].getElement();

      expect(defaultElement).not.toBeNull();

      const elements = instance.flippableElements;

      // HTML items return their wrapper element (not inner controls) for keyboard navigation
      const htmlItemWrapper = instance.items.find(
        item => item.name === 'custom-html'
      )?.getElement();

      expect(htmlItemWrapper).not.toBeNull();

      if (defaultElement && htmlItemWrapper) {
        expect(elements).toEqual([defaultElement, htmlItemWrapper]);
      }
    });
  });

  describe('show', () => {
    it('applies position classes, sets height variable and activates flipper', () => {
      const popover = createPopover();
      const instance = popover as unknown as PopoverDesktopInternal;
      const sizeSpy = vi.spyOn(instance, 'size', 'get').mockReturnValue({
        height: 120,
        width: 80,
      });
      const openBottomSpy = vi.spyOn(instance as unknown as { readonly shouldOpenBottom: boolean }, 'shouldOpenBottom', 'get').mockReturnValue(false);
      const openRightSpy = vi.spyOn(instance as unknown as { readonly shouldOpenRight: boolean }, 'shouldOpenRight', 'get').mockReturnValue(false);

      popover.show();

      const flipper = getMockFlipper();
      const popoverElement = popover.getElement();

      expect(sizeSpy).toHaveBeenCalled();
      expect(openBottomSpy).toHaveBeenCalled();
      expect(openRightSpy).toHaveBeenCalled();
      expect(popoverElement).toHaveAttribute('data-blok-popover-opened');
      expect(popoverElement).toHaveAttribute(DATA_ATTR.popoverOpenTop);
      expect(popoverElement).toHaveAttribute(DATA_ATTR.popoverOpenLeft);
      expect(popoverElement.style.getPropertyValue(CSSVariables.PopoverHeight)).toBe('120px');
      expect(flipper.activate).toHaveBeenCalledWith(instance.flippableElements);
    });
  });

  describe('hide', () => {
    it('destroys nested popover, deactivates flipper and resets hover state', () => {
      const popover = createPopover({
        items: [
          {
            title: 'Parent',
            name: 'parent',
            children: {
              items: [
                {
                  title: 'Child',
                  name: 'child',
                  onActivate: vi.fn(),
                },
              ],
            },
          },
        ],
      });
      const instance = popover as unknown as PopoverDesktopInternal;
      const parentItem = instance.items.find(
        (item: PopoverItemDefault | PopoverItemSeparator): item is PopoverItemDefault => item instanceof PopoverItemDefault && item.hasChildren
      );

      expect(parentItem).toBeDefined();

      if (parentItem) {
        instance.showNestedPopoverForItem(parentItem);
      }

      expect(instance.nestedPopover).toBeInstanceOf(PopoverDesktop);
      expect(instance.nestedPopover?.getElement().hasAttribute(DATA_ATTR.nested)).toBe(true);

      popover.hide();

      const flipper = getMockFlipper();

      expect(popover.getElement()).not.toHaveAttribute('data-blok-popover-opened');
      expect(flipper.deactivate).toHaveBeenCalled();
      expect(instance.nestedPopover).toBeNull();
      expect(instance.nestedPopoverTriggerItem).toBeNull();
      expect(flipper.focusFirst).toHaveBeenCalled();
    });
  });

  describe('handleHover', () => {
    it('opens nested popover for hovered item with children and avoids reopening for the same item', () => {
      const popover = createPopover({
        items: [
          ...createDefaultItems(),
          {
            title: 'Parent',
            name: 'parent',
            children: {
              items: [
                {
                  title: 'Child',
                  name: 'child',
                  onActivate: vi.fn(),
                },
              ],
            },
          },
        ],
      });
      const instance = popover as unknown as PopoverDesktopInternal;
      const parentItem = instance.items.find(
        (item: PopoverItemDefault | PopoverItemSeparator): item is PopoverItemDefault => item instanceof PopoverItemDefault && item.hasChildren
      );
      const parentElement = parentItem?.getElement();

      expect(parentItem).toBeDefined();
      expect(parentElement).not.toBeNull();

      const destroyNestedSpy = vi.spyOn(instance, 'destroyNestedPopoverIfExists');
      const showNestedSpy = vi.spyOn(instance, 'showNestedPopoverForItem');

      const hoverEvent = {
        composedPath: () => parentElement ? [parentElement] : [],
      } as unknown as Event;

      instance.handleHover(hoverEvent);

      expect(destroyNestedSpy).toHaveBeenCalledTimes(1);
      expect(showNestedSpy).toHaveBeenCalledWith(parentItem);
      expect(instance.nestedPopover).toBeInstanceOf(PopoverDesktop);

      instance.handleHover(hoverEvent);

      expect(destroyNestedSpy).toHaveBeenCalledTimes(1);
      expect(showNestedSpy).toHaveBeenCalledTimes(1);
    });
  });

  describe('search', () => {
    it('filters items based on search results and updates flipper when active', () => {
      const popover = createPopover({
        searchable: true,
        items: [
          {
            title: 'Alpha',
            name: 'alpha',
            onActivate: vi.fn(),
          },
          {
            title: 'Beta',
            name: 'beta',
            onActivate: vi.fn(),
          },
          {
            type: PopoverItemType.Separator,
          },
          {
            title: 'Gamma',
            name: 'gamma',
            onActivate: vi.fn(),
          },
        ],
      });
      const instance = popover as unknown as PopoverDesktopInternal;

      popover.show();

      const flipper = getMockFlipper();
      const searchInput = getMockSearchInput();

      expect(searchInput).toBeDefined();

      const items = instance.items;
      const defaultItems = items.filter((item: PopoverItemDefault | PopoverItemSeparator): item is PopoverItemDefault => item instanceof PopoverItemDefault);
      const separator = items.find((item: PopoverItemDefault | PopoverItemSeparator): item is PopoverItemSeparator => item instanceof PopoverItemSeparator);

      searchInput.emitSearch({
        query: 'Beta',
        items: [ defaultItems[1] ],
      });

      expect(flipper.deactivate).toHaveBeenCalledTimes(1);
      expect(flipper.activate).toHaveBeenCalledTimes(2);
      expect(flipper.activate).toHaveBeenNthCalledWith(2, [ defaultItems[1].getElement() ]);

      expect(defaultItems[0].getElement()?.hasAttribute(DATA_ATTR.hidden)).toBe(true);
      expect(defaultItems[1].getElement()?.hasAttribute(DATA_ATTR.hidden)).toBe(false);
      expect(separator?.getElement().hasAttribute(DATA_ATTR.hidden)).toBe(true);
      expect(instance.nodes.nothingFoundMessage).not.toHaveAttribute(DATA_ATTR.nothingFoundDisplayed);

      searchInput.emitSearch({
        query: 'Zeta',
        items: [],
      });

      expect(instance.nodes.nothingFoundMessage).toHaveAttribute(DATA_ATTR.nothingFoundDisplayed);
      defaultItems.forEach((item: PopoverItemDefault) => {
        expect(item.getElement()?.hasAttribute(DATA_ATTR.hidden)).toBe(true);
      });
      expect(separator?.getElement().hasAttribute(DATA_ATTR.hidden)).toBe(true);
    });
  });

  describe('onFlip', () => {
    it('calls onFocus on focused popover items when flipper emits flip event', () => {
      const popover = createPopover();
      const instance = popover as unknown as PopoverDesktopInternal;

      popover.show();

      const flipper = getMockFlipper();
      const firstItem = instance.itemsDefault[0];
      const firstItemElement = firstItem.getElement();

      expect(firstItemElement).not.toBeNull();

      // Manually set the focused state to simulate what the real Flipper does
      firstItemElement?.setAttribute(DATA_ATTR.focused, 'true');

      // Track if onFocus was called by verifying side effects
      // onFocus() disables special hover and focus behavior
      firstItemElement?.setAttribute(DATA_ATTR.popoverItemNoHover, 'true');
      firstItemElement?.setAttribute(DATA_ATTR.popoverItemNoFocus, 'true');

      // Trigger flip event which should call onFocus on focused items
      flipper.triggerFlip();

      // Verify that onFocus was called - it removes the no-hover and no-focus attributes
      expect(firstItemElement?.hasAttribute(DATA_ATTR.popoverItemNoHover)).toBe(false);
      expect(firstItemElement?.hasAttribute(DATA_ATTR.popoverItemNoFocus)).toBe(false);
    });
  });

  describe('events', () => {
    it('emits ClosedOnActivate when nested popover closes due to child activation', () => {
      const popover = createPopover({
        items: [
          {
            title: 'Parent',
            name: 'parent',
            children: {
              items: [
                {
                  title: 'Child',
                  name: 'child',
                  onActivate: vi.fn(),
                },
              ],
            },
          },
        ],
      });
      const instance = popover as unknown as PopoverDesktopInternal;

      const parentItem = instance.items[0] as PopoverItemDefault;

      const nestedPopover = instance.showNestedPopoverForItem(parentItem);

      // Show parent popover to verify it gets hidden
      popover.show();
      expect(popover.getElement()).toHaveAttribute('data-blok-popover-opened');

      nestedPopover.emit(PopoverEvent.ClosedOnActivate, undefined);

      // Verify the parent popover is hidden after child emits ClosedOnActivate
      expect(popover.getElement()).not.toHaveAttribute('data-blok-popover-opened');
    });
  });

  describe('size cache invalidation', () => {
    it('recalculates size after item visibility changes via toggleItemHiddenByName', () => {
      const popover = createPopover({
        items: [
          {
            title: 'Keep',
            name: 'keep',
            onActivate: vi.fn(),
          },
          {
            title: 'Hideable',
            name: 'hideable',
            onActivate: vi.fn(),
          },
        ],
      });

      const instance = popover as unknown as PopoverDesktopInternal;

      popover.show();

      /** Access size to warm the cache */
      const sizeBeforeHide = instance.size;

      /** Hide an item — the cached size should be invalidated */
      popover.toggleItemHiddenByName('hideable', true);

      /** Access size again — should NOT return the stale cached value */
      const sizeAfterHide = instance.size;

      /**
       * In jsdom offsetHeight/offsetWidth are always 0, so we can't assert actual
       * dimension differences. Instead we verify the cache was invalidated by checking
       * that size is re-computed (the getter re-runs its clone-measure logic).
       * If the cache was NOT invalidated, both calls return the exact same object reference.
       */
      expect(sizeAfterHide).not.toBe(sizeBeforeHide);
    });
  });

  describe('permanently hidden items are not overridden by filterItems', () => {
    it('item hidden via toggleItemHiddenByName stays hidden after filterItems with empty query', () => {
      const popover = createPopover({
        items: [
          { title: 'Alpha', name: 'alpha', onActivate: vi.fn() },
          { title: 'Beta', name: 'beta', onActivate: vi.fn() },
        ],
      });
      const instance = popover as unknown as PopoverDesktopInternal;

      popover.show();

      // Permanently hide 'alpha' (simulating restricted tool in table cell)
      popover.toggleItemHiddenByName('alpha', true);

      // Filter with empty query – this used to un-hide all items
      popover.filterItems('');

      const alphaItem = instance.itemsDefault.find(item => item.name === 'alpha');
      const betaItem  = instance.itemsDefault.find(item => item.name === 'beta');

      expect(alphaItem?.getElement()?.hasAttribute(DATA_ATTR.hidden)).toBe(true);
      expect(betaItem?.getElement()?.hasAttribute(DATA_ATTR.hidden)).toBe(false);
    });

    it('item hidden via toggleItemHiddenByName stays hidden when filterItems query matches it', () => {
      const popover = createPopover({
        items: [
          { title: 'Heading 1', name: 'header-1', onActivate: vi.fn() },
          { title: 'Paragraph', name: 'paragraph', onActivate: vi.fn() },
        ],
        searchable: true,
      });
      const instance = popover as unknown as PopoverDesktopInternal;

      popover.show();

      // Permanently hide header-1
      popover.toggleItemHiddenByName('header-1', true);

      // Filter with 'Heading' which would normally match and show header-1
      const searchInput = getMockSearchInput();

      searchInput.emitSearch({
        query: 'Heading',
        items: [ instance.itemsDefault.find(item => item.name === 'header-1') ],
      });

      const headerItem = instance.itemsDefault.find(item => item.name === 'header-1');

      expect(headerItem?.getElement()?.hasAttribute(DATA_ATTR.hidden)).toBe(true);
    });

    it('item becomes visible again after toggleItemHiddenByName(name, false) is called', () => {
      const popover = createPopover({
        items: [
          { title: 'Alpha', name: 'alpha', onActivate: vi.fn() },
        ],
      });
      const instance = popover as unknown as PopoverDesktopInternal;

      popover.show();

      // Hide permanently
      popover.toggleItemHiddenByName('alpha', true);
      // Filter – should stay hidden
      popover.filterItems('');

      const alphaItem = instance.itemsDefault.find(item => item.name === 'alpha');

      expect(alphaItem?.getElement()?.hasAttribute(DATA_ATTR.hidden)).toBe(true);

      // Un-hide permanently
      popover.toggleItemHiddenByName('alpha', false);
      // Filter again – now it should be visible
      popover.filterItems('');

      expect(alphaItem?.getElement()?.hasAttribute(DATA_ATTR.hidden)).toBe(false);
    });
  });

  describe('nested popover trigger item refresh', () => {
    it('refreshes trigger item active state after click inside nested popover', () => {
      const isActiveFn = vi.fn(() => false);
      const swatchBtn = document.createElement('button');

      swatchBtn.setAttribute('data-blok-testid', 'color-swatch');

      const htmlContainer = document.createElement('div');

      htmlContainer.appendChild(swatchBtn);

      const popover = createPopover({
        items: [
          {
            title: 'Marker',
            name: 'marker',
            icon: '<svg></svg>',
            isActive: isActiveFn,
            children: {
              items: [
                {
                  type: PopoverItemType.Html,
                  element: htmlContainer,
                },
              ],
            },
          },
        ],
      });
      const instance = popover as unknown as PopoverDesktopInternal;
      const triggerItem = instance.itemsDefault[0];

      /**
       * showNestedItems sets nestedPopoverTriggerItem then calls showNestedPopoverForItem
       */
      instance.nestedPopoverTriggerItem = triggerItem;
      instance.showNestedPopoverForItem(triggerItem);

      expect(triggerItem.getElement()?.hasAttribute(DATA_ATTR.popoverItemActive)).toBe(false);

      /**
       * Simulate: after the swatch click handler runs, isActive returns true
       * (color was applied to the DOM by the tool's onColorSelect callback)
       */
      isActiveFn.mockReturnValue(true);

      swatchBtn.dispatchEvent(new Event('click', { bubbles: true }));

      expect(triggerItem.getElement()?.hasAttribute(DATA_ATTR.popoverItemActive)).toBe(true);

      /**
       * Simulate: default button clicked removes color, isActive returns false
       */
      isActiveFn.mockReturnValue(false);

      swatchBtn.dispatchEvent(new Event('click', { bubbles: true }));

      expect(triggerItem.getElement()?.hasAttribute(DATA_ATTR.popoverItemActive)).toBe(false);
    });
  });
});
