import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { PopoverParams, PopoverMobileNodes } from '@/types/utils/popover/popover';
import type { PopoverItemDefaultParams, PopoverItemParams } from '@/types/utils/popover/popover-item';
import type { PopoverHeaderParams } from '../../../src/components/utils/popover/components/popover-header';
import { PopoverItemDefault } from '../../../src/components/utils/popover/components/popover-item';
import { PopoverMobile } from '../../../src/components/utils/popover/popover-mobile';
import { PopoverItemType } from '@/types/utils/popover/popover-item-type';
import { DATA_ATTR } from '../../../src/components/constants/data-attributes';
import { LightweightI18n } from '../../../src/components/i18n/lightweight-i18n';

interface MockScrollLockerInstance {
  lock: ReturnType<typeof vi.fn>;
  unlock: ReturnType<typeof vi.fn>;
  isLocked: boolean;
}

interface MockPopoverHeaderInstance {
  destroy: ReturnType<typeof vi.fn>;
  getElement: ReturnType<typeof vi.fn>;
  getTitleId: ReturnType<typeof vi.fn>;
  titleId: string;
  element: HTMLElement;
  params: PopoverHeaderParams;
}

const scrollLockerMock = vi.hoisted(() => {
  const instances: MockScrollLockerInstance[] = [];

  const MockScrollLocker = vi.fn(function (this: MockScrollLockerInstance) {
    let locked = false;

    this.lock = vi.fn(() => {
      locked = true;
    });
    this.unlock = vi.fn(() => {
      locked = false;
    });
    Object.defineProperty(this, 'isLocked', {
      configurable: true,
      get: () => locked,
    });
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

  let headerCounter = 0;

  const MockPopoverHeader = vi.fn(function (this: MockPopoverHeaderInstance, params: PopoverHeaderParams) {
    this.element = document.createElement('div');
    this.params = params;
    this.titleId = `mock-header-title-${headerCounter++}`;
    this.destroy = vi.fn();
    this.getElement = vi.fn(() => this.element);
    this.getTitleId = vi.fn(() => this.titleId);
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

const createdPopovers: PopoverMobile[] = [];

const createPopover = (overrides?: Partial<PopoverParams>): { popover: PopoverMobile; params: PopoverParams } => {
  const params = createPopoverParams(overrides);
  const popover = new PopoverMobile(params);

  createdPopovers.push(popover);

  return {
    popover,
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
    // Destroy every popover created during the test: an un-destroyed popover
    // leaves its flipper's document-level capture keydown listener attached,
    // which would stopImmediatePropagation events meant for later tests.
    createdPopovers.forEach(popover => popover.destroy());
    createdPopovers.length = 0;

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

  describe('flippableElements', () => {
    it('includes inner controls of HTML items so they stay keyboard-reachable', () => {
      const htmlElement = document.createElement('div');
      const firstButton = document.createElement('button');
      const secondButton = document.createElement('button');

      htmlElement.append(firstButton, secondButton);

      const { popover } = createPopover({
        items: [
          {
            title: 'Default item',
            onActivate: vi.fn(),
          },
          {
            type: PopoverItemType.Html,
            name: 'custom-html',
            element: htmlElement,
          },
        ],
      });

      const flippable = (popover as unknown as { flippableElements: HTMLElement[] }).flippableElements;

      expect(flippable).toContain(firstButton);
      expect(flippable).toContain(secondButton);
    });

    it('falls back to the wrapper element for HTML items without inner controls', () => {
      const htmlElement = document.createElement('div');

      htmlElement.textContent = 'static content';

      const { popover } = createPopover({
        items: [
          {
            type: PopoverItemType.Html,
            name: 'static-html',
            element: htmlElement,
          },
        ],
      });

      const flippable = (popover as unknown as { flippableElements: HTMLElement[] }).flippableElements;

      expect(flippable).toHaveLength(1);
      expect(flippable[0].contains(htmlElement)).toBe(true);
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
    it('removes popover from DOM and unlocks scroll when a lock is held', () => {
      const { popover } = createPopover();
      const nodes = getNodes(popover);

      // Show acquires the scroll lock
      popover.show();

      // Attach to DOM
      document.body.appendChild(nodes.popover);
      expect(nodes.popover.isConnected).toBe(true);

      popover.destroy();

      // Verify popover is removed from DOM
      expect(nodes.popover.isConnected).toBe(false);

      // Verify scroll is unlocked
      expect(getLatestScrollLocker().unlock).toHaveBeenCalled();
    });

    it('does not unlock scroll on destroy when no lock is held', () => {
      const { popover } = createPopover();
      const nodes = getNodes(popover);

      // Attach to DOM without ever showing (so no lock was acquired)
      document.body.appendChild(nodes.popover);

      popover.destroy();

      expect(nodes.popover.isConnected).toBe(false);
      expect(getLatestScrollLocker().unlock).not.toHaveBeenCalled();
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

  describe('keyboard navigation', () => {
    it('activates keyboard navigation and moves focus onto the first item on show', () => {
      const { popover } = createPopover();
      const nodes = getNodes(popover);

      popover.show();

      const firstItem = nodes.items.children[0] as HTMLElement;

      expect(firstItem.getAttribute('data-blok-focused')).toBe('true');
    });

    it('deactivates keyboard navigation on hide', () => {
      const { popover } = createPopover();
      const nodes = getNodes(popover);

      popover.show();
      popover.hide();

      const firstItem = nodes.items.children[0] as HTMLElement;

      // Focus markers are cleared when the flipper deactivates (drops its cursor).
      expect(firstItem.hasAttribute('data-blok-focused')).toBe(false);
    });

    it('re-activates keyboard navigation and focuses the first item when swapping to a nested page', () => {
      const { popover } = createPopover();
      const nodes = getNodes(popover);
      const popoverPrivate = getPrivateApi(popover);

      popover.show();

      const nestedItems: PopoverItemParams[] = [
        { title: 'Nested child',
          onActivate: vi.fn() },
      ];
      const parentItem = new PopoverItemDefault({
        title: 'Parent',
        children: { items: nestedItems },
      } as PopoverItemDefaultParams);

      popoverPrivate.showNestedItems(parentItem);

      const nestedFirstItem = nodes.items.children[0] as HTMLElement;

      expect(nodes.items.childElementCount).toBe(nestedItems.length);
      expect(nestedFirstItem.getAttribute('data-blok-focused')).toBe('true');
    });
  });

  describe('DOM focus management', () => {
    beforeEach(() => {
      // jsdom does not implement scrollIntoView, which the flipper calls after
      // each flip to keep the focused item visible.
      Element.prototype.scrollIntoView = vi.fn();
    });

    /**
     * Simulates the normal mobile flow: the caret sits in a contenteditable
     * block when the sheet opens. jsdom needs tabindex for programmatic focus
     * and does not reflect the contenteditable attribute into the
     * isContentEditable IDL property, so both are stubbed explicitly.
     */
    const createFocusedContentEditable = (): HTMLElement => {
      const editable = document.createElement('div');

      editable.setAttribute('contenteditable', 'true');
      editable.tabIndex = -1;
      Object.defineProperty(editable, 'isContentEditable', {
        configurable: true,
        value: true,
      });
      document.body.appendChild(editable);
      editable.focus();

      return editable;
    };

    it('moves real DOM focus into the sheet on show', () => {
      const editable = createFocusedContentEditable();
      const { popover } = createPopover();
      const nodes = getNodes(popover);

      expect(editable).toHaveFocus();

      popover.show();

      expect(editable).not.toHaveFocus();
      expect(
        document.activeElement instanceof HTMLElement && nodes.popover.contains(document.activeElement)
      ).toBe(true);
    });

    it('handles ArrowDown at the focused sheet instead of skipping because of the contenteditable', () => {
      createFocusedContentEditable();
      const { popover } = createPopover();
      const nodes = getNodes(popover);

      popover.show();

      const target = document.activeElement instanceof HTMLElement ? document.activeElement : null;

      expect(target).not.toBeNull();

      target?.dispatchEvent(new KeyboardEvent('keydown', {
        key: 'ArrowDown',
        bubbles: true,
        cancelable: true,
      }));

      const secondItem = nodes.items.children[1] as HTMLElement;

      expect(secondItem.getAttribute('data-blok-focused')).toBe('true');
    });

    it('exposes the virtually focused item via aria-activedescendant on the focused sheet element', () => {
      createFocusedContentEditable();
      const { popover } = createPopover();

      popover.show();

      const target = document.activeElement instanceof HTMLElement ? document.activeElement : null;

      expect(target).not.toBeNull();
      expect(target?.getAttribute('aria-activedescendant')).toBeTruthy();
    });

    it('restores focus to the previously focused element on hide', () => {
      const editable = createFocusedContentEditable();
      const { popover } = createPopover();

      popover.show();

      expect(editable).not.toHaveFocus();

      popover.hide();

      expect(editable).toHaveFocus();
    });

    it('restores focus to the previously focused element on destroy', () => {
      const editable = createFocusedContentEditable();
      const { popover } = createPopover();

      popover.show();
      popover.destroy();

      expect(editable).toHaveFocus();
    });

    it('does not restore focus to an element that left the DOM', () => {
      const editable = createFocusedContentEditable();
      const { popover } = createPopover();

      popover.show();
      editable.remove();

      expect(() => popover.hide()).not.toThrow();
      expect(editable).not.toHaveFocus();
    });
  });

  describe('accessibility labelling', () => {
    it('passes a localized back-button label to the header', () => {
      const { popover } = createPopover();
      const popoverPrivate = getPrivateApi(popover);
      const parentItem = new PopoverItemDefault({
        title: 'Parent',
        children: { items: [ { title: 'Child',
          onActivate: vi.fn() } ] },
      } as PopoverItemDefaultParams);

      popoverPrivate.showNestedItems(parentItem);

      const expectedLabel = new LightweightI18n().t('a11y.back');

      expect(popoverHeaderMock.instances[0].params.backButtonLabel).toBe(expectedLabel);
    });

    it('points the items menu aria-labelledby at the header title id on a nested page', () => {
      const { popover } = createPopover();
      const nodes = getNodes(popover);
      const popoverPrivate = getPrivateApi(popover);
      const parentItem = new PopoverItemDefault({
        title: 'Parent',
        children: { items: [ { title: 'Child',
          onActivate: vi.fn() } ] },
      } as PopoverItemDefaultParams);

      popoverPrivate.showNestedItems(parentItem);

      const header = popoverHeaderMock.instances[0];

      expect(nodes.items.getAttribute('aria-labelledby')).toBe(header.titleId);
    });

    it('removes the items menu aria-labelledby when returning to the header-less root', () => {
      const { popover } = createPopover();
      const nodes = getNodes(popover);
      const popoverPrivate = getPrivateApi(popover);
      const parentItem = new PopoverItemDefault({
        title: 'Parent',
        children: { items: [ { title: 'Child',
          onActivate: vi.fn() } ] },
      } as PopoverItemDefaultParams);

      popoverPrivate.showNestedItems(parentItem);
      expect(nodes.items.hasAttribute('aria-labelledby')).toBe(true);

      const header = popoverHeaderMock.instances[popoverHeaderMock.instances.length - 1];

      header.params.onBackButtonClick();

      expect(nodes.items.hasAttribute('aria-labelledby')).toBe(false);
    });

    it('announces the page title via the results announcer on nested navigation', () => {
      const { popover } = createPopover();
      const nodes = getNodes(popover);
      const popoverPrivate = getPrivateApi(popover);
      const parentItem = new PopoverItemDefault({
        title: 'Parent',
        children: { items: [ { title: 'Child',
          onActivate: vi.fn() } ] },
      } as PopoverItemDefaultParams);

      popoverPrivate.showNestedItems(parentItem);

      expect(nodes.resultsAnnouncer.textContent).toBe('Parent');
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
