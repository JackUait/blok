import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { PopoverParams, PopoverMobileNodes } from '@/types/utils/popover/popover';
import type { PopoverItemDefaultParams, PopoverItemParams } from '@/types/utils/popover/popover-item';
import type { PopoverHeaderParams } from '../../../src/components/utils/popover/components/popover-header';
import { PopoverItemDefault } from '../../../src/components/utils/popover/components/popover-item';
import { PopoverMobile } from '../../../src/components/utils/popover/popover-mobile';
import { DATA_ATTR } from '../../../src/components/constants/data-attributes';

interface MockScrollLockerInstance {
  lock: ReturnType<typeof vi.fn>;
  unlock: ReturnType<typeof vi.fn>;
}

interface MockPopoverHeaderInstance {
  destroy: ReturnType<typeof vi.fn>;
  getElement: ReturnType<typeof vi.fn>;
  element: HTMLElement;
  params: PopoverHeaderParams;
}

const scrollLockerMock = vi.hoisted(() => {
  const instances: MockScrollLockerInstance[] = [];

  const MockScrollLocker = vi.fn(function (this: MockScrollLockerInstance) {
    this.lock = vi.fn();
    this.unlock = vi.fn();
    instances.push(this);
  });

  return { instances,
    MockScrollLocker };
});

vi.mock('../../../src/components/utils/scroll-locker', () => ({
  ScrollLocker: scrollLockerMock.MockScrollLocker,
}));

const popoverHeaderMock = vi.hoisted(() => {
  const instances: MockPopoverHeaderInstance[] = [];

  const MockPopoverHeader = vi.fn(function (this: MockPopoverHeaderInstance, params: PopoverHeaderParams) {
    this.element = document.createElement('div');
    this.params = params;
    this.destroy = vi.fn();
    this.getElement = vi.fn(() => this.element);
    instances.push(this);
  });

  return { instances,
    MockPopoverHeader };
});

vi.mock('../../../src/components/utils/popover/components/popover-header', () => ({
  PopoverHeader: popoverHeaderMock.MockPopoverHeader,
}));

const getLatestScrollLocker = (): MockScrollLockerInstance => {
  if (scrollLockerMock.instances.length === 0) {
    throw new Error('ScrollLocker instance was not created');
  }

  return scrollLockerMock.instances[scrollLockerMock.instances.length - 1];
};

const getNodes = (popover: PopoverMobile): PopoverMobileNodes => {
  return (popover as unknown as { nodes: PopoverMobileNodes }).nodes;
};

const getIsHidden = (popover: PopoverMobile): boolean => {
  return (popover as unknown as { isHidden: boolean }).isHidden;
};

const getHistory = (popover: PopoverMobile): { currentItems: PopoverItemParams[]; currentTitle: string | undefined } => {
  const history = (popover as unknown as { history: { currentItems: PopoverItemParams[]; currentTitle: string | undefined } }).history;

  return {
    currentItems: history.currentItems,
    currentTitle: history.currentTitle,
  };
};

const getPrivateApi = (popover: PopoverMobile): {
  updateItemsAndHeader: (items: PopoverItemParams[], title?: string) => void;
  showNestedItems: (item: PopoverItemDefault) => void;
} => popover as unknown as {
  updateItemsAndHeader: (items: PopoverItemParams[], title?: string) => void;
  showNestedItems: (item: PopoverItemDefault) => void;
};

const createPopoverParams = (overrides: Partial<PopoverParams> = {}): PopoverParams => ({
  items: [
    {
      title: 'First item',
      onActivate: vi.fn(),
    },
    {
      title: 'Second item',
      onActivate: vi.fn(),
    },
  ],
  ...overrides,
});

const createPopover = (overrides?: Partial<PopoverParams>): { popover: PopoverMobile; params: PopoverParams } => {
  const params = createPopoverParams(overrides);

  return {
    popover: new PopoverMobile(params),
    params,
  };
};

