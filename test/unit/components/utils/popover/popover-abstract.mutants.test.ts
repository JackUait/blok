import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { DATA_ATTR } from '../../../../../src/components/constants/data-attributes';
import {
  PopoverItemDefault,
  PopoverItemType,
  type PopoverItem
} from '../../../../../src/components/utils/popover/components/popover-item';
import { PopoverItemHtml } from '../../../../../src/components/utils/popover/components/popover-item/popover-item-html/popover-item-html';
import type { SearchInput } from '../../../../../src/components/utils/popover/components/search-input';
import { PopoverAbstract } from '../../../../../src/components/utils/popover/popover-abstract';
import { css, REEL_DISTORTION } from '../../../../../src/components/utils/popover/popover.const';
import { PopoverRegistry } from '../../../../../src/components/utils/popover/popover-registry';

import type { PopoverNodes, PopoverParams } from '@/types/utils/popover/popover';
import { PopoverEvent } from '@/types/utils/popover/popover-event';
import type { PopoverItemParams } from '@/types/utils/popover/popover-item';

/**
 * Concrete popover used to drive the abstract base. `showNestedItems` is
 * abstract and `onShow`/`onHide` are the documented subclass hooks, so all
 * three are implemented here rather than reached into from a test.
 */
class TestPopover extends PopoverAbstract {
  /** Items the base handed to the nested-popover hook, in call order. */
  public readonly nested: PopoverItem[] = [];

  /** Order in which the base called the subclass lifecycle hooks. */
  public readonly hookCalls: string[] = [];

  /**
   * Records the nested-open request the base made.
   * @param item - item whose children should be shown
   */
  protected override showNestedItems(item: PopoverItemDefault | PopoverItemHtml): void {
    this.nested.push(item);
  }

  /** Records that the base open sequence reached the subclass hook. */
  protected override onShow(): void {
    this.hookCalls.push(`onShow:${String(this.isShown)}`);
  }

  /** Records that the base close sequence reached the subclass hook. */
  protected override onHide(): void {
    this.hookCalls.push(`onHide:${String(this.isShown)}`);
  }

  /** DOM refs the base class built. */
  public get testNodes(): PopoverNodes {
    return this.nodes;
  }

  /** Items the base class built. */
  public get testItems(): PopoverItem[] {
    return this.items;
  }

  /**
   * Installs a search widget the way a searchable subclass does.
   * @param search - search widget, or undefined for none
   */
  public setTestSearch(search: SearchInput | undefined): void {
    this.search = search;
  }

  /**
   * Drives the protected open-top state the positioning subclasses use.
   * @param openTop - true when the popover opens above its trigger
   */
  public setTestOpenTop(openTop: boolean): void {
    this.setOpenTop(openTop);
  }

  /**
   * Drives the protected open-left state the positioning subclasses use.
   * @param openLeft - true when the popover opens left of its trigger
   */
  public setTestOpenLeft(openLeft: boolean): void {
    this.setOpenLeft(openLeft);
  }

  /**
   * Drives the protected empty-state toggle the filtering subclasses use.
   * @param isDisplayed - true when the empty-state message should show
   */
  public setTestNothingFound(isDisplayed: boolean): void {
    this.toggleNothingFoundMessage(isDisplayed);
  }

  /**
   * Exposes the protected hidden-by-name query subclasses filter with.
   * @param name - item name to query
   */
  public isTestNamePermanentlyHidden(name: string): boolean {
    return this.isNamePermanentlyHidden(name);
  }
}

const makePopover = (params: PopoverParams): TestPopover => {
  const popover = new TestPopover(params);

  document.body.appendChild(popover.getElement());

  return popover;
};

const asDefaultItem = (item: PopoverItem | undefined): PopoverItemDefault => {
  if (!(item instanceof PopoverItemDefault)) {
    throw new Error('Expected a default popover item');
  }

  return item;
};

const rootOf = (item: PopoverItem | undefined): HTMLElement => {
  if (item === undefined) {
    throw new Error('Expected an item');
  }

  const el = item.getElement();

  if (el === null) {
    throw new Error('Expected an item element');
  }

  return el;
};

const clickItem = (popover: TestPopover, index: number): void => {
  rootOf(popover.testItems[index]).dispatchEvent(new MouseEvent('click', {
    bubbles: true,
    composed: true,
  }));
};

/** Gives an element a measurable scroll box, which jsdom otherwise reports as 0. */
const stubMetrics = (
  el: HTMLElement,
  metrics: { clientHeight?: number; scrollHeight?: number; offsetTop?: number; offsetHeight?: number }
): void => {
  Object.entries(metrics).forEach(([key, value]) => {
    Object.defineProperty(el, key, {
      value,
      configurable: true,
    });
  });
};

/** Builds a tablist element of the shape the convert menu renders. */
const makeTabs = (selected: string, other: string): HTMLElement => {
  const tabs = document.createElement('div');

  tabs.setAttribute('data-blok-popover-tabs', '');
  [selected, other].forEach(group => {
    const tab = document.createElement('button');

    tab.setAttribute('role', 'tab');
    tab.setAttribute('data-blok-popover-tab', group);
    tab.setAttribute('aria-selected', String(group === selected));
    tabs.appendChild(tab);
  });

  return tabs;
};

const tabbedItems = (tabs: HTMLElement): PopoverItemParams[] => [
  { type: PopoverItemType.Html,
    element: tabs },
  { title: 'H1',
    name: 'h1',
    dataset: { 'blok-popover-tab': 'heading' } },
  { title: 'Toggle H1',
    name: 'toggle-h1',
    dataset: { 'blok-popover-tab': 'toggle-heading' } },
  { title: 'Plain',
    name: 'plain' },
];

const errors: ErrorEvent[] = [];
const recordError = (event: ErrorEvent): void => {
  errors.push(event);
};

