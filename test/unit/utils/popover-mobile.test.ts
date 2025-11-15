import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { PopoverParams, PopoverMobileNodes } from '@/types/utils/popover/popover';
import type { PopoverItemDefaultParams, PopoverItemParams } from '@/types/utils/popover/popover-item';
import type { PopoverHeaderParams } from '../../../src/components/utils/popover/components/popover-header';
import { PopoverItemDefault } from '../../../src/components/utils/popover/components/popover-item';
import { PopoverMobile } from '../../../src/components/utils/popover/popover-mobile';
import { PopoverAbstract } from '../../../src/components/utils/popover/popover-abstract';
import { PopoverStatesHistory } from '../../../src/components/utils/popover/utils/popover-states-history';
import { css } from '../../../src/components/utils/popover/popover.const';

interface MockScrollLockerInstance {
  lock: ReturnType<typeof vi.fn>;
  unlock: ReturnType<typeof vi.fn>;
}

interface MockPopoverHeaderInstance {
  destroy: ReturnType<typeof vi.fn>;
  getElement: ReturnType<typeof vi.fn<[], HTMLElement>>;
  element: HTMLElement;
  params: PopoverHeaderParams;
}

const scrollLockerMock = vi.hoisted(() => {
  const instances: MockScrollLockerInstance[] = [];
  const factory = vi.fn(() => {
    const instance: MockScrollLockerInstance = {
      lock: vi.fn(),
      unlock: vi.fn(),
    };

    instances.push(instance);

    return instance;
  });

  return { instances,
    factory };
});

vi.mock('../../../src/components/utils/scroll-locker', () => ({
  default: scrollLockerMock.factory,
}));

const popoverHeaderMock = vi.hoisted(() => {
  const instances: MockPopoverHeaderInstance[] = [];
  const factory = vi.fn((params: PopoverHeaderParams) => {
    const element = document.createElement('div');
    const instance: MockPopoverHeaderInstance = {
      destroy: vi.fn(),
      getElement: vi.fn<[], HTMLElement>(() => element),
      element,
      params,
    };

    instances.push(instance);

    return instance;
  });

  return { instances,
    factory };
});

vi.mock('../../../src/components/utils/popover/components/popover-header', () => ({
  PopoverHeader: popoverHeaderMock.factory,
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
      const historyPushSpy = vi.spyOn(PopoverStatesHistory.prototype, 'push');
      const { popover, params } = createPopover();
      const nodes = getNodes(popover);
      const hideSpy = vi.spyOn(popover, 'hide');

      expect(nodes.overlay.classList.contains(css.overlay)).toBe(true);
      expect(nodes.overlay.classList.contains(css.overlayHidden)).toBe(true);
      expect(nodes.popover.firstChild).toBe(nodes.overlay);

      nodes.overlay.click();

      expect(hideSpy).toHaveBeenCalledTimes(1);
      expect(historyPushSpy).toHaveBeenCalledWith({ items: params.items });
    });
  });

  describe('show', () => {
    it('removes overlay hidden class, calls super.show, and locks scroll', () => {
      const superShowSpy = vi.spyOn(PopoverAbstract.prototype, 'show');
      const { popover } = createPopover();
      const nodes = getNodes(popover);

      popover.show();

      expect(nodes.overlay.classList.contains(css.overlayHidden)).toBe(false);
      expect(superShowSpy).toHaveBeenCalledTimes(1);
      expect(getLatestScrollLocker().lock).toHaveBeenCalledTimes(1);
    });
  });

  describe('hide', () => {
    it('does nothing when already hidden', () => {
      const superHideSpy = vi.spyOn(PopoverAbstract.prototype, 'hide');
      const historyResetSpy = vi.spyOn(PopoverStatesHistory.prototype, 'reset');
      const { popover } = createPopover();

      popover.hide();

      expect(superHideSpy).not.toHaveBeenCalled();
      expect(historyResetSpy).not.toHaveBeenCalled();
      expect(getLatestScrollLocker().unlock).not.toHaveBeenCalled();
    });

    it('hides overlay, resets history, and unlocks scroll when popover was visible', () => {
      const superHideSpy = vi.spyOn(PopoverAbstract.prototype, 'hide');
      const historyResetSpy = vi.spyOn(PopoverStatesHistory.prototype, 'reset');
      const { popover } = createPopover();
      const nodes = getNodes(popover);

      popover.show();
      popover.hide();

      expect(nodes.overlay.classList.contains(css.overlayHidden)).toBe(true);
      expect(superHideSpy).toHaveBeenCalledTimes(1);
      expect(historyResetSpy).toHaveBeenCalledTimes(1);
      expect(getLatestScrollLocker().unlock).toHaveBeenCalledTimes(1);
    });
  });

  describe('destroy', () => {
    it('calls super.destroy and unlocks scroll', () => {
      const superDestroySpy = vi.spyOn(PopoverAbstract.prototype, 'destroy');
      const { popover } = createPopover();

      popover.destroy();

      expect(superDestroySpy).toHaveBeenCalledTimes(1);
      expect(getLatestScrollLocker().unlock).toHaveBeenCalledTimes(1);
    });
  });

  describe('showNestedItems', () => {
    it('updates rendered items and pushes nested state to history', () => {
      const historyPushSpy = vi.spyOn(PopoverStatesHistory.prototype, 'push');
      const { popover } = createPopover();
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
      const updateSpy = vi.spyOn(popoverPrivate, 'updateItemsAndHeader');

      popoverPrivate.showNestedItems(parentItem);

      expect(updateSpy).toHaveBeenCalledWith(nestedItems, 'Parent');
      expect(historyPushSpy).toHaveBeenCalledWith({
        title: 'Parent',
        items: nestedItems,
      });
    });

    it('restores previous items when back button is clicked', () => {
      const { popover, params } = createPopover();
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
      const updateSpy = vi.spyOn(popoverPrivate, 'updateItemsAndHeader');
      const historyPopSpy = vi.spyOn(PopoverStatesHistory.prototype, 'pop');

      popoverPrivate.showNestedItems(parentItem);
      updateSpy.mockClear();

      const header = popoverHeaderMock.instances[popoverHeaderMock.instances.length - 1];

      header.params.onBackButtonClick();

      expect(historyPopSpy).toHaveBeenCalledTimes(1);
      expect(updateSpy).toHaveBeenCalledWith(params.items, undefined);
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

      expect(popoverHeaderMock.factory).toHaveBeenCalledTimes(1);
      expect(popoverHeaderMock.instances[0].element).toBe(nodes.popoverContainer.firstChild);
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

      expect(firstHeader.destroy).toHaveBeenCalledTimes(1);
      expect(popoverHeaderMock.factory).toHaveBeenCalledTimes(2);
      expect(popoverHeaderMock.instances[1].element).toBe(nodes.popoverContainer.firstChild);
    });
  });
});
