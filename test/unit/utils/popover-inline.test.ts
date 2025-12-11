import { describe, it, expect, beforeEach, vi } from 'vitest';
import { PopoverInline } from '../../../src/components/utils/popover/popover-inline';
import { PopoverDesktop } from '../../../src/components/utils/popover/popover-desktop';
import { PopoverItemDefault, PopoverItemType } from '../../../src/components/utils/popover/components/popover-item';
import type { PopoverItemHtml } from '../../../src/components/utils/popover/components/popover-item/popover-item-html/popover-item-html';
import { CSSVariables, DATA_ATTR, getNestedLevelAttrValue } from '../../../src/components/utils/popover/popover.const';
import type { PopoverParams } from '@/types/utils/popover/popover';
import Flipper from '../../../src/components/flipper';

// Mock dependencies
vi.mock('../../../src/components/utils/popover/popover-desktop');
vi.mock('../../../src/components/utils', async () => {
  const actual = await vi.importActual('../../../src/components/utils');

  return {
    ...actual,
    isMobileScreen: vi.fn(() => false),
  };
});
vi.mock('../../../src/components/flipper');

describe('PopoverInline', () => {

  const OFFSET_LEFT_VALUE = 50;
  const ITEM_OFFSET_LEFT_VALUE = 30;

  interface MockPopoverDesktop {
    getElement: ReturnType<typeof vi.fn>;
    nodes: {
      popover: HTMLElement;
      popoverContainer: HTMLElement | null;
      items: HTMLElement | null;
      nothingFoundMessage: HTMLElement;
    };
    items: Array<PopoverItemDefault | PopoverItemHtml>;
    flipper: Flipper | undefined;
    nestingLevel: number;
    nestedPopover: PopoverDesktop | undefined | null;
    nestedPopoverTriggerItem: PopoverItemDefault | PopoverItemHtml | null;
  }

  interface MockFlipper {
    activate: ReturnType<typeof vi.fn>;
    deactivate: ReturnType<typeof vi.fn>;
    focusFirst: ReturnType<typeof vi.fn>;
    hasFocus: ReturnType<typeof vi.fn>;
    setHandleContentEditableTargets: ReturnType<typeof vi.fn>;
  }

  interface MockPopoverDesktopSuperMethods {
    show: ReturnType<typeof vi.fn>;
    hide: ReturnType<typeof vi.fn>;
    destroy: ReturnType<typeof vi.fn>;
    showNestedItems: ReturnType<typeof vi.fn>;
    destroyNestedPopoverIfExists: ReturnType<typeof vi.fn>;
    handleItemClick: ReturnType<typeof vi.fn>;
    setTriggerItemPosition: ReturnType<typeof vi.fn>;
    showNestedPopoverForItem: ReturnType<typeof vi.fn>;
  }

  // Container object to hold mocks, avoiding reassignment
  const mocks = {
    mockPopoverDesktop: undefined as unknown as MockPopoverDesktop,
    mockFlipper: undefined as unknown as MockFlipper,
    mockPopoverParams: undefined as unknown as PopoverParams,
    popoverInline: undefined as unknown as PopoverInline,
    superMethods: undefined as unknown as MockPopoverDesktopSuperMethods,
  };

  const createMockDefaultItem = (overrides: Partial<PopoverItemDefault> = {}): PopoverItemDefault => {
    const baseItem = {
      hasChildren: false,
      isChildrenOpen: false,
      getElement: vi.fn(() => document.createElement('div')),
      handleClick: vi.fn(),
      onChildrenClose: vi.fn(),
    };

    const item = {
      ...baseItem,
      ...overrides,
    } as unknown as PopoverItemDefault;

    Object.setPrototypeOf(item, PopoverItemDefault.prototype);

    return item;
  };

  beforeEach(() => {
    vi.clearAllMocks();

    // Create mock DOM elements
    const popoverContainer = document.createElement('div');

    popoverContainer.style.position = 'relative';
    popoverContainer.style.width = '200px';
    popoverContainer.style.height = '100px';
    Object.defineProperty(popoverContainer, 'offsetLeft', {
      value: OFFSET_LEFT_VALUE,
      writable: true,
      configurable: true,
    });

    const popover = document.createElement('div');

    popover.appendChild(popoverContainer);

    const items = document.createElement('div');
    const nothingFoundMessage = document.createElement('div');

    // Create mock flipper
    mocks.mockFlipper = {
      activate: vi.fn() as unknown as ReturnType<typeof vi.fn>,
      deactivate: vi.fn() as unknown as ReturnType<typeof vi.fn>,
      focusFirst: vi.fn() as unknown as ReturnType<typeof vi.fn>,
      hasFocus: vi.fn(() => false) as unknown as ReturnType<typeof vi.fn>,
      setHandleContentEditableTargets: vi.fn() as unknown as ReturnType<typeof vi.fn>,
    };

    // Create mock items
    const mockItem1 = createMockDefaultItem();
    const mockItem2 = createMockDefaultItem({
      hasChildren: true,
    });

    const createNestedPopoverMock = (): PopoverDesktop => ({
      getElement: () => document.createElement('div'),
      nestingLevel: 1,
      flipper: {
        setHandleContentEditableTargets: vi.fn(),
        activate: vi.fn(),
        deactivate: vi.fn(),
        focusFirst: vi.fn(),
        focusItem: vi.fn(),
      },
      on: vi.fn(),
    } as unknown as PopoverDesktop);

    mocks.superMethods = {
      show: vi.fn() as unknown as ReturnType<typeof vi.fn>,
      hide: vi.fn() as unknown as ReturnType<typeof vi.fn>,
      destroy: vi.fn() as unknown as ReturnType<typeof vi.fn>,
      showNestedItems: vi.fn() as unknown as ReturnType<typeof vi.fn>,
      destroyNestedPopoverIfExists: vi.fn() as unknown as ReturnType<typeof vi.fn>,
      handleItemClick: vi.fn() as unknown as ReturnType<typeof vi.fn>,
      setTriggerItemPosition: vi.fn() as unknown as ReturnType<typeof vi.fn>,
      showNestedPopoverForItem: vi.fn(createNestedPopoverMock) as unknown as ReturnType<typeof vi.fn>,
    };

    Object.assign(PopoverDesktop.prototype, mocks.superMethods);

    // Setup mock PopoverDesktop
    mocks.mockPopoverDesktop = Object.assign(Object.create(PopoverInline.prototype), {
      getElement: vi.fn(() => popover) as unknown as ReturnType<typeof vi.fn>,
      nodes: {
        popover,
        popoverContainer,
        items,
        nothingFoundMessage,
      },
      items: [mockItem1, mockItem2],
      flipper: mocks.mockFlipper as unknown as Flipper,
      nestingLevel: 0,
      nestedPopover: undefined,
      nestedPopoverTriggerItem: null,
    }) as unknown as MockPopoverDesktop;

    Object.defineProperty(mocks.mockPopoverDesktop, 'flippableElements', {
      configurable: true,
      get: () => [],
    });

    // Mock PopoverDesktop constructor - use function syntax for Vitest 4.x compatibility
    vi.mocked(PopoverDesktop).mockImplementation(function () {
      const instance = this as unknown as MockPopoverDesktop & MockPopoverDesktopSuperMethods;

      // Copy all properties from mockPopoverDesktop to this instance
      instance.nodes = mocks.mockPopoverDesktop.nodes;
      instance.items = mocks.mockPopoverDesktop.items;
      instance.flipper = mocks.mockFlipper as unknown as Flipper;
      instance.nestingLevel = mocks.mockPopoverDesktop.nestingLevel;
      instance.nestedPopover = mocks.mockPopoverDesktop.nestedPopover as unknown as PopoverDesktop | undefined | null;
      instance.nestedPopoverTriggerItem = mocks.mockPopoverDesktop.nestedPopoverTriggerItem;
      instance.getElement = mocks.mockPopoverDesktop.getElement;

      // Delete auto-mocked methods from instance so that PopoverInline prototype methods are used
      // The super methods are on PopoverDesktop.prototype via Object.assign above
      delete (instance as unknown as Record<string, unknown>).show;
      delete (instance as unknown as Record<string, unknown>).hide;
      delete (instance as unknown as Record<string, unknown>).destroy;
      delete (instance as unknown as Record<string, unknown>).showNestedItems;
      delete (instance as unknown as Record<string, unknown>).destroyNestedPopoverIfExists;
      delete (instance as unknown as Record<string, unknown>).handleItemClick;
      delete (instance as unknown as Record<string, unknown>).setTriggerItemPosition;
      delete (instance as unknown as Record<string, unknown>).showNestedPopoverForItem;
      delete (instance as unknown as Record<string, unknown>).handleHover;

      return instance as unknown as PopoverDesktop;
    });

    // Mock Flipper constructor - use function syntax for Vitest 4.x compatibility
    vi.mocked(Flipper).mockImplementation(function () {
      const instance = this as unknown as MockFlipper;

      instance.activate = mocks.mockFlipper.activate;
      instance.deactivate = mocks.mockFlipper.deactivate;
      instance.focusFirst = mocks.mockFlipper.focusFirst;
      instance.hasFocus = mocks.mockFlipper.hasFocus;
      instance.setHandleContentEditableTargets = mocks.mockFlipper.setHandleContentEditableTargets;

      return instance as unknown as Flipper;
    });

    mocks.mockPopoverParams = {
      items: [
        {
          icon: 'Icon',
          title: 'Test Item',
          name: 'test-item',
          onActivate: vi.fn(),
        },
      ],
    };
  });

  describe('constructor', () => {
    it('should call super with inline class and button wrapper tag', () => {
      mocks.popoverInline = new PopoverInline(mocks.mockPopoverParams);

      expect(PopoverDesktop).toHaveBeenCalledWith(
        {
          ...mocks.mockPopoverParams,
          flipper: expect.any(Object),
        },
        {
          [PopoverItemType.Default]: {
            wrapperTag: 'button',
            hint: {
              position: 'top',
              alignment: 'center',
              enabled: true,
            },
            iconWithGap: false,
            isInline: true,
          },
          [PopoverItemType.Html]: {
            hint: {
              position: 'top',
              alignment: 'center',
              enabled: true,
            },
            isInline: true,
          },
          [PopoverItemType.Separator]: {
            isInline: true,
          },
        }
      );
    });

    it('should disable hints on mobile screens', async () => {
      const { isMobileScreen } = await import('../../../src/components/utils');

      vi.mocked(isMobileScreen).mockReturnValue(true);

      mocks.popoverInline = new PopoverInline(mocks.mockPopoverParams);

      expect(PopoverDesktop).toHaveBeenCalledWith(
        expect.any(Object),
        expect.objectContaining({
          [PopoverItemType.Default]: expect.objectContaining({
            hint: expect.objectContaining({
              enabled: false,
            }),
          }),
          [PopoverItemType.Html]: expect.objectContaining({
            hint: expect.objectContaining({
              enabled: false,
            }),
          }),
        })
      );
    });

    it('should show nested items for items with hasChildren and isChildrenOpen set to true', () => {
      const itemWithOpenChildren = createMockDefaultItem({
        hasChildren: true,
        isChildrenOpen: true,
      });

      mocks.mockPopoverDesktop.items = [
        itemWithOpenChildren,
        createMockDefaultItem({
          hasChildren: false,
          isChildrenOpen: false,
        }),
      ];

      // Spy on PopoverInline.prototype.showNestedItems to verify it's called with the right item
      const showNestedItemsSpy = vi.spyOn(PopoverInline.prototype as unknown as { showNestedItems: (item: PopoverItemDefault) => void }, 'showNestedItems');

      mocks.popoverInline = new PopoverInline(mocks.mockPopoverParams);

      // Verify showNestedItems was called with the item that has children open
      expect(showNestedItemsSpy).toHaveBeenCalledWith(itemWithOpenChildren);
      // Verify it was called only once (for the item with hasChildren and isChildrenOpen)
      expect(showNestedItemsSpy).toHaveBeenCalledTimes(1);

      showNestedItemsSpy.mockRestore();
    });

    it('should not show nested items for items without children', () => {
      const itemWithoutChildren = createMockDefaultItem({
        hasChildren: false,
        isChildrenOpen: false,
      });

      mocks.mockPopoverDesktop.items = [ itemWithoutChildren ];

      // Spy on PopoverInline.prototype.showNestedItems
      const showNestedItemsSpy = vi.spyOn(PopoverInline.prototype as unknown as { showNestedItems: (item: PopoverItemDefault) => void }, 'showNestedItems');

      mocks.popoverInline = new PopoverInline(mocks.mockPopoverParams);

      // showNestedItems should not be called for items without children
      expect(showNestedItemsSpy).not.toHaveBeenCalled();

      showNestedItemsSpy.mockRestore();
    });

    it('should skip non-default and non-html items when checking for nested items', () => {
      const separatorItem = {
        getElement: vi.fn(() => document.createElement('div')),
      };

      const itemWithOpenChildren = createMockDefaultItem({
        hasChildren: true,
        isChildrenOpen: true,
      });

      mocks.mockPopoverDesktop.items = [separatorItem, itemWithOpenChildren] as unknown as Array<PopoverItemDefault | PopoverItemHtml>;

      // Spy on PopoverInline.prototype.showNestedItems
      const showNestedItemsSpy = vi.spyOn(PopoverInline.prototype as unknown as { showNestedItems: (item: PopoverItemDefault) => void }, 'showNestedItems');

      mocks.popoverInline = new PopoverInline(mocks.mockPopoverParams);

      // Should only call showNestedItems for PopoverItemDefault/PopoverItemHtml, not separator
      expect(showNestedItemsSpy).toHaveBeenCalledTimes(1);
      expect(showNestedItemsSpy).toHaveBeenCalledWith(itemWithOpenChildren);

      showNestedItemsSpy.mockRestore();
    });
  });

  describe('offsetLeft', () => {
    it('should return offsetLeft of popoverContainer when container exists', () => {
      mocks.popoverInline = new PopoverInline(mocks.mockPopoverParams);

      expect(mocks.popoverInline.offsetLeft).toBe(OFFSET_LEFT_VALUE);
    });

    it('should return 0 when popoverContainer is null', () => {
      mocks.mockPopoverDesktop.nodes.popoverContainer = null;

      mocks.popoverInline = new PopoverInline(mocks.mockPopoverParams);

      expect(mocks.popoverInline.offsetLeft).toBe(0);
    });
  });

  describe('show', () => {
    beforeEach(() => {
      mocks.popoverInline = new PopoverInline(mocks.mockPopoverParams);
    });

    it('should call the show method on PopoverInline', () => {
      // Spy on PopoverInline.prototype.show to verify it's callable
      const showSpy = vi.spyOn(PopoverInline.prototype, 'show');

      // Delete the mock 'show' from the instance so that PopoverInline.prototype.show is used
      delete (mocks.popoverInline as unknown as Record<string, unknown>).show;

      mocks.popoverInline.show();

      expect(showSpy).toHaveBeenCalled();

      showSpy.mockRestore();
    });

    it('should set width and height CSS variables when nestingLevel is 0', () => {
      const containerRect = {
        width: 200,
        height: 100,
      };

      vi.spyOn(mocks.mockPopoverDesktop.nodes.popoverContainer!, 'getBoundingClientRect').mockReturnValue(containerRect as DOMRect);

      // Set nestingLevel on the actual instance
      Object.defineProperty(mocks.popoverInline, 'nestingLevel', {
        value: 0,
        writable: true,
        configurable: true,
      });

      // Delete the mock 'show' from the instance so that PopoverInline.prototype.show is used
      delete (mocks.popoverInline as unknown as Record<string, unknown>).show;

      mocks.popoverInline.show();

      expect(mocks.mockPopoverDesktop.nodes.popover.style.getPropertyValue(CSSVariables.InlinePopoverWidth)).toBe('200px');
      expect(mocks.mockPopoverDesktop.nodes.popover.style.width).toBe('200px');
      expect(mocks.mockPopoverDesktop.nodes.popover.style.height).toBe('100px');
    });

    it('should not set width/height CSS variables when nestingLevel is not 0', () => {
      // Set nestingLevel on the actual instance
      Object.defineProperty(mocks.popoverInline, 'nestingLevel', {
        value: 1,
        writable: true,
        configurable: true,
      });

      mocks.popoverInline.show();

      expect(mocks.mockPopoverDesktop.nodes.popover.style.getPropertyValue(CSSVariables.InlinePopoverWidth)).toBe('');
    });

    it('should handle undefined containerRect gracefully', () => {
      mocks.mockPopoverDesktop.nestingLevel = 0;
      mocks.mockPopoverDesktop.nodes.popoverContainer = null;

      // Should not throw
      expect(() => mocks.popoverInline.show()).not.toThrow();
    });

    it('should deactivate and activate flipper with flippableElements', async () => {
      vi.useFakeTimers();

      const flippableElements = [ document.createElement('button') ];

      // Access private property to set flippableElements
      Object.defineProperty(mocks.popoverInline, 'flippableElements', {
        get: () => flippableElements,
        configurable: true,
      });

      // Delete the mock 'show' from the instance so that PopoverInline.prototype.show is used
      delete (mocks.popoverInline as unknown as Record<string, unknown>).show;

      mocks.popoverInline.show();

      // Advance the timer to trigger requestAnimationFrame callback
      vi.advanceTimersToNextFrame();

      expect(mocks.mockFlipper.deactivate).toHaveBeenCalled();
      expect(mocks.mockFlipper.activate).toHaveBeenCalledWith(flippableElements);

      vi.useRealTimers();
    });
  });

  describe('handleHover', () => {
    beforeEach(() => {
      mocks.popoverInline = new PopoverInline(mocks.mockPopoverParams);
    });

    it('should return early without doing anything', () => {
      const result = (mocks.popoverInline as unknown as { handleHover: () => void }).handleHover();

      expect(result).toBeUndefined();
      // Should not call any parent methods
      expect(mocks.superMethods.showNestedItems).not.toHaveBeenCalled();
    });
  });

  describe('setTriggerItemPosition', () => {
    beforeEach(() => {
      mocks.popoverInline = new PopoverInline(mocks.mockPopoverParams);
    });

    it('should set CSS variable with correct left offset', () => {
      const nestedPopoverEl = document.createElement('div');
      const itemEl = document.createElement('div');

      Object.defineProperty(itemEl, 'offsetLeft', {
        value: ITEM_OFFSET_LEFT_VALUE,
        writable: true,
        configurable: true,
      });

      const item = createMockDefaultItem({
        getElement: vi.fn(() => itemEl),
      });

      const expectedOffset = OFFSET_LEFT_VALUE + ITEM_OFFSET_LEFT_VALUE;

      // Ensure offsetLeft property is accessible on the instance
      Object.defineProperty(mocks.popoverInline, 'offsetLeft', {
        get: () => OFFSET_LEFT_VALUE,
        configurable: true,
      });

      // Delete the mock 'setTriggerItemPosition' from the instance so that PopoverInline.prototype.setTriggerItemPosition is used
      delete (mocks.popoverInline as unknown as Record<string, unknown>).setTriggerItemPosition;

      (mocks.popoverInline as unknown as { setTriggerItemPosition: (el: HTMLElement, item: PopoverItemDefault) => void })
        .setTriggerItemPosition(nestedPopoverEl, item);

      expect(nestedPopoverEl.style.getPropertyValue(CSSVariables.TriggerItemLeft)).toBe(`${expectedOffset}px`);
    });

    it('should handle null item element', () => {
      const nestedPopoverEl = document.createElement('div');

      const item = createMockDefaultItem({
        getElement: vi.fn(() => null),
      });

      // Ensure offsetLeft property is accessible on the instance
      Object.defineProperty(mocks.popoverInline, 'offsetLeft', {
        get: () => OFFSET_LEFT_VALUE,
        configurable: true,
      });

      // Delete the mock 'setTriggerItemPosition' from the instance so that PopoverInline.prototype.setTriggerItemPosition is used
      delete (mocks.popoverInline as unknown as Record<string, unknown>).setTriggerItemPosition;

      (mocks.popoverInline as unknown as { setTriggerItemPosition: (el: HTMLElement, item: PopoverItemDefault) => void })
        .setTriggerItemPosition(nestedPopoverEl, item);

      expect(nestedPopoverEl.style.getPropertyValue(CSSVariables.TriggerItemLeft)).toBe(`${OFFSET_LEFT_VALUE}px`);
    });

    it('should handle null popoverContainer', () => {
      const nestedPopoverEl = document.createElement('div');
      const itemEl = document.createElement('div');

      Object.defineProperty(itemEl, 'offsetLeft', {
        value: ITEM_OFFSET_LEFT_VALUE,
        writable: true,
        configurable: true,
      });

      const item = createMockDefaultItem({
        getElement: vi.fn(() => itemEl),
      });

      mocks.mockPopoverDesktop.nodes.popoverContainer = null;

      // When popoverContainer is null, offsetLeft returns 0
      Object.defineProperty(mocks.popoverInline, 'offsetLeft', {
        get: () => 0,
        configurable: true,
      });

      // Delete the mock 'setTriggerItemPosition' from the instance so that PopoverInline.prototype.setTriggerItemPosition is used
      delete (mocks.popoverInline as unknown as Record<string, unknown>).setTriggerItemPosition;

      (mocks.popoverInline as unknown as { setTriggerItemPosition: (el: HTMLElement, item: PopoverItemDefault) => void })
        .setTriggerItemPosition(nestedPopoverEl, item);

      expect(nestedPopoverEl.style.getPropertyValue(CSSVariables.TriggerItemLeft)).toBe(`${ITEM_OFFSET_LEFT_VALUE}px`);
    });
  });

  describe('showNestedItems', () => {
    beforeEach(() => {
      mocks.popoverInline = new PopoverInline(mocks.mockPopoverParams);
    });

    it('should close nested popover if same item is clicked again', () => {
      const item = createMockDefaultItem({
        hasChildren: true,
      });

      // Set nestedPopoverTriggerItem on the actual instance
      (mocks.popoverInline as unknown as { nestedPopoverTriggerItem: PopoverItemDefault | null }).nestedPopoverTriggerItem = item;

      // Delete the mock 'showNestedItems' from the instance so that PopoverInline.prototype.showNestedItems is used
      delete (mocks.popoverInline as unknown as Record<string, unknown>).showNestedItems;

      (mocks.popoverInline as unknown as { showNestedItems: (item: PopoverItemDefault) => void }).showNestedItems(item);

      expect(mocks.superMethods.destroyNestedPopoverIfExists).toHaveBeenCalled();
      expect((mocks.popoverInline as unknown as { nestedPopoverTriggerItem: PopoverItemDefault | null }).nestedPopoverTriggerItem).toBeNull();
      expect(mocks.superMethods.showNestedItems).not.toHaveBeenCalled();
    });

    it('should show nested popover for different item', () => {
      const item1 = createMockDefaultItem({
        hasChildren: true,
      });

      const item2 = createMockDefaultItem({
        hasChildren: true,
      });

      // Set nestedPopoverTriggerItem on the actual instance
      (mocks.popoverInline as unknown as { nestedPopoverTriggerItem: PopoverItemDefault | null }).nestedPopoverTriggerItem = item1;

      // Delete the mock 'showNestedItems' from the instance so that PopoverInline.prototype.showNestedItems is used
      delete (mocks.popoverInline as unknown as Record<string, unknown>).showNestedItems;

      (mocks.popoverInline as unknown as { showNestedItems: (item: PopoverItemDefault) => void }).showNestedItems(item2);

      expect(mocks.superMethods.destroyNestedPopoverIfExists).not.toHaveBeenCalled();
      expect(mocks.superMethods.showNestedItems).toHaveBeenCalledWith(item2);
    });

    it('should show nested popover when no nested popover exists', () => {
      const item = createMockDefaultItem({
        hasChildren: true,
      });

      // Set nestedPopoverTriggerItem on the actual instance
      (mocks.popoverInline as unknown as { nestedPopoverTriggerItem: PopoverItemDefault | null }).nestedPopoverTriggerItem = null;

      // Delete the mock 'showNestedItems' from the instance so that PopoverInline.prototype.showNestedItems is used
      delete (mocks.popoverInline as unknown as Record<string, unknown>).showNestedItems;

      (mocks.popoverInline as unknown as { showNestedItems: (item: PopoverItemDefault) => void }).showNestedItems(item);

      expect(mocks.superMethods.showNestedItems).toHaveBeenCalledWith(item);
    });
  });

  describe('showNestedPopoverForItem', () => {
    beforeEach(() => {
      mocks.popoverInline = new PopoverInline(mocks.mockPopoverParams);
    });

    it('should add nested level class to nested popover element', () => {
      const item = createMockDefaultItem({
        hasChildren: true,
        children: [],
        isChildrenSearchable: false,
        isChildrenFlippable: true,
        getElement: vi.fn(() => document.createElement('div')),
        onChildrenOpen: vi.fn(),
        onChildrenClose: vi.fn(),
      });

      const nestedPopoverEl = document.createElement('div');
      const nestedPopover = {
        getElement: vi.fn(() => nestedPopoverEl),
        nestingLevel: 1,
        on: vi.fn(),
        flipper: {
          setHandleContentEditableTargets: vi.fn(),
          activate: vi.fn(),
          deactivate: vi.fn(),
          focusFirst: vi.fn(),
          focusItem: vi.fn(),
        },
      } as unknown as PopoverDesktop;

      mocks.superMethods.showNestedPopoverForItem.mockReturnValue(nestedPopover);

      // Delete the mock 'showNestedPopoverForItem' from the instance so that PopoverInline.prototype.showNestedPopoverForItem is used
      delete (mocks.popoverInline as unknown as Record<string, unknown>).showNestedPopoverForItem;

      const result = (mocks.popoverInline as unknown as { showNestedPopoverForItem: (item: PopoverItemDefault) => PopoverDesktop })
        .showNestedPopoverForItem(item);

      expect(result).toBe(nestedPopover);
      // Verify nested level data attribute was applied - this tests CSS positioning behavior
      expect(nestedPopoverEl.hasAttribute(DATA_ATTR.nestedLevel)).toBe(true);
      expect(nestedPopoverEl.getAttribute(DATA_ATTR.nestedLevel)).toBe(getNestedLevelAttrValue(1));
    });

    it('should enable flipper to handle contenteditable targets for nested popover', () => {
      const nestedPopoverEl = document.createElement('div');
      const nestedPopoverFlipper = {
        setHandleContentEditableTargets: vi.fn(),
        activate: vi.fn(),
        deactivate: vi.fn(),
        focusFirst: vi.fn(),
        focusItem: vi.fn(),
      };

      const onMock = vi.fn();
      const nestedPopover = {
        getElement: vi.fn(() => nestedPopoverEl),
        nestingLevel: 1,
        on: onMock,
        flipper: nestedPopoverFlipper,
      } as unknown as PopoverDesktop;

      mocks.superMethods.showNestedPopoverForItem.mockReturnValue(nestedPopover);

      // Delete the mock 'showNestedPopoverForItem' from the instance so that PopoverInline.prototype.showNestedPopoverForItem is used
      delete (mocks.popoverInline as unknown as Record<string, unknown>).showNestedPopoverForItem;

      const item = createMockDefaultItem({
        hasChildren: true,
        getElement: vi.fn(() => document.createElement('div')),
      });

      (mocks.popoverInline as unknown as { showNestedPopoverForItem: (item: PopoverItemDefault) => PopoverDesktop })
        .showNestedPopoverForItem(item);

      // Verify that flipper is configured to handle contenteditable targets
      expect(nestedPopoverFlipper.setHandleContentEditableTargets).toHaveBeenCalledWith(true);
    });
  });

  describe('handleItemClick', () => {
    beforeEach(() => {
      mocks.popoverInline = new PopoverInline(mocks.mockPopoverParams);
    });

    it('should close nested popover and call handleClick on trigger item when different item is clicked', () => {
      const triggerItem = createMockDefaultItem({
        hasChildren: true,
        handleClick: vi.fn(),
        getElement: vi.fn(() => document.createElement('div')),
      });

      const clickedItem = createMockDefaultItem({
        hasChildren: false,
        handleClick: vi.fn(),
        getElement: vi.fn(() => document.createElement('div')),
      });

      // Set nestedPopoverTriggerItem on the actual instance
      (mocks.popoverInline as unknown as { nestedPopoverTriggerItem: PopoverItemDefault | null }).nestedPopoverTriggerItem = triggerItem;

      // Delete the mock 'handleItemClick' from the instance so that PopoverInline.prototype.handleItemClick is used
      delete (mocks.popoverInline as unknown as Record<string, unknown>).handleItemClick;

      (mocks.popoverInline as unknown as { handleItemClick: (item: PopoverItemDefault) => void }).handleItemClick(clickedItem);

      expect(triggerItem.handleClick).toHaveBeenCalled();
      expect(mocks.superMethods.destroyNestedPopoverIfExists).toHaveBeenCalled();
      expect(mocks.superMethods.handleItemClick).toHaveBeenCalledWith(clickedItem);
    });

    it('should not close nested popover when trigger item is clicked', () => {
      const triggerItem = createMockDefaultItem({
        hasChildren: true,
        handleClick: vi.fn(),
        getElement: vi.fn(() => document.createElement('div')),
      });

      // Set nestedPopoverTriggerItem on the actual instance
      (mocks.popoverInline as unknown as { nestedPopoverTriggerItem: PopoverItemDefault | null }).nestedPopoverTriggerItem = triggerItem;

      // Delete the mock 'handleItemClick' from the instance so that PopoverInline.prototype.handleItemClick is used
      delete (mocks.popoverInline as unknown as Record<string, unknown>).handleItemClick;

      (mocks.popoverInline as unknown as { handleItemClick: (item: PopoverItemDefault) => void }).handleItemClick(triggerItem);

      expect(mocks.superMethods.destroyNestedPopoverIfExists).not.toHaveBeenCalled();
      expect(mocks.superMethods.handleItemClick).toHaveBeenCalledWith(triggerItem);
    });

    it('should handle click when no nested popover exists', () => {
      const clickedItem = createMockDefaultItem({
        hasChildren: false,
        handleClick: vi.fn(),
        getElement: vi.fn(() => document.createElement('div')),
      });

      // Set nestedPopoverTriggerItem on the actual instance
      (mocks.popoverInline as unknown as { nestedPopoverTriggerItem: PopoverItemDefault | null }).nestedPopoverTriggerItem = null;

      // Delete the mock 'handleItemClick' from the instance so that PopoverInline.prototype.handleItemClick is used
      delete (mocks.popoverInline as unknown as Record<string, unknown>).handleItemClick;

      (mocks.popoverInline as unknown as { handleItemClick: (item: PopoverItemDefault) => void }).handleItemClick(clickedItem);

      expect(mocks.superMethods.handleItemClick).toHaveBeenCalledWith(clickedItem);
    });
  });
});

