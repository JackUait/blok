import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { DATA_ATTR } from '../../../src/components/constants/data-attributes';
import type { Listeners } from '../../../src/components/utils/listeners';
import {
  PopoverItemDefault,
  PopoverItemType,
  type PopoverItem
} from '../../../src/components/utils/popover/components/popover-item';
import type { SearchInput } from '../../../src/components/utils/popover/components/search-input';
import { PopoverAbstract } from '../../../src/components/utils/popover/popover-abstract';
import { PopoverRegistry } from '../../../src/components/utils/popover/popover-registry';
import { TOP_LAYER_MARKER_ATTR } from '../../../src/components/utils/top-layer';

import type { PopoverNodes, PopoverParams } from '@/types/utils/popover/popover';
import type { PopoverItemParams } from '@/types/utils/popover/popover-item';

/**
 * Concrete popover used to drive the abstract base through its public surface.
 * `showNestedItems` is abstract and `onShow` is the documented subclass hook,
 * so both are implemented here rather than reached into from a test.
 */
class TestPopover extends PopoverAbstract {
  public readonly onShowSpy = vi.fn<() => void>();

  /**
   * Required by the base class; no fixture here declares child items.
   */
  protected override showNestedItems(): void {
    // No nested popover to render.
  }

  /**
   * Records that the base open sequence reached the subclass hook.
   */
  protected override onShow(): void {
    this.onShowSpy();
  }

  /**
   * DOM refs the base class built.
   */
  public get testNodes(): PopoverNodes {
    return this.nodes;
  }

  /**
   * Items the base class built.
   */
  public get testItems(): PopoverItem[] {
    return this.items;
  }

