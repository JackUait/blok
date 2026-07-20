import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('../../../src/components/icons', () => ({
  IconChevronRight: '<svg data-blok-testid="chevron-right"></svg>',
}));

import { PopoverAbstract } from '../../../src/components/utils/popover/popover-abstract';
import type {
  PopoverParams,
  PopoverParamsBase,
  PopoverNodes,
} from '@/types/utils/popover/popover';
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
import { DATA_ATTR } from '../../../src/components/constants/data-attributes';
import { PopoverRegistry } from '../../../src/components/utils/popover/popover-registry';
import { REEL_DISTORTION } from '../../../src/components/utils/popover/popover.const';

/**
 * Test implementation of PopoverAbstract for unit testing
 */
class TestPopover extends PopoverAbstract {
  public readonly showNestedItemsMock = vi.fn<(item: PopoverItemDefault | PopoverItemHtml) => void>();

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

  /**
   * Exposes toggleNothingFoundMessage for testing purposes
   * @param isDisplayed - true if the message should be displayed
   */
  public invokeToggleNothingFoundMessage(isDisplayed: boolean): void {
    this.toggleNothingFoundMessage(isDisplayed);
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
  params: Partial<PopoverParamsBase> = {},
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
    PopoverRegistry.resetForTests();
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
      expect(nodes.popover.dataset.blokTestid).toBe('popover');
      expect(nodes.popover.dataset.blokPopoverCustomClass).toBe('custom-popover');
      expect(nodes.nothingFoundMessage).toHaveTextContent(nothingFoundText);
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

  describe('ARIA container semantics', () => {
    it('exposes the items container as role="menu" by default', () => {
      const popover = createPopover();
      const nodes = popover.getNodesForTests();

      expect(nodes.items.getAttribute('role')).toBe('menu');
    });

    it('exposes the items container as role="listbox" when listbox is set', () => {
      const popover = createPopover({ listbox: true });
      const nodes = popover.getNodesForTests();

      expect(nodes.items.getAttribute('role')).toBe('listbox');
    });

    it('applies listboxId to the items container id', () => {
      const popover = createPopover({ listbox: true, listboxId: 'my-listbox' });
      const nodes = popover.getNodesForTests();

      expect(nodes.items.id).toBe('my-listbox');
    });

    it('renders default items as role="option" in a listbox popover', () => {
      const popover = createPopover({ listbox: true });
      const item = popover.getItemsForTests()[0] as PopoverItemDefault;

      expect(item.getElement()?.getAttribute('role')).toBe('option');
    });

    it('renders default items as role="menuitem" in a menu popover', () => {
      const popover = createPopover();
      const item = popover.getItemsForTests()[0] as PopoverItemDefault;

      expect(item.getElement()?.getAttribute('role')).toBe('menuitem');
    });

    it('creates a visually-hidden polite live region for result announcements', () => {
      const popover = createPopover();
      const nodes = popover.getNodesForTests();

      expect(nodes.resultsAnnouncer).toBeInstanceOf(HTMLElement);
      expect(nodes.resultsAnnouncer.getAttribute('aria-live')).toBe('polite');
      expect(nodes.popoverContainer.contains(nodes.resultsAnnouncer)).toBe(true);
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

      const event = patchComposedPath(new Event('click'), [element]);

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

      const event = patchComposedPath(new Event('click'), [htmlRoot]);

      expect(popover.invokeGetTargetItem(event)).toBe(htmlItem);
    });
  });

  describe('confirmation-mode announcement', () => {
    it('announces the confirmation prompt via the results announcer when an item enters confirmation mode', async () => {
      const popover = createPopover({
        items: [
          {
            title: 'Delete',
            name: 'delete',
            isDestructive: true,
            confirmation: {
              title: 'Click to confirm',
              onActivate: vi.fn(),
            },
          },
        ],
      });
      const nodes = popover.getNodesForTests();
      const [deleteItem] = popover.getItemsForTests();

      popover.invokeHandleItemClick(deleteItem);

      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(nodes.resultsAnnouncer.textContent).toBe('Click to confirm');
    });

    it('clears the announcer before re-setting so identical text is re-announced', async () => {
      const popover = createPopover({
        items: [
          {
            title: 'Delete',
            name: 'delete',
            isDestructive: true,
            confirmation: {
              title: 'Click to confirm',
              onActivate: vi.fn(),
            },
          },
        ],
      });
      const nodes = popover.getNodesForTests();
      const [deleteItem] = popover.getItemsForTests();

      // Simulate a previous identical announcement lingering in the live
      // region — without a clear-then-set the same text produces no
      // announcement in screen readers.
      nodes.resultsAnnouncer.textContent = 'Click to confirm';

      popover.invokeHandleItemClick(deleteItem);

      expect(nodes.resultsAnnouncer.textContent).toBe('');

      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(nodes.resultsAnnouncer.textContent).toBe('Click to confirm');
    });

    it('does not announce for a plain (non-confirmation) item click', () => {
      const popover = createPopover();
      const nodes = popover.getNodesForTests();
      const [firstItem] = popover.getItemsForTests();

      popover.invokeHandleItemClick(firstItem);

      expect(nodes.resultsAnnouncer.textContent).toBe('');
    });
  });

  describe('public API', () => {
    it('copies the owning trigger direction onto a body-mounted root with cascade priority', () => {
      const trigger = document.createElement('button');

      trigger.style.direction = 'rtl';
      document.body.appendChild(trigger);

      const popover = createPopover({ trigger });
      const root = popover.getElement();

      popover.show();

      expect(root).toHaveAttribute('dir', 'rtl');
      expect(root.style.getPropertyValue('direction')).toBe('rtl');
      expect(root.style.getPropertyPriority('direction')).toBe('important');
    });

    it('lets an explicit effective direction override an opposite trigger direction', () => {
      const trigger = document.createElement('button');

      trigger.style.direction = 'rtl';
      document.body.appendChild(trigger);

      const params = {
        trigger,
        direction: 'ltr',
      } as unknown as Partial<PopoverParamsBase>;
      const popover = createPopover(params);
      const root = popover.getElement();

      popover.show();

      expect(root).toHaveAttribute('dir', 'ltr');
      expect(root.style.getPropertyValue('direction')).toBe('ltr');
      expect(root.style.getPropertyPriority('direction')).toBe('important');
    });

    it('does not mistake the host body for an owning editor when no direction source exists', () => {
      document.body.style.direction = 'rtl';

      try {
        const popover = createPopover();
        const root = popover.getElement();

        popover.show();

        expect(root).not.toHaveAttribute('dir');
        expect(root.style.getPropertyValue('direction')).toBe('');
        expect(root.style.getPropertyPriority('direction')).toBe('');
      } finally {
        document.body.style.removeProperty('direction');
      }
    });

    it('uses a non-document scope as the direction owner for a source-less popover', () => {
      const scopeElement = document.createElement('div');

      scopeElement.style.direction = 'rtl';
      document.body.appendChild(scopeElement);

      const popover = createPopover({ scopeElement });
      const root = popover.getElement();

      popover.show();

      expect(root).toHaveAttribute('dir', 'rtl');
      expect(root.style.getPropertyValue('direction')).toBe('rtl');
      expect(root.style.getPropertyPriority('direction')).toBe('important');
    });

    it('does not use document.body when it is explicitly provided as the scope', () => {
      document.body.style.direction = 'rtl';

      try {
        const popover = createPopover({ scopeElement: document.body });
        const root = popover.getElement();

        popover.show();

        expect(root).not.toHaveAttribute('dir');
        expect(root.style.getPropertyValue('direction')).toBe('');
        expect(root.style.getPropertyPriority('direction')).toBe('');
      } finally {
        document.body.style.removeProperty('direction');
      }
    });

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

      expect(nodes.popover).toHaveAttribute(DATA_ATTR.popoverOpened, 'true');
      expect(focus).toHaveBeenCalledTimes(1);
    });

    it('hide() clears classes and emits Closed event', () => {
      const popover = createPopover();
      const nodes = popover.getNodesForTests();
      const closedHandler = vi.fn();

      popover.on(PopoverEvent.Closed, closedHandler);

      // Use the protected methods to set open states (simulating what subclasses do)
      (popover as unknown as { setOpenTop: (v: boolean) => void }).setOpenTop(true);
      (popover as unknown as { setOpenLeft: (v: boolean) => void }).setOpenLeft(true);
      popover.show();
      popover.hide();

      expect(nodes.popover).not.toHaveAttribute(DATA_ATTR.popoverOpened);
      expect(nodes.popover).not.toHaveAttribute(DATA_ATTR.popoverOpenTop);
      expect(nodes.popover).not.toHaveAttribute(DATA_ATTR.popoverOpenLeft);
      expect(closedHandler).toHaveBeenCalledWith(undefined);
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

    it('show() stamps data-state="open" and hide() stamps data-state="closed"', () => {
      const popover = createPopover();
      const nodes = popover.getNodesForTests();

      popover.show();
      expect(nodes.popover.dataset.state).toBe('open');

      popover.hide();
      expect(nodes.popover.dataset.state).toBe('closed');
    });

    it('destroy() animates the real element instead of cloning a ghost live region', () => {
      const popover = createPopover();
      const nodes = popover.getNodesForTests();

      popover.show();

      // Give the popover a measurable box so destroy() takes the animated path
      // (in jsdom getBoundingClientRect is 0×0 by default).
      vi.spyOn(nodes.popover, 'getBoundingClientRect').mockReturnValue({
        width: 200,
        height: 120,
        top: 10,
        left: 10,
        right: 210,
        bottom: 130,
        x: 10,
        y: 10,
        toJSON: () => ({}),
      } as DOMRect);

      const announcersBefore = document.body.querySelectorAll('[aria-live]').length;

      popover.destroy();

      // The real element is retained (still connected) so its exit transition
      // can play — it is NOT removed synchronously and NOT replaced by a clone.
      expect(document.body.contains(nodes.popover)).toBe(true);
      expect(nodes.popover.dataset.state).toBe('closed');

      // No cloned live region: the announcer count must not have grown.
      expect(document.body.querySelectorAll('[aria-live]').length).toBe(announcersBefore);
    });

    it('destroy() removes the real element once the exit transition ends', () => {
      const popover = createPopover();
      const nodes = popover.getNodesForTests();

      popover.show();

      vi.spyOn(nodes.popover, 'getBoundingClientRect').mockReturnValue({
        width: 200,
        height: 120,
        top: 10,
        left: 10,
        right: 210,
        bottom: 130,
        x: 10,
        y: 10,
        toJSON: () => ({}),
      } as DOMRect);

      popover.destroy();

      expect(document.body.contains(nodes.popover)).toBe(true);

      nodes.popoverContainer.dispatchEvent(new Event('transitionend'));

      expect(document.body.contains(nodes.popover)).toBe(false);
    });

    it('destroy() removes the element synchronously when it has no visible box', () => {
      const popover = createPopover();
      const nodes = popover.getNodesForTests();

      popover.show();

      // jsdom default rect is 0×0 → no animation → immediate removal.
      popover.destroy();

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
      expect(element?.getAttribute(DATA_ATTR.popoverItemActive)).toBe('true');

      popover.invokeHandleItemClick(toggleItem);
      expect(element?.getAttribute(DATA_ATTR.popoverItemActive)).toBeNull();
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
      expect(firstEl?.getAttribute(DATA_ATTR.popoverItemActive)).toBe('true');
      expect(secondEl?.getAttribute(DATA_ATTR.popoverItemActive)).toBeNull();

      popover.invokeHandleItemClick(second);
      expect(secondEl?.getAttribute(DATA_ATTR.popoverItemActive)).toBe('true');
      expect(firstEl?.getAttribute(DATA_ATTR.popoverItemActive)).toBeNull();
    });

    it('exposes members of an exclusive string-key toggle group as role="menuitemradio"', () => {
      const popover = createPopover({
        items: [
          { title: 'Left', name: 'left', toggle: 'align', onActivate: vi.fn() },
          { title: 'Center', name: 'center', toggle: 'align', onActivate: vi.fn() },
          { title: 'Right', name: 'right', toggle: 'align', onActivate: vi.fn() },
        ],
      });
      const items = popover.getItemsForTests() as PopoverItemDefault[];

      items.forEach(item => {
        expect(item.getElement()?.getAttribute('role')).toBe('menuitemradio');
      });
    });

    it('keeps a degenerate single-member string-key toggle group as role="menuitemcheckbox"', () => {
      const popover = createPopover({
        items: [
          { title: 'Solo', name: 'solo', toggle: 'align', onActivate: vi.fn() },
        ],
      });
      const item = popover.getItemsForTests()[0] as PopoverItemDefault;

      expect(item.getElement()?.getAttribute('role')).toBe('menuitemcheckbox');
    });

    it('keeps a boolean toggle item as role="menuitemcheckbox"', () => {
      const popover = createPopover({
        items: [
          { title: 'Bold', name: 'bold', toggle: true, onActivate: vi.fn() },
        ],
      });
      const item = popover.getItemsForTests()[0] as PopoverItemDefault;

      expect(item.getElement()?.getAttribute('role')).toBe('menuitemcheckbox');
    });

    it('syncs aria-checked across a menuitemradio toggle group on click', () => {
      const popover = createPopover({
        items: [
          { title: 'Left', name: 'left', toggle: 'align', onActivate: vi.fn() },
          { title: 'Right', name: 'right', toggle: 'align', onActivate: vi.fn() },
        ],
      });
      const [first, second] = popover.getItemsForTests() as PopoverItemDefault[];

      popover.invokeHandleItemClick(first);
      expect(first.getElement()?.getAttribute('aria-checked')).toBe('true');
      expect(second.getElement()?.getAttribute('aria-checked')).toBe('false');

      popover.invokeHandleItemClick(second);
      expect(second.getElement()?.getAttribute('aria-checked')).toBe('true');
      expect(first.getElement()?.getAttribute('aria-checked')).toBe('false');
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

      expect(nodes.popover).not.toHaveAttribute(DATA_ATTR.popoverOpened);
      expect(closedOnActivateHandler).toHaveBeenCalledWith(undefined);
    });
  });

  describe('toggleItemHiddenByName()', () => {
    it('hides items matching the given name', () => {
      const popover = createPopover({
        items: [
          { title: 'First', name: 'first', onActivate: vi.fn() },
          { title: 'Table', name: 'table', onActivate: vi.fn() },
        ],
      });

      popover.toggleItemHiddenByName('table', true);

      const tableItem = popover.getItemsForTests()[1] as PopoverItemDefault;
      const element = tableItem.getElement();

      expect(element).toHaveAttribute(DATA_ATTR.hidden, 'true');
    });

    it('shows items matching the given name when isHidden is false', () => {
      const popover = createPopover({
        items: [
          { title: 'First', name: 'first', onActivate: vi.fn() },
          { title: 'Table', name: 'table', onActivate: vi.fn() },
        ],
      });

      // Hide then show
      popover.toggleItemHiddenByName('table', true);
      popover.toggleItemHiddenByName('table', false);

      const tableItem = popover.getItemsForTests()[1] as PopoverItemDefault;
      const element = tableItem.getElement();

      expect(element).not.toHaveAttribute(DATA_ATTR.hidden);
    });

    it('toggles all items when multiple items share the same name', () => {
      const popover = createPopover({
        items: [
          { title: 'Table 1', name: 'table', onActivate: vi.fn() },
          { title: 'Other', name: 'other', onActivate: vi.fn() },
          { title: 'Table 2', name: 'table', onActivate: vi.fn() },
        ],
      });

      popover.toggleItemHiddenByName('table', true);

      const items = popover.getItemsForTests();
      const table1 = (items[0] as PopoverItemDefault).getElement();
      const other = (items[1] as PopoverItemDefault).getElement();
      const table2 = (items[2] as PopoverItemDefault).getElement();

      expect(table1).toHaveAttribute(DATA_ATTR.hidden, 'true');
      expect(other).not.toHaveAttribute(DATA_ATTR.hidden);
      expect(table2).toHaveAttribute(DATA_ATTR.hidden, 'true');
    });

    it('does nothing when no items match the name', () => {
      const popover = createPopover({
        items: [
          { title: 'First', name: 'first', onActivate: vi.fn() },
        ],
      });

      // Should not throw
      popover.toggleItemHiddenByName('nonexistent', true);

      const firstItem = popover.getItemsForTests()[0] as PopoverItemDefault;
      const element = firstItem.getElement();

      expect(element).not.toHaveAttribute(DATA_ATTR.hidden);
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

  describe('nothing found message visibility', () => {
    it('shows and hides nothing found message without animation', () => {
      const popover = createPopover({ items: createDefaultItems() });
      const nodes = popover.getNodesForTests();

      popover.invokeToggleNothingFoundMessage(true);

      expect(nodes.nothingFoundMessage.classList.contains('hidden')).toBe(false);

      popover.invokeToggleNothingFoundMessage(false);

      expect(nodes.nothingFoundMessage.classList.contains('hidden')).toBe(true);
    });
  });

  describe('scroll reel distortion', () => {
    /**
     * Mocks the scroll metrics of the items container
     * @param items - the popover items container
     * @param metrics - scrollHeight / clientHeight / scrollTop to report
     */
    const setContainerMetrics = (
      items: HTMLElement,
      metrics: { scrollHeight?: number; clientHeight?: number; scrollTop?: number } = {}
    ): void => {
      Object.defineProperty(items, 'scrollHeight', { value: metrics.scrollHeight ?? 500, configurable: true });
      Object.defineProperty(items, 'clientHeight', { value: metrics.clientHeight ?? 200, configurable: true });
      Object.defineProperty(items, 'scrollTop', { value: metrics.scrollTop ?? 0, configurable: true, writable: true });
    };

    /**
     * Mocks layout metrics of a single popover item element
     * @param el - the item element
     * @param top - offsetTop within the items container
     * @param height - offsetHeight of the item
     */
    const setItemMetrics = (el: HTMLElement, top: number, height: number): void => {
      Object.defineProperty(el, 'offsetTop', { value: top, configurable: true });
      Object.defineProperty(el, 'offsetHeight', { value: height, configurable: true });
    };

    /**
     * Expected transform string for a given clipped fraction
     * @param overhang - fraction of the item clipped past the viewport edge (0..1)
     * @param edge - which viewport edge clips the item
     */
    const expectedTransform = (overhang: number, edge: 'top' | 'bottom'): string => {
      const tilt = (REEL_DISTORTION.maxTiltDeg * overhang * (edge === 'top' ? 1 : -1)).toFixed(2);
      const scaleX = (1 - REEL_DISTORTION.maxSquashX * overhang).toFixed(3);
      const scaleY = (1 - REEL_DISTORTION.maxSquashY * overhang).toFixed(3);

      return `perspective(${REEL_DISTORTION.perspective}px) rotateX(${tilt}deg) scaleX(${scaleX}) scaleY(${scaleY})`;
    };

    it('keeps the distortion strengths within realistic reel bounds', () => {
      // A real picker reel bends items subtly — extreme values read as a glitch.
      expect(REEL_DISTORTION.maxTiltDeg).toBeLessThanOrEqual(30);
      expect(REEL_DISTORTION.maxSquashY).toBeLessThanOrEqual(0.5);
      expect(REEL_DISTORTION.maxSquashX).toBeLessThanOrEqual(0.15);
      expect(REEL_DISTORTION.maxDim).toBeLessThanOrEqual(0.55);
      // Shallow perspective exaggerates the tilt; keep the camera far enough away
      expect(REEL_DISTORTION.perspective).toBeGreaterThanOrEqual(600);
    });

    it('does not render gradient haze overlays anymore', () => {
      const popover = createPopover();
      const nodes = popover.getNodesForTests();

      const overlays = Array.from(nodes.popoverContainer.children)
        .filter((el): el is HTMLElement => el instanceof HTMLElement)
        .filter(el => el.style.background.includes('linear-gradient'));

      expect(overlays).toHaveLength(0);
    });

    it('leaves items fully inside the viewport undistorted', () => {
      const popover = createPopover();
      const nodes = popover.getNodesForTests();
      const first = nodes.items.children[0] as HTMLElement;

      setContainerMetrics(nodes.items, { scrollTop: 100 });
      setItemMetrics(first, 150, 40);

      popover.show();

      expect(first.style.transform).toBe('');
      expect(first.style.opacity).toBe('');
    });

    it('squashes an item clipped by the top edge toward its bottom edge', () => {
      const popover = createPopover();
      const nodes = popover.getNodesForTests();
      const first = nodes.items.children[0] as HTMLElement;

      setContainerMetrics(nodes.items, { scrollTop: 100 });
      // Item spans 80..120 while viewport starts at 100 → half clipped above
      setItemMetrics(first, 80, 40);

      popover.show();

      expect(first.style.transform).toBe(expectedTransform(0.5, 'top'));
      expect(first.style.transformOrigin).toBe('center bottom');
      expect(Number(first.style.opacity)).toBeCloseTo(1 - REEL_DISTORTION.maxDim * 0.5, 3);
    });

    it('squashes an item clipped by the bottom edge toward its top edge', () => {
      const popover = createPopover();
      const nodes = popover.getNodesForTests();
      const second = nodes.items.children[1] as HTMLElement;

      setContainerMetrics(nodes.items, { scrollTop: 0 });
      // Viewport ends at 200; item spans 180..220 → half clipped below
      setItemMetrics(second, 180, 40);

      popover.show();

      expect(second.style.transform).toBe(expectedTransform(0.5, 'bottom'));
      expect(second.style.transformOrigin).toBe('center top');
    });

    it('distorts more the deeper an item slides past the edge', () => {
      const popover = createPopover();
      const nodes = popover.getNodesForTests();
      const first = nodes.items.children[0] as HTMLElement;
      const second = nodes.items.children[1] as HTMLElement;

      setContainerMetrics(nodes.items, { scrollTop: 100 });
      // First is 75% clipped above, second only 25%
      setItemMetrics(first, 70, 40);
      setItemMetrics(second, 90, 40);

      popover.show();

      expect(first.style.transform).toBe(expectedTransform(0.75, 'top'));
      expect(second.style.transform).toBe(expectedTransform(0.25, 'top'));
    });

    it('applies no distortion when items do not overflow', () => {
      const popover = createPopover();
      const nodes = popover.getNodesForTests();
      const first = nodes.items.children[0] as HTMLElement;

      setContainerMetrics(nodes.items, { scrollHeight: 200, clientHeight: 200, scrollTop: 0 });
      setItemMetrics(first, -20, 40);

      popover.show();

      expect(first.style.transform).toBe('');
    });

    it('updates the distortion on scroll events', () => {
      const popover = createPopover();
      const nodes = popover.getNodesForTests();
      const first = nodes.items.children[0] as HTMLElement;

      Object.defineProperty(nodes.items, 'scrollHeight', { value: 500, configurable: true });
      Object.defineProperty(nodes.items, 'clientHeight', { value: 200, configurable: true });

      let scrollTopValue = 0;

      Object.defineProperty(nodes.items, 'scrollTop', {
        get: () => scrollTopValue,
        configurable: true,
      });

      setItemMetrics(first, 0, 40);

      popover.show();

      // At the top the first item is fully visible
      expect(first.style.transform).toBe('');

      // Scrolling 20px clips half of the first item above the edge
      scrollTopValue = 20;
      nodes.items.dispatchEvent(new Event('scroll'));

      expect(first.style.transform).toBe(expectedTransform(0.5, 'top'));
      expect(first.style.transformOrigin).toBe('center bottom');

      // Scrolling back restores the item
      scrollTopValue = 0;
      nodes.items.dispatchEvent(new Event('scroll'));

      expect(first.style.transform).toBe('');
    });

    it('clears the distortion on hide', () => {
      const popover = createPopover();
      const nodes = popover.getNodesForTests();
      const first = nodes.items.children[0] as HTMLElement;

      setContainerMetrics(nodes.items, { scrollTop: 100 });
      setItemMetrics(first, 80, 40);

      popover.show();

      expect(first.style.transform).not.toBe('');

      popover.hide();

      expect(first.style.transform).toBe('');
      expect(first.style.opacity).toBe('');
    });
  });

  describe('registry integration', () => {
    it('show() registers with registry when root popover with trigger', () => {
      const triggerElement = document.createElement('button');

      document.body.appendChild(triggerElement);

      const popover = createPopover({
        trigger: triggerElement,
        items: createDefaultItems(),
      });

      popover.show();

      expect(PopoverRegistry.instance.hasOpenPopovers()).toBe(true);
    });

    it('show() does NOT register when nested (nestingLevel > 0)', () => {
      const popover = createPopover({
        nestingLevel: 1,
        items: createDefaultItems(),
      });

      popover.show();

      expect(PopoverRegistry.instance.hasOpenPopovers()).toBe(false);
    });

    it('show() does NOT register when no trigger', () => {
      const popover = createPopover({
        items: createDefaultItems(),
      });

      popover.show();

      expect(PopoverRegistry.instance.hasOpenPopovers()).toBe(false);
    });

    it('hide() unregisters from registry', () => {
      const triggerElement = document.createElement('button');

      document.body.appendChild(triggerElement);

      const popover = createPopover({
        trigger: triggerElement,
        items: createDefaultItems(),
      });

      popover.show();

      expect(PopoverRegistry.instance.hasOpenPopovers()).toBe(true);

      popover.hide();

      expect(PopoverRegistry.instance.hasOpenPopovers()).toBe(false);
    });
  });
});
