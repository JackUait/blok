import { describe, it, expect, beforeEach, vi } from 'vitest';
import { PopoverInline } from '../../../src/components/utils/popover/popover-inline';
import { PopoverDesktop } from '../../../src/components/utils/popover/popover-desktop';
import { PopoverItemDefault, PopoverItemType } from '../../../src/components/utils/popover/components/popover-item';
import type { PopoverItemHtml } from '../../../src/components/utils/popover/components/popover-item/popover-item-html/popover-item-html';
import { CSSVariables, css } from '../../../src/components/utils/popover/popover.const';
import type { PopoverParams } from '@/types/utils/popover/popover';
import { PopoverEvent } from '@/types/utils/popover/popover-event';
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
  /* eslint-disable prefer-const */
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

    // Mock PopoverDesktop constructor
    vi.mocked(PopoverDesktop).mockImplementation(() => mocks.mockPopoverDesktop as unknown as PopoverDesktop);

    // Mock Flipper constructor
    vi.mocked(Flipper).mockImplementation(() => mocks.mockFlipper as unknown as Flipper);

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
          class: css.popoverInline,
        },
        {
          [PopoverItemType.Default]: {
            wrapperTag: 'button',
            hint: {
              position: 'top',
              alignment: 'center',
              enabled: true,
            },
          },
          [PopoverItemType.Html]: {
            hint: {
              position: 'top',
              alignment: 'center',
              enabled: true,
            },
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

      mocks.popoverInline = new PopoverInline(mocks.mockPopoverParams);

      expect(mocks.superMethods.showNestedItems).toHaveBeenCalledWith(itemWithOpenChildren);
    });

    it('should not show nested items for items without children', () => {
      const itemWithoutChildren = createMockDefaultItem({
        hasChildren: false,
        isChildrenOpen: false,
      });

      mocks.mockPopoverDesktop.items = [ itemWithoutChildren ];

      mocks.popoverInline = new PopoverInline(mocks.mockPopoverParams);

      expect(mocks.superMethods.showNestedItems).not.toHaveBeenCalled();
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

      mocks.popoverInline = new PopoverInline(mocks.mockPopoverParams);

      // Should only call showNestedItems for PopoverItemDefault/PopoverItemHtml, not separator
      expect(mocks.superMethods.showNestedItems).toHaveBeenCalledTimes(1);
      expect(mocks.superMethods.showNestedItems).toHaveBeenCalledWith(itemWithOpenChildren);
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

    it('should call super.show()', () => {
      mocks.popoverInline.show();

      expect(mocks.superMethods.show).toHaveBeenCalled();
    });

    it('should set width and height CSS variables when nestingLevel is 0', () => {
      mocks.mockPopoverDesktop.nestingLevel = 0;
      const containerRect = {
        width: 200,
        height: 100,
      };

      vi.spyOn(mocks.mockPopoverDesktop.nodes.popoverContainer!, 'getBoundingClientRect').mockReturnValue(containerRect as DOMRect);

      mocks.popoverInline.show();

      expect(mocks.mockPopoverDesktop.nodes.popover.style.getPropertyValue(CSSVariables.InlinePopoverWidth)).toBe('200px');
      expect(mocks.mockPopoverDesktop.nodes.popover.style.width).toBe('200px');
      expect(mocks.mockPopoverDesktop.nodes.popover.style.height).toBe('100px');
    });

    it('should not set width/height CSS variables when nestingLevel is not 0', () => {
      mocks.mockPopoverDesktop.nestingLevel = 1;

      mocks.popoverInline.show();

      expect(mocks.mockPopoverDesktop.nodes.popover.style.getPropertyValue(CSSVariables.InlinePopoverWidth)).toBe('');
    });

    it('should handle undefined containerRect gracefully', () => {
      mocks.mockPopoverDesktop.nestingLevel = 0;
      mocks.mockPopoverDesktop.nodes.popoverContainer = null;

      // Should not throw
      expect(() => mocks.popoverInline.show()).not.toThrow();
    });

    it('should deactivate and activate flipper with flippableElements', () => {
      const flippableElements = [ document.createElement('button') ];

      // Access private property to set flippableElements
      Object.defineProperty(mocks.popoverInline, 'flippableElements', {
        get: () => flippableElements,
        configurable: true,
      });

      mocks.popoverInline.show();

      // Use requestAnimationFrame to wait for async flipper activation
      return new Promise<void>((resolve) => {
        requestAnimationFrame(() => {
          expect(mocks.mockFlipper.deactivate).toHaveBeenCalled();
          expect(mocks.mockFlipper.activate).toHaveBeenCalledWith(flippableElements);
          resolve();
        });
      });
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

      (mocks.popoverInline as unknown as { setTriggerItemPosition: (el: HTMLElement, item: PopoverItemDefault) => void })
        .setTriggerItemPosition(nestedPopoverEl, item);

      expect(nestedPopoverEl.style.getPropertyValue(CSSVariables.TriggerItemLeft)).toBe(`${expectedOffset}px`);
    });

    it('should handle null item element', () => {
      const nestedPopoverEl = document.createElement('div');

      const item = createMockDefaultItem({
        getElement: vi.fn(() => null),
      });

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

      mocks.mockPopoverDesktop.nestedPopoverTriggerItem = item;

      (mocks.popoverInline as unknown as { showNestedItems: (item: PopoverItemDefault) => void }).showNestedItems(item);

      expect(mocks.superMethods.destroyNestedPopoverIfExists).toHaveBeenCalled();
      expect(mocks.mockPopoverDesktop.nestedPopoverTriggerItem).toBeNull();
      expect(mocks.superMethods.showNestedItems).not.toHaveBeenCalled();
    });

    it('should show nested popover for different item', () => {
      const item1 = createMockDefaultItem({
        hasChildren: true,
      });

      const item2 = createMockDefaultItem({
        hasChildren: true,
      });

      mocks.mockPopoverDesktop.nestedPopoverTriggerItem = item1;

      (mocks.popoverInline as unknown as { showNestedItems: (item: PopoverItemDefault) => void }).showNestedItems(item2);

      expect(mocks.superMethods.destroyNestedPopoverIfExists).not.toHaveBeenCalled();
      expect(mocks.superMethods.showNestedItems).toHaveBeenCalledWith(item2);
    });

    it('should show nested popover when no nested popover exists', () => {
      const item = createMockDefaultItem({
        hasChildren: true,
      });

      mocks.mockPopoverDesktop.nestedPopoverTriggerItem = null;

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
        },
      } as unknown as PopoverDesktop;

      mocks.superMethods.showNestedPopoverForItem.mockReturnValue(nestedPopover);

      const result = (mocks.popoverInline as unknown as { showNestedPopoverForItem: (item: PopoverItemDefault) => PopoverDesktop })
        .showNestedPopoverForItem(item);

      expect(result).toBe(nestedPopover);
      expect(nestedPopoverEl.classList.contains(css.getPopoverNestedClass(1))).toBe(true);
    });

    it('should focus nested popover on first Tab press and remove listener', () => {
      const flippableElements = [ document.createElement('button') ];
      const nestedPopoverEl = document.createElement('div');
      const nestedPopoverFlipper = {
        setHandleContentEditableTargets: vi.fn(),
        activate: vi.fn(),
        deactivate: vi.fn(),
        focusFirst: vi.fn(),
      };

      const onMock = vi.fn();
      const nestedPopover = {
        getElement: vi.fn(() => nestedPopoverEl),
        nestingLevel: 1,
        on: onMock,
        flipper: nestedPopoverFlipper,
      } as unknown as PopoverDesktop;

      Object.defineProperty(nestedPopover, 'flippableElements', {
        configurable: true,
        get: () => flippableElements,
      });

      const addEventListenerSpy = vi.spyOn(document, 'addEventListener');
      const removeEventListenerSpy = vi.spyOn(document, 'removeEventListener');

      try {
        mocks.superMethods.showNestedPopoverForItem.mockReturnValue(nestedPopover);

        const item = createMockDefaultItem({
          hasChildren: true,
          getElement: vi.fn(() => document.createElement('div')),
        });

        (mocks.popoverInline as unknown as { showNestedPopoverForItem: (item: PopoverItemDefault) => PopoverDesktop })
          .showNestedPopoverForItem(item);

        const keydownCall = addEventListenerSpy.mock.calls.find(([ eventName ]) => eventName === 'keydown');

        expect(keydownCall).toBeDefined();

        const handleFirstTab = keydownCall?.[1] as EventListener;

        if (!handleFirstTab) {
          throw new Error('handleFirstTab listener is not registered');
        }

        mocks.mockPopoverDesktop.nestedPopover = nestedPopover;

        const preventDefault = vi.fn();
        const stopPropagation = vi.fn();

        const event = {
          key: 'Tab',
          shiftKey: false,
          preventDefault,
          stopPropagation,
        } as unknown as KeyboardEvent;

        handleFirstTab(event);

        expect(preventDefault).toHaveBeenCalled();
        expect(stopPropagation).toHaveBeenCalled();
        expect(nestedPopoverFlipper.activate).toHaveBeenCalledWith(flippableElements);
        expect(nestedPopoverFlipper.focusFirst).toHaveBeenCalled();
        expect(removeEventListenerSpy).toHaveBeenCalledWith('keydown', handleFirstTab, true);
      } finally {
        addEventListenerSpy.mockRestore();
        removeEventListenerSpy.mockRestore();
      }
    });

    it('should remove Tab listener when nested popover closes', () => {
      const nestedPopoverEl = document.createElement('div');
      const onMock = vi.fn();
      const nestedPopover = {
        getElement: vi.fn(() => nestedPopoverEl),
        nestingLevel: 1,
        on: onMock,
        flipper: {
          setHandleContentEditableTargets: vi.fn(),
          activate: vi.fn(),
          deactivate: vi.fn(),
          focusFirst: vi.fn(),
        },
      } as unknown as PopoverDesktop;

      Object.defineProperty(nestedPopover, 'flippableElements', {
        configurable: true,
        get: () => [],
      });

      const addEventListenerSpy = vi.spyOn(document, 'addEventListener');
      const removeEventListenerSpy = vi.spyOn(document, 'removeEventListener');

      try {
        mocks.superMethods.showNestedPopoverForItem.mockReturnValue(nestedPopover);

        const item = createMockDefaultItem({
          hasChildren: true,
          getElement: vi.fn(() => document.createElement('div')),
        });

        (mocks.popoverInline as unknown as { showNestedPopoverForItem: (item: PopoverItemDefault) => PopoverDesktop })
          .showNestedPopoverForItem(item);

        const keydownCall = addEventListenerSpy.mock.calls.find(([ eventName ]) => eventName === 'keydown');

        expect(keydownCall).toBeDefined();

        const handleFirstTab = keydownCall?.[1] as EventListener;

        if (!handleFirstTab) {
          throw new Error('handleFirstTab listener is not registered');
        }

        const closedHandler = onMock.mock.calls.find(([ event ]) => event === PopoverEvent.Closed)?.[1] as () => void;

        expect(closedHandler).toBeInstanceOf(Function);

        closedHandler();

        expect(removeEventListenerSpy).toHaveBeenCalledWith('keydown', handleFirstTab, true);
      } finally {
        addEventListenerSpy.mockRestore();
        removeEventListenerSpy.mockRestore();
      }
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

      mocks.mockPopoverDesktop.nestedPopoverTriggerItem = triggerItem;

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

      mocks.mockPopoverDesktop.nestedPopoverTriggerItem = triggerItem;

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

      mocks.mockPopoverDesktop.nestedPopoverTriggerItem = null;

      (mocks.popoverInline as unknown as { handleItemClick: (item: PopoverItemDefault) => void }).handleItemClick(clickedItem);

      expect(mocks.superMethods.handleItemClick).toHaveBeenCalledWith(clickedItem);
    });
  });
});

