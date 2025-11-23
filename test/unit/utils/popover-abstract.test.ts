import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('@codexteam/icons', () => ({
  IconDotCircle: '<svg data-testid="dot-circle"></svg>',
  IconChevronRight: '<svg data-testid="chevron-right"></svg>',
}));

import { PopoverAbstract } from '../../../src/components/utils/popover/popover-abstract';
import type { PopoverParams, PopoverNodes } from '@/types/utils/popover/popover';
import { PopoverEvent } from '@/types/utils/popover/popover-event';
import {
  PopoverItemDefault,
  PopoverItemSeparator,
  type PopoverItem
} from '../../../src/components/utils/popover/components/popover-item';
import { PopoverItemHtml } from '../../../src/components/utils/popover/components/popover-item/popover-item-html/popover-item-html';
import type {
  PopoverItemParams,
  PopoverItemRenderParamsMap
} from '@/types/utils/popover/popover-item';
import { PopoverItemType } from '@/types/utils/popover/popover-item-type';
import type { SearchInput } from '../../../src/components/utils/popover/components/search-input';
import { css } from '../../../src/components/utils/popover/popover.const';
import { css as popoverItemCss } from '../../../src/components/utils/popover/components/popover-item/popover-item-default/popover-item-default.const';

/**
 * Test implementation of PopoverAbstract for unit testing
 */
class TestPopover extends PopoverAbstract {
  public readonly showNestedItemsMock = vi.fn<[item: PopoverItemDefault | PopoverItemHtml], void>();

  /**
   * Override to track calls to showNestedItems
   * @param item - The popover item to show nested items for
   */
  protected override showNestedItems(item: PopoverItemDefault | PopoverItemHtml): void {
    this.showNestedItemsMock(item);
  }

  /**
   * Exposes nodes for testing purposes
   */
  public getNodesForTests(): PopoverNodes {
    return this.nodes;
  }

  /**
   * Exposes items for testing purposes
   */
  public getItemsForTests(): Array<PopoverItem> {
    return this.items;
  }

  /**
   * Exposes getTargetItem for testing purposes
   * @param event - The event to get the target item from
   */
  public invokeGetTargetItem(event: Event): PopoverItemDefault | PopoverItemHtml | undefined {
    return this.getTargetItem(event);
  }

  /**
   * Exposes handleItemClick for testing purposes
   * @param item - The popover item to handle click for
   */
  public invokeHandleItemClick(item: PopoverItem): void {
    this.handleItemClick(item);
  }

  /**
   * Exposes buildItems for testing purposes
   * @param items - The item parameters to build items from
   */
  public invokeBuildItems(items: PopoverItemParams[]): Array<PopoverItem> {
    return this.buildItems(items);
  }
}