describe('PopoverAbstract', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    errors.length = 0;
    window.addEventListener('error', recordError);
    PopoverRegistry.resetForTests();
  });

  afterEach(() => {
    window.removeEventListener('error', recordError);
    vi.restoreAllMocks();
    vi.useRealTimers();
    document.body.innerHTML = '';
    expect(errors).toHaveLength(0);
  });

  describe('messages', () => {
    it('overrides only the supplied messages and keeps the built-in back label', () => {
      const popover = makePopover({
        items: [{ title: 'A' }],
        messages: { nothingFound: 'Пусто',
          actions: 'Действия' },
      });

      expect(popover.testNodes.nothingFoundMessage.textContent).toBe('Пусто');
      expect(popover.testNodes.items.getAttribute('aria-label')).toBe('Действия');
    });

    it('keeps the built-in back label when the override explicitly clears it', () => {
      const popover = makePopover({
        items: [{ title: 'A' }],
        messages: { back: undefined,
          nothingFound: 'None' },
      });

      expect(popover.testNodes.nothingFoundMessage.textContent).toBe('None');
    });
  });

  describe('buildItems', () => {
    it('builds one instance per params entry, keeping the declared order and types', () => {
      const custom = document.createElement('span');

      custom.textContent = 'custom';

      const popover = makePopover({
        items: [
          { title: 'A' },
          { type: PopoverItemType.Separator },
          { type: PopoverItemType.Html,
            element: custom },
          { type: PopoverItemType.Default,
            title: 'B' },
        ],
      });

      expect(popover.testItems).toHaveLength(4);
      expect(popover.testItems[0]).toBeInstanceOf(PopoverItemDefault);
      expect(popover.testItems[2]).toBeInstanceOf(PopoverItemHtml);
      expect(popover.testItems[3]).toBeInstanceOf(PopoverItemDefault);
      expect(popover.testNodes.items.children).toHaveLength(4);
      expect(popover.testNodes.items.children[2].contains(custom)).toBe(true);
    });

    it('gives default items the option role inside a listbox popover', () => {
      const popover = makePopover({ items: [{ title: 'A' }],
        listbox: true });

      expect(rootOf(popover.testItems[0]).getAttribute('role')).toBe('option');
      expect(popover.testNodes.items.getAttribute('role')).toBe('listbox');
    });

    it('gives default items the menuitem role in a menu popover', () => {
      const popover = makePopover({ items: [{ title: 'A' }] });

      expect(rootOf(popover.testItems[0]).getAttribute('role')).toBe('menuitem');
      expect(popover.testNodes.items.getAttribute('role')).toBe('menu');
      expect(popover.testNodes.items.getAttribute('tabindex')).toBe('0');
    });
  });

  describe('separators', () => {
    it('marks a separator as presentational inside a listbox popover', () => {
      const popover = makePopover({
        items: [{ title: 'A' }, { type: PopoverItemType.Separator }],
        listbox: true,
      });

      expect(rootOf(popover.testItems[1]).getAttribute('role')).toBe('presentation');
    });

    it('keeps the separator role in a menu popover', () => {
      const popover = makePopover({
        items: [{ title: 'A' }, { type: PopoverItemType.Separator }],
      });

      expect(rootOf(popover.testItems[1]).getAttribute('role')).toBe('separator');
    });
  });

  describe('appendItemElements', () => {
    it('mounts the item mount element rather than its focusable root', () => {
      const popover = makePopover({ items: [{ title: 'A' }] });
      const item = asDefaultItem(popover.testItems[0]);
      const mount = item.getMountElement();

      expect(mount).not.toBeNull();
      expect(popover.testNodes.items.children[0]).toBe(mount);
    });
  });

  describe('exclusive toggle roles', () => {
    it('promotes every member of a multi-member string toggle group to radio', () => {
      const popover = makePopover({
        items: [
          { title: 'Left',
            toggle: 'align' },
          { title: 'Center',
            toggle: 'align' },
          { title: 'Right',
            toggle: 'align' },
          { title: 'Lone',
            toggle: 'other' },
          { title: 'Bool',
            toggle: true },
        ],
      });

      expect(rootOf(popover.testItems[0]).getAttribute('role')).toBe('menuitemradio');
      expect(rootOf(popover.testItems[1]).getAttribute('role')).toBe('menuitemradio');
      expect(rootOf(popover.testItems[2]).getAttribute('role')).toBe('menuitemradio');
      expect(rootOf(popover.testItems[3]).getAttribute('role')).toBe('menuitemcheckbox');
      expect(rootOf(popover.testItems[4]).getAttribute('role')).toBe('menuitemcheckbox');
    });

    it('reports the initial checked state when promoting to radio', () => {
      const popover = makePopover({
        items: [
          { title: 'Left',
            toggle: 'align',
            isActive: true },
          { title: 'Center',
            toggle: 'align' },
        ],
      });

      expect(rootOf(popover.testItems[0]).getAttribute('aria-checked')).toBe('true');
      expect(rootOf(popover.testItems[1]).getAttribute('aria-checked')).toBe('false');
    });
  });

  describe('show()', () => {
    it('stamps the open state and merges the opened container classes', () => {
      const popover = makePopover({ items: [{ title: 'A' }] });

      expect(popover.isShown).toBe(false);

      popover.show();

      expect(popover.getElement().getAttribute(DATA_ATTR.popoverOpened)).toBe('true');
      expect(popover.getElement().getAttribute('data-state')).toBe('open');
      expect(popover.isShown).toBe(true);
      expect(popover.testNodes.popoverContainer.className).toContain('opacity-100');
      expect(popover.testNodes.popoverContainer.className).toContain('pointer-events-auto');
      expect(popover.hookCalls).toEqual(['onShow:true']);
    });

    it('mounts a detached popover into the body', () => {
      const popover = new TestPopover({ items: [{ title: 'A' }] });

      expect(popover.getElement().isConnected).toBe(false);

      popover.show();

      expect(popover.getElement().parentElement).toBe(document.body);
    });

    it('takes the direction from the trigger ahead of every other source', () => {
      const trigger = document.createElement('div');
      const context = document.createElement('div');

      trigger.setAttribute('dir', 'rtl');
      context.setAttribute('dir', 'ltr');
      document.body.append(trigger, context);

      const popover = makePopover({ items: [{ title: 'A' }],
        trigger,
        leftAlignElement: context });

      popover.show();

      expect(popover.getElement().getAttribute('dir')).toBe('rtl');
    });

    it('falls back to the left-align element when there is no trigger', () => {
      const leftAlignElement = document.createElement('div');

      leftAlignElement.setAttribute('dir', 'rtl');
      document.body.appendChild(leftAlignElement);

      const popover = makePopover({ items: [{ title: 'A' }],
        leftAlignElement });

      popover.show();

      expect(popover.getElement().getAttribute('dir')).toBe('rtl');
    });

    it('falls back to the scope element when there is no trigger or left-align element', () => {
      const scopeElement = document.createElement('div');

      scopeElement.setAttribute('dir', 'rtl');
      document.body.appendChild(scopeElement);

      const popover = makePopover({ items: [{ title: 'A' }],
        scopeElement });

      popover.show();

      expect(popover.getElement().getAttribute('dir')).toBe('rtl');
    });

    it('ignores <body> as a scope element rather than reading a direction from it', () => {
      document.body.setAttribute('dir', 'rtl');

      const popover = makePopover({ items: [{ title: 'A' }],
        scopeElement: document.body });

      popover.show();

      expect(popover.getElement().hasAttribute('dir')).toBe(false);
      document.body.removeAttribute('dir');
    });

    it('takes the direction from the host element the popover is mounted in', () => {
      const host = document.createElement('div');

      host.setAttribute('dir', 'rtl');
      document.body.appendChild(host);

      const popover = new TestPopover({ items: [{ title: 'A' }] });

      host.appendChild(popover.getElement());
      popover.show();

      expect(popover.getElement().getAttribute('dir')).toBe('rtl');
    });

    it('prefers the configured direction over any live source', () => {
      const trigger = document.createElement('div');

      trigger.setAttribute('dir', 'rtl');
      document.body.appendChild(trigger);

      const popover = makePopover({ items: [{ title: 'A' }],
        trigger,
        direction: 'ltr' });

      popover.show();

      expect(popover.getElement().getAttribute('dir')).toBe('ltr');
    });

    it('registers a root popover that has a trigger with the registry', () => {
      const trigger = document.createElement('button');

      document.body.appendChild(trigger);

      const first = makePopover({ items: [{ title: 'A' }],
        trigger });
      const second = makePopover({ items: [{ title: 'B' }],
        trigger });

      first.show();
      second.show();

      expect(first.isShown).toBe(false);
      expect(second.isShown).toBe(true);
    });

    it('refreshes every dynamic item active state on open', () => {
      let active = false;
      const popover = makePopover({
        items: [{ title: 'A',
          isActive: () => active }],
      });

      popover.show();
      expect(rootOf(popover.testItems[0]).hasAttribute(DATA_ATTR.popoverItemActive)).toBe(false);

      popover.hide();
      active = true;
      popover.show();

      expect(rootOf(popover.testItems[0]).getAttribute(DATA_ATTR.popoverItemActive)).toBe('true');
    });

    it('focuses the search widget when one is installed', () => {
      const popover = makePopover({ items: [{ title: 'A' }] });
      const focus = vi.fn();
      const clear = vi.fn();

      popover.setTestSearch({ focus,
        clear } as unknown as SearchInput);

      popover.show();

      expect(focus).toHaveBeenCalledTimes(1);
      expect(clear).not.toHaveBeenCalled();
    });
  });

  describe('hide()', () => {
    it('clears every open marker and restores the base container class', () => {
      const popover = makePopover({ items: [{ title: 'A' }] });

      popover.show();
      popover.setTestOpenTop(true);
      popover.setTestOpenLeft(true);
      popover.hide();

      expect(popover.getElement().hasAttribute(DATA_ATTR.popoverOpened)).toBe(false);
      expect(popover.getElement().hasAttribute(DATA_ATTR.popoverOpenTop)).toBe(false);
      expect(popover.getElement().hasAttribute(DATA_ATTR.popoverOpenLeft)).toBe(false);
      expect(popover.getElement().getAttribute('data-state')).toBe('closed');
      expect(popover.testNodes.popoverContainer.className).toBe(css.popoverContainer);
      expect(popover.isShown).toBe(false);
    });

    it('emits Closed once per close', () => {
      const popover = makePopover({ items: [{ title: 'A' }] });
      const onClosed = vi.fn();

      popover.on(PopoverEvent.Closed, onClosed);
      popover.show();
      popover.hide();

      expect(onClosed).toHaveBeenCalledTimes(1);
    });

    it('runs the subclass hook before the Closed event', () => {
      const popover = makePopover({ items: [{ title: 'A' }] });
      const order: string[] = [];

      popover.on(PopoverEvent.Closed, () => order.push('closed'));
      popover.show();
      popover.hookCalls.length = 0;
      popover.hide();
      order.unshift(...popover.hookCalls);

      expect(order).toEqual(['onHide:false', 'closed']);
    });

    it('clears the search widget', () => {
      const popover = makePopover({ items: [{ title: 'A' }] });
      const clear = vi.fn();

      popover.setTestSearch({ focus: vi.fn(),
        clear } as unknown as SearchInput);

      popover.show();
      popover.hide();

      expect(clear).toHaveBeenCalledTimes(1);
    });

    it('unregisters from the registry so a later sibling does not reopen it', () => {
      const trigger = document.createElement('button');

      document.body.appendChild(trigger);

      const popover = makePopover({ items: [{ title: 'A' }],
        trigger });
      const spy = vi.spyOn(popover, 'hide');

      popover.show();
      popover.hide();
      spy.mockClear();

      const other = makePopover({ items: [{ title: 'B' }],
        trigger });

      other.show();

      expect(spy).not.toHaveBeenCalled();
    });

    it('is safe to close a popover that was never opened', () => {
      const popover = makePopover({ items: [{ title: 'A' }] });

      popover.hide();

      expect(popover.isShown).toBe(false);
      expect(popover.getElement().getAttribute('data-state')).toBe('closed');
    });
  });

  describe('item clicks', () => {
    it('runs the activation handler of the clicked item only', () => {
      const first = vi.fn();
      const second = vi.fn();
      const popover = makePopover({
        items: [
          { title: 'A',
            name: 'a',
            onActivate: first },
          { title: 'B',
            name: 'b',
            onActivate: second },
        ],
      });

      clickItem(popover, 0);

      expect(first).toHaveBeenCalledTimes(1);
      expect(second).not.toHaveBeenCalled();
    });

    it('resolves the item from a click on its descendant', () => {
      const onActivate = vi.fn();
      const popover = makePopover({ items: [{ title: 'A',
        onActivate }] });
      const deepest = rootOf(popover.testItems[0]).querySelector('*');

      expect(deepest).not.toBeNull();
      deepest?.dispatchEvent(new MouseEvent('click', { bubbles: true,
        composed: true }));

      expect(onActivate).toHaveBeenCalledTimes(1);
    });

    it('ignores a click on a disabled item', () => {
      const onActivate = vi.fn();
      const popover = makePopover({
        items: [{ title: 'A',
          isDisabled: true,
          onActivate }],
      });

      clickItem(popover, 0);

      expect(onActivate).not.toHaveBeenCalled();
    });

    it('opens the nested popover and still runs the handler for an item with children', () => {
      const onActivate = vi.fn();
      const popover = makePopover({
        items: [
          { title: 'Parent',
            onActivate,
            children: { items: [{ title: 'Child' }] } },
          { title: 'Sibling',
            toggle: true,
            isActive: true },
        ],
      });

      clickItem(popover, 0);

      expect(popover.nested).toEqual([popover.testItems[0]]);
      expect(onActivate).toHaveBeenCalledTimes(1);
      expect(rootOf(popover.testItems[1]).hasAttribute(DATA_ATTR.popoverItemActive)).toBe(true);
    });

    it('toggles a boolean-toggle item on and off', () => {
      const popover = makePopover({ items: [{ title: 'A',
        toggle: true }] });
      const root = rootOf(popover.testItems[0]);

      clickItem(popover, 0);
      expect(root.getAttribute(DATA_ATTR.popoverItemActive)).toBe('true');

      clickItem(popover, 0);
      expect(root.hasAttribute(DATA_ATTR.popoverItemActive)).toBe(false);
    });

    it('deactivates the other members of the clicked radio group', () => {
      const popover = makePopover({
        items: [
          { title: 'Left',
            toggle: 'align' },
          { title: 'Center',
            toggle: 'align' },
        ],
      });

      clickItem(popover, 0);
      clickItem(popover, 1);

      expect(rootOf(popover.testItems[0]).hasAttribute(DATA_ATTR.popoverItemActive)).toBe(false);
      expect(rootOf(popover.testItems[1]).getAttribute(DATA_ATTR.popoverItemActive)).toBe('true');
      expect(rootOf(popover.testItems[0]).getAttribute('aria-checked')).toBe('false');
      expect(rootOf(popover.testItems[1]).getAttribute('aria-checked')).toBe('true');
    });

    it('closes on activation and emits ClosedOnActivate after Closed', () => {
      const popover = makePopover({
        items: [{ title: 'A',
          closeOnActivate: true }],
      });
      const order: string[] = [];

      popover.on(PopoverEvent.Closed, () => order.push('closed'));
      popover.on(PopoverEvent.ClosedOnActivate, () => order.push('closedOnActivate'));
      popover.show();
      clickItem(popover, 0);

      expect(order).toEqual(['closed', 'closedOnActivate']);
      expect(popover.isShown).toBe(false);
    });

    it('stays open and emits nothing when the item does not close on activation', () => {
      const popover = makePopover({ items: [{ title: 'A' }] });
      const onClosed = vi.fn();

      popover.on(PopoverEvent.ClosedOnActivate, onClosed);
      popover.show();
      clickItem(popover, 0);

      expect(popover.isShown).toBe(true);
      expect(onClosed).not.toHaveBeenCalled();
    });
  });

  describe('confirmation announcement', () => {
    it('clears the live region then writes the confirmation title on the next task', async () => {
      const popover = makePopover({
        items: [{
          title: 'Delete',
          confirmation: { title: 'Click to confirm',
            onActivate: vi.fn() },
        }],
      });
      const announcer = popover.testNodes.resultsAnnouncer;

      expect(announcer).toBeDefined();
      if (announcer === undefined) {
        throw new Error('Expected a results announcer');
      }

      announcer.textContent = 'stale';
      clickItem(popover, 0);

      expect(announcer.textContent).toBe('');

      await new Promise(resolve => setTimeout(resolve, 0));

      expect(announcer.textContent).toBe('Click to confirm');
    });

    it('says nothing when the confirmation prompt carries no title', async () => {
      const popover = makePopover({
        items: [{
          title: 'Delete',
          confirmation: { onActivate: vi.fn() },
        }],
      });
      const announcer = popover.testNodes.resultsAnnouncer;

      if (announcer === undefined) {
        throw new Error('Expected a results announcer');
      }

      announcer.textContent = 'kept';
      clickItem(popover, 0);

      expect(announcer.textContent).toBe('kept');

      await new Promise(resolve => setTimeout(resolve, 0));

      expect(announcer.textContent).toBe('kept');
    });

    it('does not announce for an item that has no confirmation state', async () => {
      const popover = makePopover({ items: [{ title: 'A' }] });
      const announcer = popover.testNodes.resultsAnnouncer;

      if (announcer === undefined) {
        throw new Error('Expected a results announcer');
      }

      announcer.textContent = 'kept';
      clickItem(popover, 0);
      await new Promise(resolve => setTimeout(resolve, 0));

      expect(announcer.textContent).toBe('kept');
    });
  });

  describe('activateItemByName', () => {
    it('activates the named item', () => {
      const onActivate = vi.fn();
      const popover = makePopover({
        items: [
          { title: 'A',
            name: 'a' },
          { title: 'B',
            name: 'b',
            onActivate },
        ],
      });

      popover.activateItemByName('b');

      expect(onActivate).toHaveBeenCalledTimes(1);
    });

    it('does nothing for a name no item carries', () => {
      const onActivate = vi.fn();
      const popover = makePopover({ items: [{ title: 'A',
        name: 'a',
        onActivate }] });

      popover.activateItemByName('missing');

      expect(onActivate).not.toHaveBeenCalled();
    });

    it('activates the first item when several share the name', () => {
      const first = vi.fn();
      const second = vi.fn();
      const popover = makePopover({
        items: [
          { title: 'A',
            name: 'dup',
            onActivate: first },
          { title: 'B',
            name: 'dup',
            onActivate: second },
        ],
      });

      popover.activateItemByName('dup');

      expect(first).toHaveBeenCalledTimes(1);
      expect(second).not.toHaveBeenCalled();
    });
  });

  describe('toggleItemHiddenByName', () => {
    it('hides every item carrying the name and leaves the rest alone', () => {
      const popover = makePopover({
        items: [
          { title: 'A',
            name: 'dup' },
          { title: 'B',
            name: 'dup' },
          { title: 'C',
            name: 'other' },
        ],
      });

      popover.toggleItemHiddenByName('dup', true);

      expect(rootOf(popover.testItems[0]).getAttribute(DATA_ATTR.hidden)).toBe('true');
      expect(rootOf(popover.testItems[1]).getAttribute(DATA_ATTR.hidden)).toBe('true');
      expect(rootOf(popover.testItems[2]).hasAttribute(DATA_ATTR.hidden)).toBe(false);
      expect(popover.isTestNamePermanentlyHidden('dup')).toBe(true);
      expect(popover.isTestNamePermanentlyHidden('other')).toBe(false);
    });

    it('forgets the permanent hidden mark when the item is shown again', () => {
      const popover = makePopover({ items: [{ title: 'A',
        name: 'a' }] });

      popover.toggleItemHiddenByName('a', true);
      popover.toggleItemHiddenByName('a', false);

      expect(rootOf(popover.testItems[0]).hasAttribute(DATA_ATTR.hidden)).toBe(false);
      expect(popover.isTestNamePermanentlyHidden('a')).toBe(false);
    });
  });

  describe('tab filtering', () => {
    it('hides items belonging to the unselected tab as soon as they are mounted', () => {
      const popover = makePopover({ items: tabbedItems(makeTabs('heading', 'toggle-heading')) });

      expect(rootOf(popover.testItems[1]).hasAttribute(DATA_ATTR.hidden)).toBe(false);
      expect(rootOf(popover.testItems[2]).getAttribute(DATA_ATTR.hidden)).toBe('true');
      expect(rootOf(popover.testItems[3]).hasAttribute(DATA_ATTR.hidden)).toBe(false);
    });

    it('follows the selection when the tablist reports a change', () => {
      const tabs = makeTabs('heading', 'toggle-heading');
      const popover = makePopover({ items: tabbedItems(tabs) });
      const tabButtons = tabs.querySelectorAll('[role="tab"]');

      tabButtons[0].setAttribute('aria-selected', 'false');
      tabButtons[1].setAttribute('aria-selected', 'true');
      tabs.dispatchEvent(new Event('blok-popover-tabs-change', { bubbles: true }));

      expect(rootOf(popover.testItems[1]).getAttribute(DATA_ATTR.hidden)).toBe('true');
      expect(rootOf(popover.testItems[2]).hasAttribute(DATA_ATTR.hidden)).toBe(false);
    });

    it('scrolls back to the top of the list when the tab changes', () => {
      const tabs = makeTabs('heading', 'toggle-heading');
      const popover = makePopover({ items: tabbedItems(tabs) });

      popover.testNodes.items.scrollTop = 120;
      tabs.dispatchEvent(new Event('blok-popover-tabs-change', { bubbles: true }));

      expect(popover.testNodes.items.scrollTop).toBe(0);
    });

    it('ignores a tabs-change event fired by a tablist outside this popover', () => {
      const tabs = makeTabs('heading', 'toggle-heading');
      const popover = makePopover({ items: tabbedItems(tabs) });
      const foreignTabs = makeTabs('toggle-heading', 'heading');

      popover.testNodes.items.scrollTop = 90;
      popover.testNodes.popoverContainer.appendChild(foreignTabs);
      foreignTabs.dispatchEvent(new Event('blok-popover-tabs-change', { bubbles: true }));

      expect(popover.testNodes.items.scrollTop).toBe(90);
    });

    it('ignores a tabs-change event that did not come from a tablist', () => {
      const tabs = makeTabs('heading', 'toggle-heading');
      const popover = makePopover({ items: tabbedItems(tabs) });
      const tab = tabs.querySelector('[role="tab"]');

      popover.testNodes.items.scrollTop = 90;
      tab?.dispatchEvent(new Event('blok-popover-tabs-change', { bubbles: true }));

      expect(popover.testNodes.items.scrollTop).toBe(90);
    });

    it('keeps a permanently hidden item hidden even when its tab is selected', () => {
      const tabs = makeTabs('heading', 'toggle-heading');
      const popover = makePopover({ items: tabbedItems(tabs) });

      popover.toggleItemHiddenByName('h1', true);
      tabs.dispatchEvent(new Event('blok-popover-tabs-change', { bubbles: true }));

      expect(rootOf(popover.testItems[1]).getAttribute(DATA_ATTR.hidden)).toBe('true');
    });

    it('ignores a tabs-change event owned by a nested popover inside this one', () => {
      const tabs = makeTabs('heading', 'toggle-heading');
      const popover = makePopover({ items: tabbedItems(tabs) });
      const nestedItems = document.createElement('div');
      const nestedTabs = makeTabs('toggle-heading', 'heading');

      nestedItems.setAttribute(DATA_ATTR.popoverItems, '');
      nestedItems.appendChild(nestedTabs);
      popover.testNodes.items.appendChild(nestedItems);
      popover.testNodes.items.scrollTop = 77;

      nestedTabs.dispatchEvent(new Event('blok-popover-tabs-change', { bubbles: true }));

      expect(popover.testNodes.items.scrollTop).toBe(77);
    });

    it('shows every tab family while the selected tab declares no family', () => {
      const tabs = document.createElement('div');
      const selected = document.createElement('button');

      tabs.setAttribute('data-blok-popover-tabs', '');
      selected.setAttribute('role', 'tab');
      selected.setAttribute('aria-selected', 'true');
      tabs.appendChild(selected);

      const popover = makePopover({ items: tabbedItems(tabs) });

      expect(rootOf(popover.testItems[1]).hasAttribute(DATA_ATTR.hidden)).toBe(false);
      expect(rootOf(popover.testItems[2]).hasAttribute(DATA_ATTR.hidden)).toBe(false);
    });

    it('leaves an item that declares no tab family untouched by a tab change', () => {
      const tabs = makeTabs('heading', 'toggle-heading');
      const popover = makePopover({ items: tabbedItems(tabs) });
      const strayItem = rootOf(popover.testItems[2]);

      expect(strayItem.getAttribute(DATA_ATTR.hidden)).toBe('true');

      strayItem.removeAttribute('data-blok-popover-tab');
      tabs.dispatchEvent(new Event('blok-popover-tabs-change', { bubbles: true }));

      expect(strayItem.getAttribute(DATA_ATTR.hidden)).toBe('true');
    });

    it('re-measures the scrollbar and the reel after a tab change', () => {
      const tabs = makeTabs('heading', 'toggle-heading');
      const popover = makePopover({ items: tabbedItems(tabs) });
      const { items, scrollbarThumb } = popover.testNodes;

      if (scrollbarThumb === undefined) {
        throw new Error('Expected a scrollbar thumb');
      }

      stubMetrics(items, { clientHeight: 100,
        scrollHeight: 300,
        offsetTop: 0 });
      Array.from(items.children).forEach((child, index) => {
        if (child instanceof HTMLElement) {
          stubMetrics(child, { offsetTop: index * 40,
            offsetHeight: 40 });
        }
      });

      tabs.dispatchEvent(new Event('blok-popover-tabs-change', { bubbles: true }));

      expect(scrollbarThumb.hidden).toBe(false);
      expect(scrollbarThumb.style.height).toBe('33px');

      const clipped = items.children[2];

      expect(clipped).toBeInstanceOf(HTMLElement);
      if (!(clipped instanceof HTMLElement)) {
        throw new Error('Expected an element child');
      }
      expect(clipped.style.transform).toContain('rotateX(-12.50deg)');
    });

    it('leaves every item visible when the popover has no tablist', () => {
      const popover = makePopover({
        items: [{ title: 'A',
          dataset: { 'blok-popover-tab': 'heading' } }],
      });

      expect(rootOf(popover.testItems[0]).hasAttribute(DATA_ATTR.hidden)).toBe(false);
    });

    it('shows an item whose tab family matches even when no tab is selected', () => {
      const tabs = document.createElement('div');

      tabs.setAttribute('data-blok-popover-tabs', '');

      const popover = makePopover({ items: tabbedItems(tabs) });

      expect(rootOf(popover.testItems[1]).hasAttribute(DATA_ATTR.hidden)).toBe(false);
      expect(rootOf(popover.testItems[2]).hasAttribute(DATA_ATTR.hidden)).toBe(false);
    });
  });

  describe('nothing-found message', () => {
    it('shows the message and drops the list padding', () => {
      const popover = makePopover({ items: [{ title: 'A' }] });

      popover.show();
      popover.setTestNothingFound(true);

      expect(popover.testNodes.nothingFoundMessage.classList.contains('hidden')).toBe(false);
      expect(popover.testNodes.nothingFoundMessage.getAttribute(DATA_ATTR.nothingFoundDisplayed)).toBe('true');
      expect(popover.testNodes.items.classList.contains('pb-1.5')).toBe(false);
      expect(popover.testNodes.popoverContainer.classList.contains('px-1.5')).toBe(false);
    });

    it('restores the padding of an open popover when the message goes away', () => {
      const popover = makePopover({ items: [{ title: 'A' }] });

      popover.show();
      popover.setTestNothingFound(true);
      popover.setTestNothingFound(false);

      expect(popover.testNodes.nothingFoundMessage.classList.contains('hidden')).toBe(true);
      expect(popover.testNodes.nothingFoundMessage.hasAttribute(DATA_ATTR.nothingFoundDisplayed)).toBe(false);
      expect(popover.testNodes.items.classList.contains('pb-1.5')).toBe(true);
      expect(popover.testNodes.popoverContainer.classList.contains('px-1.5')).toBe(true);
    });
  });

  describe('open direction flags', () => {
    it('flags and clears the open-top state', () => {
      const popover = makePopover({ items: [{ title: 'A' }] });

      popover.setTestOpenTop(true);
      expect(popover.getElement().getAttribute(DATA_ATTR.popoverOpenTop)).toBe('true');

      popover.setTestOpenTop(false);
      expect(popover.getElement().hasAttribute(DATA_ATTR.popoverOpenTop)).toBe(false);
    });

    it('flags and clears the open-left state', () => {
      const popover = makePopover({ items: [{ title: 'A' }] });

      popover.setTestOpenLeft(true);
      expect(popover.getElement().getAttribute(DATA_ATTR.popoverOpenLeft)).toBe('true');

      popover.setTestOpenLeft(false);
      expect(popover.getElement().hasAttribute(DATA_ATTR.popoverOpenLeft)).toBe(false);
    });
  });

  describe('scroll activity', () => {
    it('marks the container while scrolling and clears the mark after the idle timeout', () => {
      vi.useFakeTimers();

      const popover = makePopover({ items: [{ title: 'A' }] });

      popover.testNodes.items.dispatchEvent(new Event('scroll'));

      expect(popover.testNodes.items.getAttribute(DATA_ATTR.scrolling)).toBe('');

      vi.advanceTimersByTime(599);
      expect(popover.testNodes.items.hasAttribute(DATA_ATTR.scrolling)).toBe(true);

      vi.advanceTimersByTime(1);
      expect(popover.testNodes.items.hasAttribute(DATA_ATTR.scrolling)).toBe(false);
    });
  });

  describe('scrollbar sizing', () => {
    it('shows the thumb sized and offset from the scroll metrics', () => {
      const popover = makePopover({ items: [{ title: 'A' }] });
      const { items, scrollbarThumb } = popover.testNodes;

      if (scrollbarThumb === undefined) {
        throw new Error('Expected a scrollbar thumb');
      }

      stubMetrics(items, { clientHeight: 200,
        scrollHeight: 800,
        offsetTop: 40 });
      items.scrollTop = 300;
      items.dispatchEvent(new Event('scroll'));

      expect(scrollbarThumb.hidden).toBe(false);
      expect(scrollbarThumb.style.height).toBe('50px');
      expect(scrollbarThumb.style.transform).toBe('translateY(115px)');
    });

    it('never draws the thumb shorter than the minimum grabbable height', () => {
      const popover = makePopover({ items: [{ title: 'A' }] });
      const { items, scrollbarThumb } = popover.testNodes;

      if (scrollbarThumb === undefined) {
        throw new Error('Expected a scrollbar thumb');
      }

      stubMetrics(items, { clientHeight: 100,
        scrollHeight: 5000,
        offsetTop: 0 });
      items.scrollTop = 0;
      items.dispatchEvent(new Event('scroll'));

      expect(scrollbarThumb.style.height).toBe('24px');
      expect(scrollbarThumb.style.transform).toBe('translateY(0px)');
    });

    it('hides the thumb when the content fits', () => {
      const popover = makePopover({ items: [{ title: 'A' }] });
      const { items, scrollbarThumb } = popover.testNodes;

      if (scrollbarThumb === undefined) {
        throw new Error('Expected a scrollbar thumb');
      }

      stubMetrics(items, { clientHeight: 200,
        scrollHeight: 200 });
      items.dispatchEvent(new Event('scroll'));

      expect(scrollbarThumb.hidden).toBe(true);
    });
  });

  describe('scrollbar drag', () => {
    const pointer = (type: string, clientY: number): PointerEvent =>
      new MouseEvent(type, { bubbles: true,
        clientY }) as PointerEvent;

    it('maps thumb movement onto the scroll offset and ends on pointerup', () => {
      const popover = makePopover({ items: [{ title: 'A' }] });
      const { items, scrollbarThumb } = popover.testNodes;

      if (scrollbarThumb === undefined) {
        throw new Error('Expected a scrollbar thumb');
      }

      stubMetrics(items, { clientHeight: 100,
        scrollHeight: 200 });
      items.scrollTop = 0;

      scrollbarThumb.dispatchEvent(pointer('pointerdown', 10));

      expect(scrollbarThumb.getAttribute(DATA_ATTR.popoverScrollbarDragging)).toBe('');

      scrollbarThumb.dispatchEvent(pointer('pointermove', 30));

      expect(items.scrollTop).toBe(40);

      scrollbarThumb.dispatchEvent(pointer('pointerup', 30));

      expect(scrollbarThumb.hasAttribute(DATA_ATTR.popoverScrollbarDragging)).toBe(false);

      scrollbarThumb.dispatchEvent(pointer('pointermove', 90));

      expect(items.scrollTop).toBe(40);
    });

    it('does not scroll on movement that never began with a press', () => {
      const popover = makePopover({ items: [{ title: 'A' }] });
      const { items, scrollbarThumb } = popover.testNodes;

      if (scrollbarThumb === undefined) {
        throw new Error('Expected a scrollbar thumb');
      }

      stubMetrics(items, { clientHeight: 100,
        scrollHeight: 300 });
      items.scrollTop = 5;

      scrollbarThumb.dispatchEvent(pointer('pointermove', 200));

      expect(items.scrollTop).toBe(5);
    });
  });

  describe('scroll reel distortion', () => {
    it('curls an item clipped by the top edge back over the reel', () => {
      const popover = makePopover({
        items: [{ title: 'A' }, { title: 'B' }],
      });
      const { items } = popover.testNodes;
      const first = rootOf(popover.testItems[0]);
      const second = rootOf(popover.testItems[1]);

      stubMetrics(items, { clientHeight: 100,
        scrollHeight: 300 });
      stubMetrics(first, { offsetTop: 0,
        offsetHeight: 40 });
      stubMetrics(second, { offsetTop: 40,
        offsetHeight: 40 });
      items.scrollTop = 20;
      items.dispatchEvent(new Event('scroll'));

      const overhang = 0.5;

      expect(first.style.transform).toBe(
        `perspective(${REEL_DISTORTION.perspective}px) rotateX(${(REEL_DISTORTION.maxTiltDeg * overhang).toFixed(2)}deg) `
        + `scaleX(${(1 - REEL_DISTORTION.maxSquashX * overhang).toFixed(3)}) `
        + `scaleY(${(1 - REEL_DISTORTION.maxSquashY * overhang).toFixed(3)})`
      );
      expect(first.style.transformOrigin).toBe('center bottom');
      expect(first.style.opacity).toBe('0.75');
      expect(second.style.transform).toBe('');
    });

    it('curls an item clipped by the bottom edge the other way', () => {
      const popover = makePopover({
        items: [{ title: 'A' }, { title: 'B' }],
      });
      const { items } = popover.testNodes;
      const second = rootOf(popover.testItems[1]);

      stubMetrics(items, { clientHeight: 100,
        scrollHeight: 300 });
      stubMetrics(rootOf(popover.testItems[0]), { offsetTop: 0,
        offsetHeight: 40 });
      stubMetrics(second, { offsetTop: 80,
        offsetHeight: 40 });
      items.scrollTop = 0;
      items.dispatchEvent(new Event('scroll'));

      expect(second.style.transform).toContain(`rotateX(${(-REEL_DISTORTION.maxTiltDeg * 0.5).toFixed(2)}deg)`);
      expect(second.style.transformOrigin).toBe('center top');
    });

    it('clears the distortion from every item when the popover closes', () => {
      const popover = makePopover({ items: [{ title: 'A' }] });
      const { items } = popover.testNodes;
      const first = rootOf(popover.testItems[0]);

      stubMetrics(items, { clientHeight: 100,
        scrollHeight: 300 });
      stubMetrics(first, { offsetTop: 0,
        offsetHeight: 40 });
      items.scrollTop = 20;
      items.dispatchEvent(new Event('scroll'));

      expect(first.style.transform).not.toBe('');

      popover.hide();

      expect(first.style.transform).toBe('');
      expect(first.style.transformOrigin).toBe('');
      expect(first.style.opacity).toBe('');
    });
  });

  describe('destroy()', () => {
    it('removes a never-opened popover from the DOM immediately', () => {
      const popover = makePopover({ items: [{ title: 'A' }] });

      popover.destroy();

      expect(popover.getElement().isConnected).toBe(false);
      expect(popover.getElement().getAttribute('data-state')).toBe('closed');
    });

    it('stops handling clicks once destroyed', () => {
      const onActivate = vi.fn();
      const popover = makePopover({ items: [{ title: 'A',
        onActivate }] });
      const root = rootOf(popover.testItems[0]);

      popover.destroy();
      root.dispatchEvent(new MouseEvent('click', { bubbles: true,
        composed: true }));

      expect(onActivate).not.toHaveBeenCalled();
    });

    it('cancels a pending scroll-activity timeout', () => {
      vi.useFakeTimers();

      const popover = makePopover({ items: [{ title: 'A' }] });
      const { items } = popover.testNodes;

      items.dispatchEvent(new Event('scroll'));
      popover.destroy();
      vi.advanceTimersByTime(1000);

      expect(items.getAttribute(DATA_ATTR.scrolling)).toBe('');
    });

    it('is safe to destroy twice', () => {
      const popover = makePopover({ items: [{ title: 'A' }] });

      popover.destroy();
      popover.destroy();

      expect(popover.getElement().isConnected).toBe(false);
    });

    it('plays the exit transition for a visible popover and removes it once', () => {
      const popover = makePopover({ items: [{ title: 'A' }] });

      popover.show();
      vi.spyOn(popover.getElement(), 'getBoundingClientRect').mockReturnValue({
        x: 0,
        y: 0,
        left: 0,
        top: 0,
        width: 280,
        height: 120,
        right: 280,
        bottom: 120,
        toJSON: () => ({}),
      });

      const removeSpy = vi.spyOn(popover.getElement(), 'remove');

      popover.destroy();

      expect(popover.getElement().isConnected).toBe(true);
      expect(popover.testNodes.popoverContainer.className).toBe(css.popoverContainer);

      popover.testNodes.popoverContainer.dispatchEvent(new Event('transitionend'));
      popover.testNodes.popoverContainer.dispatchEvent(new Event('animationend'));

      expect(removeSpy).toHaveBeenCalledTimes(1);
    });

    it('removes a visible popover on the fallback timeout when no exit event fires', () => {
      vi.useFakeTimers();

      const popover = makePopover({ items: [{ title: 'A' }] });

      popover.show();
      vi.spyOn(popover.getElement(), 'getBoundingClientRect').mockReturnValue({
        x: 0,
        y: 0,
        left: 0,
        top: 0,
        width: 0,
        height: 120,
        right: 0,
        bottom: 120,
        toJSON: () => ({}),
      });

      popover.destroy();

      vi.advanceTimersByTime(399);
      expect(popover.getElement().isConnected).toBe(true);

      vi.advanceTimersByTime(1);
      expect(popover.getElement().isConnected).toBe(false);
    });
  });

  describe('miscellaneous public surface', () => {
    it('reports containment of its own descendants only', () => {
      const popover = makePopover({ items: [{ title: 'A' }] });
      const outside = document.createElement('div');

      document.body.appendChild(outside);

      expect(popover.hasNode(rootOf(popover.testItems[0]))).toBe(true);
      expect(popover.hasNode(popover.getElement())).toBe(true);
      expect(popover.hasNode(outside)).toBe(false);
    });

    it('mounts the same element it exposes', () => {
      const popover = makePopover({ items: [{ title: 'A' }] });

      expect(popover.getMountElement()).toBe(popover.getElement());
    });

    it('keeps focus inside itself by default', () => {
      const popover = makePopover({ items: [{ title: 'A' }] });

      expect(popover.getFocusHost()).toBeNull();
    });

    it('leaves every item alone when the base filter runs', () => {
      const popover = makePopover({
        items: [{ title: 'Alpha' }, { title: 'Beta' }],
      });

      popover.filterItems('zzz');

      expect(rootOf(popover.testItems[0]).hasAttribute(DATA_ATTR.hidden)).toBe(false);
      expect(rootOf(popover.testItems[1]).hasAttribute(DATA_ATTR.hidden)).toBe(false);
    });
  });
});