describe('PopoverMobile', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    vi.clearAllMocks();
    scrollLockerMock.instances.length = 0;
    popoverHeaderMock.instances.length = 0;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('constructor', () => {
    it('creates overlay, attaches click to hide, and stores initial state in history', () => {
      const { popover, params } = createPopover();
      const nodes = getNodes(popover);
      const history = getHistory(popover);

      expect(nodes.overlay).toBeInstanceOf(HTMLElement);
      expect(getIsHidden(popover)).toBe(true);
      expect(nodes.popover.firstChild).toBe(nodes.overlay);

      // Verify initial state is stored in history
      expect(history.currentItems).toEqual(params.items);

      // Verify clicking overlay hides the popover
      nodes.overlay.click();

      expect(getIsHidden(popover)).toBe(true);
      expect(getLatestScrollLocker().unlock).not.toHaveBeenCalled();
    });
  });

  describe('show', () => {
    it('removes overlay hidden attribute, adds popover to DOM, and locks scroll', () => {
      const { popover } = createPopover();
      const nodes = getNodes(popover);

      popover.show();

      // Verify overlay visible state - hidden attribute should be removed
      expect(nodes.overlay).not.toHaveAttribute(DATA_ATTR.overlayHidden);

      // Verify popover is in DOM and opened
      expect(nodes.popover.isConnected).toBe(true);
      expect(nodes.popover).toHaveAttribute(DATA_ATTR.popoverOpened, 'true');

      // Verify scroll is locked
      expect(getLatestScrollLocker().lock).toHaveBeenCalledTimes(1);

      // Verify isHidden flag is updated
      expect(getIsHidden(popover)).toBe(false);
    });
  });

  describe('hide', () => {
    it('does nothing when already hidden', () => {
      const { popover } = createPopover();
      const nodes = getNodes(popover);
      const historyBefore = getHistory(popover);

      popover.hide();

      // Verify state hasn't changed
      expect(getIsHidden(popover)).toBe(true);
      expect(nodes.overlay).toHaveAttribute(DATA_ATTR.overlayHidden);
      expect(nodes.popover).not.toHaveAttribute(DATA_ATTR.popoverOpened);

      // Verify history hasn't been reset (same current items)
      const historyAfter = getHistory(popover);
      expect(historyAfter.currentItems).toEqual(historyBefore.currentItems);

      // Verify scroll unlock was not called
      expect(getLatestScrollLocker().unlock).not.toHaveBeenCalled();
    });

    it('hides overlay, resets history, and unlocks scroll when popover was visible', () => {
      const { popover, params } = createPopover();
      const nodes = getNodes(popover);

      popover.show();
      popover.hide();

      // Verify isHidden flag is updated
      expect(getIsHidden(popover)).toBe(true);

      // Verify overlay is hidden
      expect(nodes.overlay).toHaveAttribute(DATA_ATTR.overlayHidden);

      // Verify popover is closed
      expect(nodes.popover).not.toHaveAttribute(DATA_ATTR.popoverOpened);

      // Verify history is reset to initial state
      const history = getHistory(popover);
      expect(history.currentItems).toEqual(params.items);
      expect(history.currentTitle).toBe(undefined);

      // Verify scroll is unlocked
      expect(getLatestScrollLocker().unlock).toHaveBeenCalledTimes(1);
    });
  });

  describe('destroy', () => {
    it('removes popover from DOM and unlocks scroll', () => {
      const { popover } = createPopover();
      const nodes = getNodes(popover);

      // Attach to DOM
      document.body.appendChild(nodes.popover);
      expect(nodes.popover.isConnected).toBe(true);

      popover.destroy();

      // Verify popover is removed from DOM
      expect(nodes.popover.isConnected).toBe(false);

      // Verify scroll is unlocked
      expect(getLatestScrollLocker().unlock).toHaveBeenCalledTimes(1);
    });
  });

  describe('showNestedItems', () => {
    it('updates rendered items and stores nested state in history', () => {
      const { popover } = createPopover();
      const nodes = getNodes(popover);
      const popoverPrivate = getPrivateApi(popover);
      const nestedItems: PopoverItemParams[] = [
        {
          title: 'Nested child',
          onActivate: vi.fn(),
        },
      ];
      const parentItemParams: PopoverItemDefaultParams = {
        title: 'Parent',
        children: {
          items: nestedItems,
        },
      };
      const parentItem = new PopoverItemDefault(parentItemParams);

      popoverPrivate.showNestedItems(parentItem);

      // Verify DOM state - new items are rendered
      expect(nodes.items.children.length).toBe(nestedItems.length);

      // Verify header was created with parent title
      expect(popoverHeaderMock.instances.length).toBe(1);
      expect(popoverHeaderMock.instances[0].params.text).toBe('Parent');

      // Verify history state
      const history = getHistory(popover);
      expect(history.currentItems).toEqual(nestedItems);
      expect(history.currentTitle).toBe('Parent');
    });

    it('restores previous items when back button is clicked', () => {
      const { popover, params } = createPopover();
      const nodes = getNodes(popover);
      const popoverPrivate = getPrivateApi(popover);
      const nestedItems: PopoverItemParams[] = [
        {
          title: 'Nested child',
          onActivate: vi.fn(),
        },
      ];
      const parentItem = new PopoverItemDefault({
        title: 'Parent',
        children: {
          items: nestedItems,
        },
      } as PopoverItemDefaultParams);

      // Show nested items
      popoverPrivate.showNestedItems(parentItem);

      // Verify nested items are rendered
      expect(nodes.items.children.length).toBe(nestedItems.length);

      const header = popoverHeaderMock.instances[popoverHeaderMock.instances.length - 1];

      // Simulate back button click
      header.params.onBackButtonClick();

      // Verify original items are restored
      expect(nodes.items.children.length).toBe(params.items.length);

      // Verify history state is restored
      const history = getHistory(popover);
      expect(history.currentItems).toEqual(params.items);
      expect(history.currentTitle).toBe(undefined);
    });
  });

  describe('updateItemsAndHeader', () => {
    it('renders header and replaces items when title is provided', () => {
      const { popover } = createPopover();
      const popoverPrivate = getPrivateApi(popover);
      const nodes = getNodes(popover);
      const initialItems = Array.from(nodes.items.children);
      const nextItems: PopoverItemParams[] = [
        {
          title: 'Next',
          onActivate: vi.fn(),
        },
        {
          title: 'Another',
          onActivate: vi.fn(),
        },
      ];

      popoverPrivate.updateItemsAndHeader(nextItems, 'Nested title');

      // Verify header is rendered
      expect(popoverHeaderMock.MockPopoverHeader).toHaveBeenCalledTimes(1);
      expect(popoverHeaderMock.instances[0].element).toBe(nodes.popoverContainer.firstChild);

      // Verify items are replaced
      expect(nodes.items.childElementCount).toBe(nextItems.length);
      initialItems.forEach(element => {
        expect(nodes.items.contains(element)).toBe(false);
      });
    });

    it('destroys existing header before rendering a new one', () => {
      const { popover } = createPopover();
      const popoverPrivate = getPrivateApi(popover);
      const nodes = getNodes(popover);
      const firstItems: PopoverItemParams[] = [
        {
          title: 'First nested',
          onActivate: vi.fn(),
        },
      ];
      const secondItems: PopoverItemParams[] = [
        {
          title: 'Second nested',
          onActivate: vi.fn(),
        },
      ];

      popoverPrivate.updateItemsAndHeader(firstItems, 'First title');
      const [ firstHeader ] = popoverHeaderMock.instances;

      popoverPrivate.updateItemsAndHeader(secondItems, 'Second title');

      // Verify first header was destroyed
      expect(firstHeader.destroy).toHaveBeenCalledTimes(1);

      // Verify second header was created and rendered
      expect(popoverHeaderMock.MockPopoverHeader).toHaveBeenCalledTimes(2);
      expect(popoverHeaderMock.instances[1].element).toBe(nodes.popoverContainer.firstChild);
    });
  });
});