  /**
   * Listener bookkeeping, so a test can prove a gesture's transient listeners
   * were torn down and not merely left inert.
   */
  public get testListeners(): Listeners {
    return this.listeners;
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
   * @param openLeft - true when the popover opens to the left of its trigger
   */
  public setTestOpenLeft(openLeft: boolean): void {
    this.setOpenLeft(openLeft);
  }

  /**
   * Drives the protected nothing-found toggle the filtering subclasses use.
   * @param isDisplayed - true when the empty-state message should show
   */
  public setTestNothingFound(isDisplayed: boolean): void {
    this.toggleNothingFoundMessage(isDisplayed);
  }
}

const makePopover = (params: PopoverParams): TestPopover => {
  const popover = new TestPopover(params);

  document.body.appendChild(popover.getElement());

  return popover;
};

const twoItems = (): PopoverItemParams[] => [
  { title: 'First',
    name: 'first',
    onActivate: vi.fn() },
  { title: 'Second',
    name: 'second',
    onActivate: vi.fn() },
];

const asDefaultItem = (item: PopoverItem | undefined): PopoverItemDefault => {
  if (!(item instanceof PopoverItemDefault)) {
    throw new Error('Expected a default popover item');
  }

  return item;
};

const rootOf = (item: PopoverItem): HTMLElement => {
  const element = item.getElement();

  if (element === null) {
    throw new Error('Expected the item to have a root element');
  }

  return element;
};

const isActiveItem = (item: PopoverItem): boolean =>
  rootOf(item).hasAttribute(DATA_ATTR.popoverItemActive);

/**
 * Stamps layout metrics jsdom never computes. Sizes are asymmetric on purpose:
 * equal viewport/content sizes collapse the scrollbar and reel arithmetic onto
 * the same result whatever the operators are.
 * @param el - element to stamp
 * @param metrics - layout numbers to expose
 */
const setMetrics = (
  el: HTMLElement,
  metrics: Partial<Record<'clientHeight' | 'scrollHeight' | 'offsetTop' | 'offsetHeight', number>>
): void => {
  for (const [name, value] of Object.entries(metrics)) {
    Object.defineProperty(el, name, {
      configurable: true,
      value,
    });
  }
};

const stubRect = (el: HTMLElement, width: number, height: number): void => {
  vi.spyOn(el, 'getBoundingClientRect').mockReturnValue({
    width,
    height,
    top: 10,
    left: 20,
    right: 20 + width,
    bottom: 10 + height,
    x: 20,
    y: 10,
    toJSON: () => ({}),
  });
};

/**
 * jsdom ships no Popover API, so `supportsPopoverAPI()` is false by default and
 * every top-layer branch is unreachable. Declaring the property makes the real
 * feature detection succeed without stubbing the top-layer module.
 */
const enablePopoverApi = (): void => {
  Object.defineProperty(HTMLElement.prototype, 'popover', {
    configurable: true,
    writable: true,
    value: null,
  });
};

const disablePopoverApi = (): void => {
  Reflect.deleteProperty(HTMLElement.prototype, 'popover');
};

const scroll = (el: HTMLElement, top: number): void => {
  Object.assign(el, { scrollTop: top });
  el.dispatchEvent(new Event('scroll'));
};

const pointer = (type: string, clientY: number): PointerEvent =>
  new PointerEvent(type, {
    bubbles: true,
    cancelable: true,
    pointerId: 7,
    clientY,
  });

const virtualRect = (): DOMRect => ({
  x: 30,
  y: 60,
  width: 120,
  height: 24,
  top: 60,
  right: 150,
  bottom: 84,
  left: 30,
  toJSON: () => ({}),
});

describe('PopoverAbstract — mutation coverage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    document.body.innerHTML = '';
    PopoverRegistry.resetForTests();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
    disablePopoverApi();
    document.documentElement.removeAttribute('dir');
    for (const stray of Array.from(document.documentElement.children)) {
      if (stray !== document.head && stray !== document.body) {
        stray.remove();
      }
    }
    document.body.innerHTML = '';
  });

  describe('root element construction', () => {
    it('leaves the root class untouched when no class is configured', () => {
      const popover = makePopover({ items: twoItems() });

      // A forced `class` write stamps the string "undefined" instead of nothing.
      expect(popover.getElement().className).toBe('');
      expect(popover.getElement().hasAttribute('data-blok-popover-custom-class')).toBe(false);
    });

    it('applies the configured class to both the className and the marker attribute', () => {
      const popover = makePopover({ items: twoItems(),
        class: 'my-popover' });

      expect(popover.getElement().className).toBe('my-popover');
      expect(popover.getElement().getAttribute('data-blok-popover-custom-class')).toBe('my-popover');
    });

    it('stamps the popover marker attributes with an empty value', () => {
      const popover = makePopover({ items: twoItems() });
      const nodes = popover.testNodes;

      expect(popover.getElement().getAttribute(DATA_ATTR.popover)).toBe('');
      expect(nodes.popoverContainer.getAttribute(DATA_ATTR.popoverContainer)).toBe('');
      expect(nodes.items.getAttribute(DATA_ATTR.popoverItems)).toBe('');
      expect(nodes.scrollbarThumb.getAttribute(DATA_ATTR.popoverScrollbar)).toBe('');
    });

    it('publishes every layout custom property the popover stylesheet reads', () => {
      const popover = makePopover({ items: twoItems(),
        width: '320px' });
      const style = popover.getElement().style;

      expect(style.getPropertyValue('--width')).toBe('320px');
      expect(style.getPropertyValue('--item-padding')).toBe('4px');
      expect(style.getPropertyValue('--item-height')).toBe('calc(1.75rem + 2 * var(--item-padding))');
      expect(style.getPropertyValue('--popover-top')).toBe('calc(100% + 0.5rem)');
      expect(style.getPropertyValue('--popover-left')).toBe('0');
      expect(style.getPropertyValue('--nested-popover-overlap')).toBe('0.25rem');
      expect(style.getPropertyValue('--max-height')).toBe('400px');
    });

    it('gives the container its shadow token and test id', () => {
      const nodes = makePopover({ items: twoItems() }).testNodes;

      expect(nodes.popoverContainer.style.boxShadow).toBe('var(--blok-popover-box-shadow)');
      expect(nodes.popoverContainer.dataset.blokTestid).toBe('popover-container');
    });

    it('renders the nothing-found message hidden and styled', () => {
      const nodes = makePopover({ items: twoItems() }).testNodes;

      expect(nodes.nothingFoundMessage.classList.contains('hidden')).toBe(true);
      expect(nodes.nothingFoundMessage.classList.contains('cursor-default')).toBe(true);
      expect(nodes.nothingFoundMessage.classList.contains('text-gray-text')).toBe(true);
      expect(nodes.nothingFoundMessage.dataset.blokTestid).toBe('popover-nothing-found');
      expect(nodes.popoverContainer.contains(nodes.nothingFoundMessage)).toBe(true);
    });

    it('falls back to the built-in empty-state text', () => {
      const withDefaults = makePopover({ items: twoItems() });
      const withoutOverride = makePopover({ items: twoItems(),
        messages: { nothingFound: undefined } });

      expect(withDefaults.testNodes.nothingFoundMessage.textContent).toBe('Nothing found');
      expect(withoutOverride.testNodes.nothingFoundMessage.textContent).toBe('Nothing found');
    });

    it('gives the items container its test id', () => {
      const nodes = makePopover({ items: twoItems() }).testNodes;

      expect(nodes.items.dataset.blokTestid).toBe('popover-items');
    });

    it('keeps the items container id empty when no listbox id is configured', () => {
      const nodes = makePopover({ items: twoItems() }).testNodes;

      // A forced write stamps the string "undefined" as the id.
      expect(nodes.items.id).toBe('');
    });

    it('exposes the items container as a focusable menu labelled by the actions message', () => {
      const nodes = makePopover({ items: twoItems() }).testNodes;

      expect(nodes.items.getAttribute('role')).toBe('menu');
      expect(nodes.items.getAttribute('aria-label')).toBe('Actions');
      // Items are all tabindex="-1", so the container is the only tab stop that
      // can reach overflowing options.
      expect(nodes.items.getAttribute('tabindex')).toBe('0');
    });

    it('prefers a configured actions message over the built-in label', () => {
      const nodes = makePopover({ items: twoItems(),
        messages: { actions: 'Block actions' } }).testNodes;

      expect(nodes.items.getAttribute('aria-label')).toBe('Block actions');
    });

    it('falls back to the built-in actions label when the message is cleared', () => {
      const nodes = makePopover({ items: twoItems(),
        messages: { actions: undefined } }).testNodes;

      expect(nodes.items.getAttribute('aria-label')).toBe('Actions');
    });

    it('leaves the items container role-less when the popover owns no selectable items', () => {
      const custom = document.createElement('div');
      const nodes = makePopover({
        items: [ { type: PopoverItemType.Html,
          element: custom,
          name: 'html' } ],
      }).testNodes;

      // role="menu"/"listbox" with zero menuitem/option children fails
      // axe's aria-required-children.
      expect(nodes.items.hasAttribute('role')).toBe(false);
      expect(nodes.items.hasAttribute('aria-label')).toBe(false);
      expect(nodes.items.hasAttribute('tabindex')).toBe(false);
    });

    it('renders the results announcer visually hidden', () => {
      const announcer = makePopover({ items: twoItems() }).testNodes.resultsAnnouncer;

      expect(announcer.getAttribute('role')).toBe('status');
      expect(announcer.style.position).toBe('absolute');
      expect(announcer.style.width).toBe('1px');
      expect(announcer.style.height).toBe('1px');
      expect(announcer.style.padding).toBe('0px');
      expect(announcer.style.margin).toBe('-1px');
      expect(announcer.style.overflow).toBe('hidden');
      expect(announcer.style.clipPath).toBe('inset(50%)');
      expect(announcer.style.whiteSpace).toBe('nowrap');
      expect(announcer.style.border).toBe('0px');
    });

    it('omits the context label element when no context label is configured', () => {
      const nodes = makePopover({ items: twoItems() }).testNodes;

      expect(nodes.contextLabel).toBeUndefined();
    });

    it('announces the context label as a status region', () => {
      const nodes = makePopover({ items: twoItems(),
        contextLabel: 'Heading 2' }).testNodes;
      const label = nodes.contextLabel;

      if (label === undefined) {
        throw new Error('Expected the context label element to exist');
      }

      expect(label.getAttribute('role')).toBe('status');
      expect(label.textContent).toBe('Heading 2');
    });

    it('starts with the scrollbar thumb hidden', () => {
      const nodes = makePopover({ items: twoItems() }).testNodes;

      expect(nodes.scrollbarThumb.hidden).toBe(true);
    });

  });

  describe('item roles', () => {
    it('keeps two boolean-toggle items as independent checkboxes', () => {
      const popover = makePopover({
        items: [
          { title: 'Bold',
            name: 'bold',
            toggle: true,
            onActivate: vi.fn() },
          { title: 'Italic',
            name: 'italic',
            toggle: true,
            onActivate: vi.fn() },
        ],
      });

      // Boolean toggles are independent; grouping them would announce a
      // radiogroup where selecting one deselects the other.
      expect(rootOf(popover.testItems[0]).getAttribute('role')).toBe('menuitemcheckbox');
      expect(rootOf(popover.testItems[1]).getAttribute('role')).toBe('menuitemcheckbox');
    });

    it('promotes a two-member string toggle group to radio semantics', () => {
      const popover = makePopover({
        items: [
          { title: 'Left',
            name: 'left',
            toggle: 'align',
            onActivate: vi.fn() },
          { title: 'Right',
            name: 'right',
            toggle: 'align',
            onActivate: vi.fn() },
        ],
      });

      expect(rootOf(popover.testItems[0]).getAttribute('role')).toBe('menuitemradio');
      expect(rootOf(popover.testItems[1]).getAttribute('role')).toBe('menuitemradio');
    });

    it('marks separators as presentational inside a listbox popover', () => {
      const popover = makePopover({
        listbox: true,
        items: [
          { type: PopoverItemType.Separator },
          { title: 'First',
            name: 'first',
            onActivate: vi.fn() },
        ],
      });

      expect(rootOf(popover.testItems[0]).getAttribute('role')).toBe('presentation');
    });

    it('keeps the separator role in a menu popover', () => {
      const popover = makePopover({
        items: [
          { type: PopoverItemType.Separator },
          { title: 'First',
            name: 'first',
            onActivate: vi.fn() },
        ],
      });

      expect(rootOf(popover.testItems[0]).getAttribute('role')).toBe('separator');
    });
  });

  describe('show() — mount target and direction owner', () => {
    it('keeps a popover mounted inside a host element out of <body>', () => {
      const host = document.createElement('div');

      document.body.appendChild(host);

      const popover = new TestPopover({ items: twoItems() });

      host.appendChild(popover.getElement());
      popover.show();

      // Re-parenting a hosted popover to <body> strands it outside its wrapper.
      expect(popover.getElement().parentElement).toBe(host);
    });

    it('does not treat <html> as the owning editor when the popover is mounted on it', () => {
      document.documentElement.setAttribute('dir', 'rtl');

      const popover = new TestPopover({ items: twoItems() });

      document.documentElement.appendChild(popover.getElement());
      popover.show();

      // The host document is not an editor, so its direction is not inherited.
      expect(popover.getElement().hasAttribute('dir')).toBe(false);
    });

    it('does not use <html> as the direction owner when it is passed as the scope', () => {
      document.documentElement.setAttribute('dir', 'rtl');

      const popover = makePopover({ items: twoItems(),
        scopeElement: document.documentElement });

      popover.show();

      expect(popover.getElement().hasAttribute('dir')).toBe(false);
    });
  });

  describe('show()/hide() — CSS top layer', () => {
    it('promotes a root popover that has a trigger', () => {
      enablePopoverApi();

      const trigger = document.createElement('button');

      document.body.appendChild(trigger);

      const popover = makePopover({ items: twoItems(),
        trigger });

      popover.show();

      expect(popover.getElement().getAttribute(TOP_LAYER_MARKER_ATTR)).toBe('true');
    });

    it('promotes a root popover positioned by a virtual rect', () => {
      enablePopoverApi();

      const context = document.createElement('div');

      document.body.appendChild(context);

      const popover = makePopover({
        items: twoItems(),
        position: virtualRect(),
        positionContext: context,
      });

      popover.show();

      expect(popover.getElement().getAttribute(TOP_LAYER_MARKER_ATTR)).toBe('true');
    });

    it('does not promote a nested popover', () => {
      enablePopoverApi();

      const trigger = document.createElement('button');

      document.body.appendChild(trigger);

      const popover = makePopover({ items: twoItems(),
        trigger,
        nestingLevel: 1 });

      popover.show();

      // Promoting a nested popover re-bases its containing block on the
      // viewport and breaks the parent-relative positioning math.
      expect(popover.getElement().hasAttribute(TOP_LAYER_MARKER_ATTR)).toBe(false);
    });

    it('does not promote a popover that has neither a trigger nor a position', () => {
      enablePopoverApi();

      const popover = makePopover({ items: twoItems() });

      popover.show();

      // Inline-toolbar popovers live inside their own wrapper; promoting them
      // leaves that wrapper empty and zero-sized.
      expect(popover.getElement().hasAttribute(TOP_LAYER_MARKER_ATTR)).toBe(false);
    });

    it('does not promote when the browser has no Popover API', () => {
      const trigger = document.createElement('button');

      document.body.appendChild(trigger);

      const popover = makePopover({ items: twoItems(),
        trigger });

      popover.show();

      expect(popover.getElement().hasAttribute(TOP_LAYER_MARKER_ATTR)).toBe(false);
    });

    it('takes a promoted popover back out of the top layer on hide', () => {
      enablePopoverApi();

      const trigger = document.createElement('button');

      document.body.appendChild(trigger);

      const popover = makePopover({ items: twoItems(),
        trigger });

      popover.show();
      expect(popover.getElement().getAttribute(TOP_LAYER_MARKER_ATTR)).toBe('true');

      popover.hide();

      expect(popover.getElement().hasAttribute(TOP_LAYER_MARKER_ATTR)).toBe(false);
      expect(popover.getElement().hasAttribute('popover')).toBe(false);
    });

    it('leaves the top-layer marker alone when the browser has no Popover API', () => {
      const popover = makePopover({ items: twoItems() });

      popover.getElement().setAttribute(TOP_LAYER_MARKER_ATTR, 'true');
      popover.hide();

      expect(popover.getElement().getAttribute(TOP_LAYER_MARKER_ATTR)).toBe('true');
    });
  });

  describe('show() — open sequence', () => {
    it('re-reads dynamic active state for every item', () => {
      let active = false;
      const popover = makePopover({
        items: [ { title: 'Bold',
          name: 'bold',
          isActive: () => active,
          onActivate: vi.fn() } ],
      });

      active = true;
      popover.show();

      expect(isActiveItem(popover.testItems[0])).toBe(true);
    });

    it('focuses the search widget and clears it again on hide', () => {
      const focus = vi.fn();
      const clear = vi.fn();
      const destroy = vi.fn();
      const popover = makePopover({ items: twoItems() });

      popover.setTestSearch({ focus,
        clear,
        destroy } as unknown as SearchInput);

      popover.show();
      expect(focus).toHaveBeenCalledTimes(1);

      popover.hide();
      expect(clear).toHaveBeenCalledTimes(1);
    });

    it('runs the subclass open hook', () => {
      const popover = makePopover({ items: twoItems() });

      popover.show();

      expect(popover.onShowSpy).toHaveBeenCalledTimes(1);
    });

    it('sizes the scrollbar synchronously, before the deferred frame', () => {
      const popover = makePopover({ items: twoItems() });
      const nodes = popover.testNodes;

      setMetrics(nodes.items, { clientHeight: 200,
        scrollHeight: 800,
        offsetTop: 36 });

      popover.show();

      expect(nodes.scrollbarThumb.hidden).toBe(false);
      expect(nodes.scrollbarThumb.style.height).toBe('50px');
    });

    it('re-measures the scrollbar on the next frame, once layout has settled', () => {
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'requestAnimationFrame', 'cancelAnimationFrame'] });

      const popover = makePopover({ items: twoItems() });
      const nodes = popover.testNodes;

      setMetrics(nodes.items, { clientHeight: 200,
        scrollHeight: 200,
        offsetTop: 36 });
      popover.show();
      expect(nodes.scrollbarThumb.hidden).toBe(true);

      setMetrics(nodes.items, { clientHeight: 200,
        scrollHeight: 800 });
      vi.advanceTimersByTime(50);

      expect(nodes.scrollbarThumb.hidden).toBe(false);
    });

    it('does not register a nested popover even when it has a trigger', () => {
      const trigger = document.createElement('button');

      document.body.appendChild(trigger);

      const popover = makePopover({ items: twoItems(),
        trigger,
        nestingLevel: 1 });

      popover.show();

      // Only a root popover with a trigger belongs in the registry stack.
      expect(PopoverRegistry.instance.hasOpenPopovers()).toBe(false);
    });
  });

  describe('hide()', () => {
    it('resets every item out of confirmation mode', () => {
      const popover = makePopover({
        items: [
          { title: 'Delete',
            name: 'delete',
            confirmation: { title: 'Click to confirm',
              onActivate: vi.fn() } },
        ],
      });
      const item = asDefaultItem(popover.testItems[0]);

      popover.activateItemByName('delete');
      expect(item.isConfirmationStateEnabled).toBe(true);

      popover.hide();

      // An item left armed acts on the first click after reopening.
      expect(item.isConfirmationStateEnabled).toBe(false);
    });
  });

  describe('scroll activity marker', () => {
    it('marks the items container as scrolling with an empty attribute value', () => {
      const popover = makePopover({ items: twoItems() });
      const nodes = popover.testNodes;

      scroll(nodes.items, 10);

      expect(nodes.items.getAttribute(DATA_ATTR.scrolling)).toBe('');
    });

    it('restarts the marker timeout on every scroll event', () => {
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });

      const popover = makePopover({ items: twoItems() });
      const nodes = popover.testNodes;

      scroll(nodes.items, 10);
      vi.advanceTimersByTime(500);
      scroll(nodes.items, 20);
      vi.advanceTimersByTime(150);

      // The first timeout must not survive the second scroll, or the thumb
      // vanishes mid-gesture.
      expect(nodes.items.getAttribute(DATA_ATTR.scrolling)).toBe('');
    });

    it('cancels the pending marker timeout on destroy', () => {
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });

      const popover = makePopover({ items: twoItems() });
      const nodes = popover.testNodes;

      scroll(nodes.items, 10);
      popover.destroy();
      vi.advanceTimersByTime(1000);

      // A timer that outlives destroy() touches DOM the popover no longer owns.
      expect(nodes.items.getAttribute(DATA_ATTR.scrolling)).toBe('');
    });

    it('updates the scrollbar on scroll', () => {
      const popover = makePopover({ items: twoItems() });
      const nodes = popover.testNodes;

      setMetrics(nodes.items, { clientHeight: 200,
        scrollHeight: 800,
        offsetTop: 36 });
      scroll(nodes.items, 0);

      expect(nodes.scrollbarThumb.hidden).toBe(false);
    });
  });

  describe('destroy()', () => {
    it('clears the opened marker before the exit animation plays', () => {
      const popover = makePopover({ items: twoItems() });
      const nodes = popover.testNodes;

      popover.show();
      stubRect(nodes.popover, 200, 120);
      popover.destroy();

      expect(nodes.popover.hasAttribute(DATA_ATTR.popoverOpened)).toBe(false);
    });

    it('removes the element exactly once however many exit signals arrive', () => {
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });

      const popover = makePopover({ items: twoItems() });
      const nodes = popover.testNodes;

      popover.show();
      stubRect(nodes.popover, 200, 120);

      const removeSpy = vi.spyOn(nodes.popover, 'remove');

      popover.destroy();
      nodes.popoverContainer.dispatchEvent(new Event('transitionend'));
      nodes.popoverContainer.dispatchEvent(new Event('animationend'));
      vi.advanceTimersByTime(500);

      expect(removeSpy).toHaveBeenCalledTimes(1);
    });

    it('removes the element when only an animation end arrives', () => {
      const popover = makePopover({ items: twoItems() });
      const nodes = popover.testNodes;

      popover.show();
      stubRect(nodes.popover, 200, 120);
      popover.destroy();
      nodes.popoverContainer.dispatchEvent(new Event('animationend'));

      expect(document.body.contains(nodes.popover)).toBe(false);
    });

    it('removes the element on the timeout when no exit event fires', () => {
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });

      const popover = makePopover({ items: twoItems() });
      const nodes = popover.testNodes;

      popover.show();
      stubRect(nodes.popover, 200, 120);
      popover.destroy();

      expect(document.body.contains(nodes.popover)).toBe(true);

      vi.advanceTimersByTime(400);

      expect(document.body.contains(nodes.popover)).toBe(false);
    });

    it('skips the exit animation for a detached popover', () => {
      const popover = makePopover({ items: twoItems() });
      const nodes = popover.testNodes;

      popover.show();
      nodes.popover.remove();
      stubRect(nodes.popover, 200, 120);
      popover.destroy();

      // An element already out of the document has nothing to animate, so the
      // opened container styling is never rewound.
      expect(nodes.popoverContainer.classList.contains('opacity-100')).toBe(true);
    });

    it('animates out a popover that is only as wide as its box', () => {
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });

      const popover = makePopover({ items: twoItems() });
      const nodes = popover.testNodes;

      popover.show();
      stubRect(nodes.popover, 120, 0);
      popover.destroy();

      expect(document.body.contains(nodes.popover)).toBe(true);
    });

    it('animates out a popover that is only as tall as its box', () => {
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });

      const popover = makePopover({ items: twoItems() });
      const nodes = popover.testNodes;

      popover.show();
      stubRect(nodes.popover, 0, 80);
      popover.destroy();

      expect(document.body.contains(nodes.popover)).toBe(true);
    });
  });

  describe('scrollbar sizing', () => {
    it('hides the thumb when the content exactly fills the viewport', () => {
      const popover = makePopover({ items: twoItems() });
      const nodes = popover.testNodes;

      setMetrics(nodes.items, { clientHeight: 200,
        scrollHeight: 200,
        offsetTop: 36 });
      popover.show();

      expect(nodes.scrollbarThumb.hidden).toBe(true);
    });

    it('hides the thumb while the viewport is still unmeasured', () => {
      const popover = makePopover({ items: twoItems() });
      const nodes = popover.testNodes;

      setMetrics(nodes.items, { clientHeight: 0,
        scrollHeight: 500,
        offsetTop: 36 });
      popover.show();

      // A zero viewport means layout has not run; sizing against it makes the
      // travel negative.
      expect(nodes.scrollbarThumb.hidden).toBe(true);
    });

    it('positions the thumb from the scroll offset and the items offset', () => {
      const popover = makePopover({ items: twoItems() });
      const nodes = popover.testNodes;

      setMetrics(nodes.items, { clientHeight: 200,
        scrollHeight: 800,
        offsetTop: 36 });
      scroll(nodes.items, 300);

      // thumb 50px, travel 150px, scrolled 300 of 600 => half travel + offset.
      expect(nodes.scrollbarThumb.style.height).toBe('50px');
      expect(nodes.scrollbarThumb.style.transform).toBe('translateY(111px)');
    });
  });

  describe('scrollbar drag', () => {
    const dragFixture = (): { popover: TestPopover; items: HTMLElement; thumb: HTMLElement } => {
      const popover = makePopover({ items: twoItems() });
      const { items, scrollbarThumb } = popover.testNodes;

      setMetrics(items, { clientHeight: 200,
        scrollHeight: 800,
        offsetTop: 36 });
      items.scrollTop = 40;

      return { popover,
        items,
        thumb: scrollbarThumb };
    };

    it('maps thumb movement onto the scroll offset through the content ratio', () => {
      const { items, thumb } = dragFixture();

      thumb.dispatchEvent(pointer('pointerdown', 100));
      thumb.dispatchEvent(pointer('pointermove', 130));

      // thumb 50px, travel 150px, ratio 600/150 = 4 => 40 + 30 * 4.
      expect(items.scrollTop).toBe(160);
    });

    it('marks the thumb as dragging with an empty attribute value', () => {
      const { thumb } = dragFixture();

      thumb.dispatchEvent(pointer('pointerdown', 100));

      expect(thumb.getAttribute(DATA_ATTR.popoverScrollbarDragging)).toBe('');
    });

    it('claims the pointerdown so the press does not also scroll the list', () => {
      const { thumb } = dragFixture();
      const event = pointer('pointerdown', 100);

      thumb.dispatchEvent(event);

      expect(event.defaultPrevented).toBe(true);
    });

    it('ignores movement when the thumb fills the whole track', () => {
      const popover = makePopover({ items: twoItems() });
      const { items, scrollbarThumb } = popover.testNodes;

      setMetrics(items, { clientHeight: 200,
        scrollHeight: 200,
        offsetTop: 36 });
      items.scrollTop = 40;

      scrollbarThumb.dispatchEvent(pointer('pointerdown', 100));
      scrollbarThumb.dispatchEvent(pointer('pointermove', 130));

      // Zero travel would divide by zero and park the list at NaN.
      expect(items.scrollTop).toBe(40);
    });

    it('ends the drag on pointerup and stops following the pointer', () => {
      const { items, thumb } = dragFixture();

      thumb.dispatchEvent(pointer('pointerdown', 100));
      thumb.dispatchEvent(pointer('pointermove', 130));
      thumb.dispatchEvent(pointer('pointerup', 130));

      expect(thumb.hasAttribute(DATA_ATTR.popoverScrollbarDragging)).toBe(false);

      thumb.dispatchEvent(pointer('pointermove', 200));

      // Ending the session is what stops the list following the pointer.
      expect(items.scrollTop).toBe(160);
    });

    it('tears down the transient drag listeners when the gesture ends', () => {
      const { popover, thumb } = dragFixture();
      const errors: string[] = [];
      const onError = (event: Event): void => {
        errors.push(event instanceof ErrorEvent ? event.message : 'error');
      };

      thumb.dispatchEvent(pointer('pointerdown', 100));
      thumb.dispatchEvent(pointer('pointermove', 130));

      window.addEventListener('error', onError);
      thumb.dispatchEvent(pointer('pointerup', 130));
      window.removeEventListener('error', onError);

      expect(errors).toEqual([]);
      // Left registered, these accumulate one set per drag for the popover's
      // whole lifetime.
      expect(popover.testListeners.findAll(thumb, 'pointermove')).toHaveLength(0);
      expect(popover.testListeners.findAll(thumb, 'pointerup')).toHaveLength(0);
      expect(popover.testListeners.findAll(thumb, 'pointercancel')).toHaveLength(0);
    });

    it('tears down the transient drag listeners when the pointer is cancelled', () => {
      const { popover, thumb } = dragFixture();

      thumb.dispatchEvent(pointer('pointerdown', 100));
      thumb.dispatchEvent(pointer('pointercancel', 100));

      expect(popover.testListeners.findAll(thumb, 'pointermove')).toHaveLength(0);
      expect(popover.testListeners.findAll(thumb, 'pointercancel')).toHaveLength(0);
    });

    it('ends the drag when the pointer is cancelled', () => {
      const { items, thumb } = dragFixture();

      thumb.dispatchEvent(pointer('pointerdown', 100));
      thumb.dispatchEvent(pointer('pointercancel', 100));

      expect(thumb.hasAttribute(DATA_ATTR.popoverScrollbarDragging)).toBe(false);

      thumb.dispatchEvent(pointer('pointermove', 200));

      expect(items.scrollTop).toBe(40);
    });

    it('drags backwards as well as forwards', () => {
      const { items, thumb } = dragFixture();

      items.scrollTop = 400;
      thumb.dispatchEvent(pointer('pointerdown', 200));
      thumb.dispatchEvent(pointer('pointermove', 150));

      expect(items.scrollTop).toBe(200);
    });
  });

  describe('scroll reel distortion', () => {
    const reelFixture = (): { popover: TestPopover; items: HTMLElement; children: HTMLElement[] } => {
      const popover = makePopover({
        items: [
          { title: 'One',
            name: 'one',
            onActivate: vi.fn() },
          { title: 'Two',
            name: 'two',
            onActivate: vi.fn() },
          { title: 'Three',
            name: 'three',
            onActivate: vi.fn() },
        ],
      });
      const items = popover.testNodes.items;
      const children = popover.testItems.map(rootOf);

      setMetrics(items, { clientHeight: 100,
        scrollHeight: 300 });
      children.forEach((child, index) => {
        setMetrics(child, { offsetTop: index * 40,
          offsetHeight: 40 });
      });

      return { popover,
        items,
        children };
    };

    it('anchors an item clipped equally at both edges to its bottom edge', () => {
      const popover = makePopover({
        items: [ { title: 'Tall',
          name: 'tall',
          onActivate: vi.fn() } ],
      });
      const items = popover.testNodes.items;
      const child = rootOf(popover.testItems[0]);

      setMetrics(items, { clientHeight: 100,
        scrollHeight: 300 });
      setMetrics(child, { offsetTop: 50,
        offsetHeight: 200 });

      scroll(items, 100);

      // Clipped 50px above and 50px below: the tie resolves to the top-edge curl.
      expect(child.style.transformOrigin).toBe('center bottom');
      expect(child.style.transform).toBe('perspective(800px) rotateX(6.25deg) scaleX(0.975) scaleY(0.900)');
    });

    it('leaves an unmeasured item undistorted', () => {
      const { items, children } = reelFixture();

      setMetrics(children[0], { offsetHeight: 0 });
      scroll(items, 20);

      // Height 0 divides by zero and pins the item at full distortion.
      expect(children[0].style.transformOrigin).toBe('');
      expect(children[0].style.opacity).toBe('');
    });

    it('clears the distortion once the list stops overflowing', () => {
      const { items, children } = reelFixture();

      scroll(items, 20);
      expect(children[0].style.transformOrigin).toBe('center bottom');

      setMetrics(items, { scrollHeight: 100 });
      scroll(items, 0);

      expect(children[0].style.transform).toBe('');
      expect(children[0].style.transformOrigin).toBe('');
      expect(children[0].style.opacity).toBe('');
    });

    it('clears the distortion on hide', () => {
      const { popover, items, children } = reelFixture();

      scroll(items, 20);
      popover.hide();

      expect(children[0].style.transform).toBe('');
      expect(children[0].style.transformOrigin).toBe('');
      expect(children[0].style.opacity).toBe('');
    });

    it('leaves a non-HTML child of the items container alone', () => {
      const { popover, items } = reelFixture();
      const foreign = document.createElementNS('http://www.w3.org/2000/svg', 'svg');

      items.appendChild(foreign);
      foreign.style.opacity = '0.4';

      scroll(items, 20);
      expect(foreign.style.transformOrigin).toBe('');

      popover.hide();
      expect(foreign.style.opacity).toBe('0.4');
    });
  });

  describe('item clicks', () => {
    const confirmingPopover = (): {
      popover: TestPopover;
      plain: PopoverItemDefault;
      destructive: PopoverItemDefault;
      confirmSpy: ReturnType<typeof vi.fn>;
    } => {
      const confirmSpy = vi.fn();
      const popover = makePopover({
        items: [
          { title: 'Duplicate',
            name: 'duplicate',
            onActivate: vi.fn() },
          { title: 'Delete',
            name: 'delete',
            confirmation: { title: 'Click to confirm',
              onActivate: confirmSpy } },
        ],
      });

      return {
        popover,
        plain: asDefaultItem(popover.testItems[0]),
        destructive: asDefaultItem(popover.testItems[1]),
        confirmSpy,
      };
    };

    it('resets the other items when one is clicked', () => {
      const { popover, destructive } = confirmingPopover();

      popover.activateItemByName('delete');
      expect(destructive.isConfirmationStateEnabled).toBe(true);

      popover.activateItemByName('duplicate');

      // An armed item acts on its next single click.
      expect(destructive.isConfirmationStateEnabled).toBe(false);
    });

    it('does not reset the clicked item before running its handler', () => {
      const { popover, confirmSpy } = confirmingPopover();

      popover.activateItemByName('delete');
      popover.activateItemByName('delete');

      // Resetting the clicked item first disarms it, so the confirming second
      // click re-arms instead of acting.
      expect(confirmSpy).toHaveBeenCalledTimes(1);
    });

    it('refreshes the clicked item from its dynamic active callback', () => {
      let active = false;
      const popover = makePopover({
        items: [ { title: 'Bold',
          name: 'bold',
          isActive: () => active,
          onActivate: vi.fn() } ],
      });

      active = true;
      popover.activateItemByName('bold');

      expect(isActiveItem(popover.testItems[0])).toBe(true);
    });

    it('reads the clicked item dynamic active callback once per click', () => {
      const isActive = vi.fn(() => false);
      const popover = makePopover({
        items: [ { title: 'Bold',
          name: 'bold',
          isActive,
          onActivate: vi.fn() } ],
      });
      const before = isActive.mock.calls.length;

      popover.activateItemByName('bold');

      expect(isActive.mock.calls.length - before).toBe(1);
    });

    it('refreshes only the siblings whose active state is dynamic', () => {
      let siblingActive = false;
      const popover = makePopover({
        items: [
          { title: 'Clear',
            name: 'clear',
            onActivate: vi.fn() },
          { title: 'Bold',
            name: 'bold',
            isActive: () => siblingActive,
            onActivate: vi.fn() },
          { title: 'Link',
            name: 'link',
            onActivate: vi.fn() },
        ],
      });
      const staticSibling = asDefaultItem(popover.testItems[2]);

      staticSibling.toggleActive(true);
      siblingActive = true;

      popover.activateItemByName('clear');

      expect(isActiveItem(popover.testItems[1])).toBe(true);
      // A sibling with no isActive callback has no state to re-read; touching
      // it silently clears whatever the owner set.
      expect(isActiveItem(popover.testItems[2])).toBe(true);
    });

    it('activates a lone string-keyed toggle item and flips it back on a second click', () => {
      const popover = makePopover({
        items: [ { title: 'Highlight',
          name: 'highlight',
          toggle: 'marker',
          onActivate: vi.fn() } ],
      });

      popover.activateItemByName('highlight');
      expect(isActiveItem(popover.testItems[0])).toBe(true);

      popover.activateItemByName('highlight');
      // A degenerate one-member group behaves like a checkbox, so the second
      // click must switch it off.
      expect(isActiveItem(popover.testItems[0])).toBe(false);
    });

    it('limits radio behaviour to the members of the clicked item toggle group', () => {
      const popover = makePopover({
        items: [
          { title: 'Left',
            name: 'left',
            toggle: 'align',
            onActivate: vi.fn() },
          { title: 'Right',
            name: 'right',
            toggle: 'align',
            onActivate: vi.fn() },
          { title: 'Bold',
            name: 'bold',
            onActivate: vi.fn() },
        ],
      });
      const outsider = asDefaultItem(popover.testItems[2]);

      outsider.toggleActive(true);
      popover.activateItemByName('left');

      expect(isActiveItem(popover.testItems[0])).toBe(true);
      expect(isActiveItem(popover.testItems[1])).toBe(false);
      // An item outside the group is not a radio sibling and keeps its state.
      expect(isActiveItem(popover.testItems[2])).toBe(true);
    });

    it('ignores a click that lands on a separator', () => {
      const popover = makePopover({
        items: [
          { type: PopoverItemType.Separator },
          { title: 'Delete',
            name: 'delete',
            confirmation: { title: 'Click to confirm',
              onActivate: vi.fn() } },
        ],
      });
      const destructive = asDefaultItem(popover.testItems[1]);

      popover.activateItemByName('delete');
      expect(destructive.isConfirmationStateEnabled).toBe(true);

      rootOf(popover.testItems[0]).dispatchEvent(new MouseEvent('click', { bubbles: true }));

      // A separator is chrome: clicking it must not count as clicking an item.
      expect(destructive.isConfirmationStateEnabled).toBe(true);
    });

    it('ignores a click on popover chrome that belongs to no item', () => {
      const popover = makePopover({ items: twoItems() });
      const errors: string[] = [];
      const onError = (event: Event): void => {
        errors.push(event instanceof ErrorEvent ? event.message : 'error');
      };

      window.addEventListener('error', onError);
      popover.testNodes.popoverContainer.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      window.removeEventListener('error', onError);

      expect(errors).toEqual([]);
    });
  });

  describe('nothing-found message', () => {
    it('marks the message as displayed with the shown flag', () => {
      const popover = makePopover({ items: twoItems() });
      const nodes = popover.testNodes;

      popover.setTestNothingFound(true);

      expect(nodes.nothingFoundMessage.getAttribute(DATA_ATTR.nothingFoundDisplayed)).toBe('true');
      expect(nodes.nothingFoundMessage.classList.contains('hidden')).toBe(false);
    });

    it('does not re-pad a closed popover when the message is hidden again', () => {
      const popover = makePopover({ items: twoItems() });
      const nodes = popover.testNodes;

      popover.setTestNothingFound(true);
      popover.setTestNothingFound(false);

      // Horizontal padding belongs to the opened container styling.
      expect(nodes.popoverContainer.classList.contains('px-1.5')).toBe(false);
    });

  });

  describe('open direction flags', () => {
    it('flags and clears the open-top state', () => {
      const popover = makePopover({ items: twoItems() });

      popover.setTestOpenTop(true);
      expect(popover.getElement().getAttribute(DATA_ATTR.popoverOpenTop)).toBe('true');

      popover.setTestOpenTop(false);
      expect(popover.getElement().hasAttribute(DATA_ATTR.popoverOpenTop)).toBe(false);
    });

    it('flags and clears the open-left state', () => {
      const popover = makePopover({ items: twoItems() });

      popover.setTestOpenLeft(true);
      expect(popover.getElement().getAttribute(DATA_ATTR.popoverOpenLeft)).toBe('true');

      popover.setTestOpenLeft(false);
      expect(popover.getElement().hasAttribute(DATA_ATTR.popoverOpenLeft)).toBe(false);
    });
  });

  describe('focus host', () => {
    it('reports no external focus host for a base popover', () => {
      const popover = makePopover({ items: twoItems() });

      // Callers null-check the host; undefined is not null.
      expect(popover.getFocusHost()).toBeNull();
    });
  });

});