const createDefaultItems = (): PopoverItemParams[] => [
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

const createPopover = (
  params: Partial<PopoverParams> = {},
  itemsRenderParams?: PopoverItemRenderParamsMap
): TestPopover => {
  const resolvedParams: PopoverParams = {
    items: params.items ?? createDefaultItems(),
    ...params,
  };

  const popover = new TestPopover(resolvedParams, itemsRenderParams);

  document.body.appendChild(popover.getElement());

  return popover;
};

const patchComposedPath = <T extends Event>(event: T, path: EventTarget[]): T => {
  Object.defineProperty(event, 'composedPath', {
    configurable: true,
    value: () => path,
  });

  return event;
};

describe('PopoverAbstract', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  afterEach(() => {
    vi.clearAllMocks();
    document.body.innerHTML = '';
  });

  describe('constructor', () => {
    it('creates DOM nodes and renders provided items/messages', () => {
      const nothingFoundText = 'Custom message';
      const popover = createPopover({
        messages: { nothingFound: nothingFoundText },
        class: 'custom-popover',
      });

      const nodes = popover.getNodesForTests();
      const items = popover.getItemsForTests();

      expect(popover.getElement()).toBe(nodes.popover);
      expect(nodes.popover.classList.contains(css.popover)).toBe(true);
      expect(nodes.popover.classList.contains('custom-popover')).toBe(true);
      expect(nodes.nothingFoundMessage.textContent).toBe(nothingFoundText);
      expect(nodes.popoverContainer.contains(nodes.items)).toBe(true);
      expect(nodes.items.childElementCount).toBe(items.length);
    });

    it('respects popover item render params constructor argument', () => {
      const popover = createPopover(
        {
          items: [
            {
              title: 'Button item',
              name: 'button-item',
              onActivate: vi.fn(),
            },
          ],
        },
        {
          [PopoverItemType.Default]: {
            wrapperTag: 'button',
          },
        }
      );

      const defaultItem = popover.getItemsForTests()[0] as PopoverItemDefault;
      const element = defaultItem.getElement();

      expect(element?.tagName).toBe('BUTTON');
    });
  });

  describe('buildItems()', () => {
    it('returns appropriate instances for different item types', () => {
      const popover = createPopover();
      const htmlElement = document.createElement('div');
      const items = popover.invokeBuildItems([
        { type: PopoverItemType.Separator },
        { type: PopoverItemType.Html,
          element: htmlElement,
          name: 'html' },
        { title: 'Default',
          name: 'default',
          onActivate: vi.fn() },
      ]);

      expect(items[0]).toBeInstanceOf(PopoverItemSeparator);
      expect(items[1]).toBeInstanceOf(PopoverItemHtml);
      expect(items[2]).toBeInstanceOf(PopoverItemDefault);
    });
  });

  describe('getTargetItem()', () => {
    it('returns PopoverItemDefault when event path contains its element', () => {
      const popover = createPopover();
      const defaultItem = popover.getItemsForTests()[0] as PopoverItemDefault;
      const element = defaultItem.getElement();

      if (element === null) {
        throw new Error('Expected default item element to exist');
      }

      const event = patchComposedPath(new Event('click'), [ element as EventTarget ]);

      expect(popover.invokeGetTargetItem(event)).toBe(defaultItem);
    });

    it('returns PopoverItemHtml when event path contains custom html element', () => {
      const customElement = document.createElement('button');
      const popover = createPopover({
        items: [
          ...createDefaultItems(),
          {
            type: PopoverItemType.Html,
            element: customElement,
            name: 'html',
          },
        ],
      });
      const htmlItem = popover.getItemsForTests().find((item): item is PopoverItemHtml => item instanceof PopoverItemHtml);

      if (htmlItem === undefined) {
        throw new Error('Expected html item to be created');
      }

      const htmlRoot = htmlItem.getElement();

      const event = patchComposedPath(new Event('click'), [ htmlRoot ]);

      expect(popover.invokeGetTargetItem(event)).toBe(htmlItem);
    });
  });

  describe('public API', () => {
    it('show() marks popover as opened and focuses search when available', () => {
      const popover = createPopover();
      const nodes = popover.getNodesForTests();
      const focus = vi.fn();
      const searchMock = {
        focus,
        clear: vi.fn(),
        destroy: vi.fn(),
      } as unknown as SearchInput;

      (popover as unknown as { search?: SearchInput }).search = searchMock;

      popover.show();

      expect(nodes.popover.classList.contains(css.popoverOpened)).toBe(true);
      expect(nodes.popover.getAttribute('data-popover-opened')).toBe('true');
      expect(focus).toHaveBeenCalledTimes(1);
    });

    it('hide() clears classes, resets items, clears search and emits Closed event', () => {
      const popover = createPopover();
      const nodes = popover.getNodesForTests();
      const defaultItem = popover.getItemsForTests().find((item): item is PopoverItemDefault => item instanceof PopoverItemDefault);

      if (defaultItem === undefined) {
        throw new Error('Expected default item to exist');
      }

      const resetSpy = vi.spyOn(defaultItem, 'reset');
      const searchMock = {
        focus: vi.fn(),
        clear: vi.fn(),
        destroy: vi.fn(),
      } as unknown as SearchInput;
      const closedHandler = vi.fn();

      (popover as unknown as { search?: SearchInput }).search = searchMock;
      popover.on(PopoverEvent.Closed, closedHandler);

      nodes.popover.classList.add(css.popoverOpenTop, css.popoverOpenLeft);
      popover.show();
      popover.hide();

      expect(nodes.popover.classList.contains(css.popoverOpened)).toBe(false);
      expect(nodes.popover.classList.contains(css.popoverOpenTop)).toBe(false);
      expect(nodes.popover.getAttribute('data-popover-opened')).toBeNull();
      expect(resetSpy).toHaveBeenCalled();
      expect(searchMock.clear).toHaveBeenCalledTimes(1);
      expect(closedHandler).toHaveBeenCalledTimes(1);
    });

    it('destroy() tears down DOM nodes, listeners, items and search instance', () => {
      const popover = createPopover();
      const nodes = popover.getNodesForTests();
      const items = popover.getItemsForTests();
      const searchMock = {
        focus: vi.fn(),
        clear: vi.fn(),
        destroy: vi.fn(),
      } as unknown as SearchInput;
      const removeAllSpy = vi.spyOn(popover['listeners'], 'removeAll');
      const destroySpies = items.map(item => vi.spyOn(item, 'destroy'));

      (popover as unknown as { search?: SearchInput }).search = searchMock;

      popover.destroy();

      expect(removeAllSpy).toHaveBeenCalledTimes(1);
      destroySpies.forEach(spy => expect(spy).toHaveBeenCalled());
      expect(searchMock.destroy).toHaveBeenCalledTimes(1);
      expect(document.body.contains(nodes.popover)).toBe(false);
    });

    it('activateItemByName() triggers handleItemClick only for existing items', () => {
      const popover = createPopover();
      const handleItemClickSpy = vi.spyOn(
        popover as unknown as { handleItemClick: (item: PopoverItem) => void },
        'handleItemClick'
      );

      popover.activateItemByName('second');
      popover.activateItemByName('missing');

      expect(handleItemClickSpy).toHaveBeenCalledTimes(1);
      const items = popover.getItemsForTests();

      expect(handleItemClickSpy).toHaveBeenCalledWith(items[1]);
    });
  });

  describe('handleItemClick()', () => {
    it('ignores disabled items', () => {
      const popover = createPopover({
        items: [
          {
            title: 'Disabled',
            name: 'disabled',
            isDisabled: true,
            onActivate: vi.fn(),
          },
        ],
      });
      const item = popover.getItemsForTests()[0] as PopoverItemDefault;
      const handleSpy = vi.spyOn(item, 'handleClick');

      popover.invokeHandleItemClick(item);

      expect(handleSpy).not.toHaveBeenCalled();
    });

    it('opens nested items when an item with children is clicked', () => {
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
      const parentItem = popover.getItemsForTests()[0] as PopoverItemDefault;
      const handleSpy = vi.spyOn(parentItem, 'handleClick');

      popover.invokeHandleItemClick(parentItem);

      expect(popover.showNestedItemsMock).toHaveBeenCalledWith(parentItem);
      expect(handleSpy).toHaveBeenCalledTimes(1);
    });

    it('toggles activeness when toggle=true', () => {
      const popover = createPopover({
        items: [
          {
            title: 'Toggle item',
            name: 'toggle',
            toggle: true,
            onActivate: vi.fn(),
          },
        ],
      });
      const toggleItem = popover.getItemsForTests()[0] as PopoverItemDefault;
      const element = toggleItem.getElement();

      if (element === null) {
        throw new Error('Expected toggle item element to exist');
      }

      popover.invokeHandleItemClick(toggleItem);
      expect(element?.classList.contains(popoverItemCss.active)).toBe(true);

      popover.invokeHandleItemClick(toggleItem);
      expect(element?.classList.contains(popoverItemCss.active)).toBe(false);
    });

    it('applies radio-like behaviour when toggle is a string key', () => {
      const popover = createPopover({
        items: [
          {
            title: 'First',
            name: 'first',
            toggle: 'group',
            onActivate: vi.fn(),
          },
          {
            title: 'Second',
            name: 'second',
            toggle: 'group',
            onActivate: vi.fn(),
          },
        ],
      });
      const [first, second] = popover.getItemsForTests() as PopoverItemDefault[];
      const firstEl = first.getElement();
      const secondEl = second.getElement();

      if (firstEl === null || secondEl === null) {
        throw new Error('Expected toggle items to have DOM nodes');
      }

      popover.invokeHandleItemClick(first);
      expect(firstEl?.classList.contains(popoverItemCss.active)).toBe(true);
      expect(secondEl?.classList.contains(popoverItemCss.active)).toBe(false);

      popover.invokeHandleItemClick(second);
      expect(secondEl?.classList.contains(popoverItemCss.active)).toBe(true);
      expect(firstEl?.classList.contains(popoverItemCss.active)).toBe(false);
    });

    it('hides popover and emits ClosedOnActivate when item requires closing', () => {
      const popover = createPopover({
        items: [
          {
            title: 'Close on activate',
            name: 'close',
            closeOnActivate: true,
            onActivate: vi.fn(),
          },
        ],
      });
      const item = popover.getItemsForTests()[0] as PopoverItemDefault;
      const nodes = popover.getNodesForTests();
      const closedOnActivateHandler = vi.fn();

      popover.on(PopoverEvent.ClosedOnActivate, closedOnActivateHandler);
      popover.show();
      popover.invokeHandleItemClick(item);

      expect(nodes.popover.classList.contains(css.popoverOpened)).toBe(false);
      expect(closedOnActivateHandler).toHaveBeenCalledTimes(1);
    });
  });

  describe('event listener wiring', () => {
    it('translate DOM click events into handleItemClick calls', () => {
      const popover = createPopover();
      const handleItemClickSpy = vi.spyOn(
        popover as unknown as { handleItemClick: (item: PopoverItem) => void },
        'handleItemClick'
      );
      const nodes = popover.getNodesForTests();
      const firstItem = popover.getItemsForTests()[0] as PopoverItemDefault;
      const itemElement = firstItem.getElement();

      if (itemElement === null) {
        throw new Error('Expected item element to exist');
      }
      const event = patchComposedPath(
        new Event('click', { bubbles: true }),
        [itemElement as EventTarget, nodes.items, nodes.popoverContainer]
      );

      itemElement?.dispatchEvent(event);

      expect(handleItemClickSpy).toHaveBeenCalledWith(firstItem);
    });
  });
});
