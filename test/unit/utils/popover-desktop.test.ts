import { describe, it, expect, beforeEach, afterEach, vi, type MockInstance } from 'vitest';

/* eslint-disable jsdoc/require-jsdoc */

type SearchPayload = { query: string; items: unknown[] };

type MockFlipperShape = {
  activate: ReturnType<typeof vi.fn>;
  deactivate: ReturnType<typeof vi.fn>;
  focusFirst: ReturnType<typeof vi.fn>;
  onFlip: ReturnType<typeof vi.fn>;
  removeOnFlip: ReturnType<typeof vi.fn>;
  triggerFlip: () => void;
  lastActivatedWith: HTMLElement[] | undefined;
  readonly isActivated: boolean;
  hasFocus: () => boolean;
};

type MockSearchInputShape = {
  on: ReturnType<typeof vi.fn>;
  getElement: ReturnType<typeof vi.fn>;
  focus: ReturnType<typeof vi.fn>;
  clear: ReturnType<typeof vi.fn>;
  destroy: ReturnType<typeof vi.fn>;
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

    public readonly hasFocus = vi.fn(() => this.activated);

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
    default: MockFlipper,
  };
});

const searchInputRegistry = vi.hoisted(() => ({
  instances: [] as unknown[],
  reset(): void {
    this.instances.length = 0;
  },
}));

vi.mock('../../../src/components/utils/popover/components/search-input', () => {
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
      this.element.className = 'mock-search-input';

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
import { css, CSSVariables } from '../../../src/components/utils/popover/popover.const';
import { css as popoverItemCss } from '../../../src/components/utils/popover/components/popover-item/popover-item-default/popover-item-default.const';
import { css as separatorCss } from '../../../src/components/utils/popover/components/popover-item/popover-item-separator/popover-item-separator.const';
import { PopoverItemDefault, PopoverItemSeparator } from '../../../src/components/utils/popover/components/popover-item';
import Flipper from '../../../src/components/flipper';

type PopoverDesktopInternal = PopoverDesktop & {
  flippableElements: HTMLElement[];
  size: { height: number; width: number };
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

let rafSpy: MockInstance<[FrameRequestCallback], number> | undefined;

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
      expect(popover.getElement().classList.contains(css.popoverNested)).toBe(true);
    });

    it('reuses provided flipper instance and attaches flip handler', () => {
      const reusableFlipper = new Flipper({});
      const removeOnFlipSpy = vi.spyOn(reusableFlipper, 'removeOnFlip');
      const deactivateSpy = vi.spyOn(reusableFlipper, 'deactivate');
      const onFlipSpy = vi.spyOn(reusableFlipper, 'onFlip');

      createPopover({ flipper: reusableFlipper });

      expect(deactivateSpy).toHaveBeenCalledTimes(1);
      expect(removeOnFlipSpy).toHaveBeenCalledTimes(1);
      expect(onFlipSpy).toHaveBeenCalledTimes(1);
    });
  });

  describe('show', () => {
    it('applies position classes, sets height variable and activates flipper', () => {
      const popover = createPopover();
      const instance = popover as PopoverDesktopInternal;
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
      expect(popoverElement.classList.contains(css.popoverOpened)).toBe(true);
      expect(popoverElement.classList.contains(css.popoverOpenTop)).toBe(true);
      expect(popoverElement.classList.contains(css.popoverOpenLeft)).toBe(true);
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
      const instance = popover as PopoverDesktopInternal;
      const parentItem = instance.items.find(
        (item): item is PopoverItemDefault => item instanceof PopoverItemDefault && item.hasChildren
      );

      expect(parentItem).toBeDefined();

      instance.showNestedPopoverForItem(parentItem!);
      const nestedPopoverElement = popover.getElement().querySelector(`.${css.popoverNested}`);

      expect(nestedPopoverElement).toBeTruthy();

      popover.hide();

      const flipper = getMockFlipper();

      expect(popover.getElement().hasAttribute('data-popover-opened')).toBe(false);
      expect(flipper.deactivate).toHaveBeenCalled();
      expect(popover.getElement().querySelector(`.${css.popoverNested}`)).toBeNull();
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
      const instance = popover as PopoverDesktopInternal;
      const parentItem = instance.items.find(
        (item): item is PopoverItemDefault => item instanceof PopoverItemDefault && item.hasChildren
      );
      const parentElement = parentItem?.getElement();

      expect(parentItem).toBeDefined();
      expect(parentElement).not.toBeNull();

      const destroyNestedSpy = vi.spyOn(instance, 'destroyNestedPopoverIfExists');
      const showNestedSpy = vi.spyOn(instance, 'showNestedPopoverForItem');

      const hoverEvent = {
        composedPath: () => [ parentElement! ],
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
      const instance = popover as PopoverDesktopInternal;

      popover.show();

      const flipper = getMockFlipper();
      const searchInput = getMockSearchInput();

      expect(searchInput).toBeDefined();

      const items = instance.items;
      const defaultItems = items.filter((item): item is PopoverItemDefault => item instanceof PopoverItemDefault);
      const separator = items.find((item): item is PopoverItemSeparator => item instanceof PopoverItemSeparator);

      searchInput.emitSearch({
        query: 'Beta',
        items: [ defaultItems[1] ],
      });

      expect(flipper.deactivate).toHaveBeenCalledTimes(1);
      expect(flipper.activate).toHaveBeenCalledTimes(2);
      expect(flipper.activate).toHaveBeenNthCalledWith(2, [ defaultItems[1].getElement() ]);

      expect(defaultItems[0].getElement()?.classList.contains(popoverItemCss.hidden)).toBe(true);
      expect(defaultItems[1].getElement()?.classList.contains(popoverItemCss.hidden)).toBe(false);
      expect(separator?.getElement().classList.contains(separatorCss.hidden)).toBe(true);
      expect(instance.nodes.nothingFoundMessage.classList.contains(css.nothingFoundMessageDisplayed)).toBe(false);

      searchInput.emitSearch({
        query: 'Zeta',
        items: [],
      });

      expect(instance.nodes.nothingFoundMessage.classList.contains(css.nothingFoundMessageDisplayed)).toBe(true);
      defaultItems.forEach(item => {
        expect(item.getElement()?.classList.contains(popoverItemCss.hidden)).toBe(true);
      });
      expect(separator?.getElement().classList.contains(separatorCss.hidden)).toBe(true);
    });
  });

  describe('onFlip', () => {
    it('focuses popover items when flipper emits flip event', () => {
      const popover = createPopover();
      const instance = popover as PopoverDesktopInternal;

      popover.show();

      const flipper = getMockFlipper();
      const firstItem = instance.itemsDefault[0];
      const focusSpy = vi.spyOn(firstItem, 'onFocus');

      vi.spyOn(firstItem, 'isFocused', 'get').mockReturnValue(true);

      flipper.triggerFlip();

      expect(focusSpy).toHaveBeenCalled();
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
      const instance = popover as PopoverDesktopInternal;
      const hideSpy = vi.spyOn(popover, 'hide');

      const parentItem = instance.items[0] as PopoverItemDefault;

      const nestedPopover = instance.showNestedPopoverForItem(parentItem);

      nestedPopover.emit(PopoverEvent.ClosedOnActivate, undefined);

      expect(hideSpy).toHaveBeenCalled();
    });
  });
});

