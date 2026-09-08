import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import { Flipper } from '../../../src/components/flipper';
import { DomIterator } from '../../../src/components/domIterator';

/**
 * Mutation-focused companion suite for `src/components/flipper.ts`.
 *
 * Every test here asserts the COMPLETE produced state (the whole ordered list
 * of focused flags, the whole call list of a collaborator) rather than a single
 * "did it happen" probe, because a partial assertion cannot separate "moved to
 * the right item" from "moved to some item".
 *
 * PROVEN-EQUIVALENT MUTANTS (cannot be killed — evidence below):
 *
 * - 17 x OptionalChaining `this.iterator?.X` -> `this.iterator.X`
 *   (setItems, setCursor x2, setActiveDescendantHost, previous, next,
 *   setCursorToFirst, setCursorToLast, currentItem x6, dropCursor, getItems).
 *   `iterator` is declared `private readonly` and the constructor assigns it
 *   unconditionally to `new DomIterator(...)`, which never returns null, so the
 *   `?.` can never short-circuit.
 * - `focusItem`'s `if (!iterator) { return; }` — both the emptied block and the
 *   `if (false)` variant. Same reason: `iterator` is never null.
 * - `currentItemHasChildren`'s `if (!currentItem)` -> `if (false)`, its emptied
 *   `{ return false; }` block, and `return false` -> `return true`. The sole
 *   caller is the ArrowRight case, guarded by `this.iterator?.currentItem &&`,
 *   so the falsy branch is unreachable.
 * - `case null:` in the keydown switch, emptied. It is the last case and holds
 *   only `break;`; it is also unreachable, since `isEventReadyForHandling`
 *   requires `keyCode !== null`.
 * - The `{ return; }` after `this.typeAhead && this.handleTypeAhead(event)`.
 *   `handleTypeAhead` returns true only for a single-character `event.key`, and
 *   every key in `getKeyCode`'s map is multi-character, so falling through
 *   always lands on `keyCode === null` -> `!isReady` -> return.
 * - The three mutants on `keyCode !== null && Flipper.usedKeys.includes(keyCode)`
 *   (both `ConditionalExpression: true` variants and the `||` swap). That line
 *   is reached only when `isEventReadyForHandling` already proved
 *   `keyCode !== null`, and `getKeyCode` maps exactly the 8 codes that
 *   `usedKeys` lists, so both operands are always true.
 * - `isEventReadyForHandling`'s `keyCode !== null` -> `true`. The remaining
 *   `this.allowedKeys.includes(null)` is false for any `number[]`, so the result
 *   is unchanged.
 * - `handleEnterPress`'s `if (!this.activated)` -> `if (false)` and its emptied
 *   block, plus `if (this.iterator?.currentItem)` -> `if (true)`. Both call
 *   sites (the ENTER case and the ArrowRight case) already require an activated
 *   flipper with a current item.
 * - `handleTypeAhead`'s not-activated guard `return false` -> `return true`, and
 *   its final `return true` -> `return false`. A single-character key never maps
 *   to a keyCode, and a non-activated flipper never passes
 *   `isEventReadyForHandling`, so both answers funnel into the same "do nothing"
 *   tail of `onKeyDown`.
 * - `findTypeAheadMatch`'s `?? []` -> `?? ["Stryker was here"]` (getItems always
 *   returns an array) and `?? ''` -> `?? "Stryker was here!"` (Element
 *   textContent is a string, never null).
 */

const focusedClass = 'is-focused';
const FOCUSED_ATTR = 'data-blok-focused';

type KeydownOptions = {
  shiftKey?: boolean;
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
  target?: HTMLElement | null;
};

const createItems = (labels: string[]): HTMLElement[] => {
  return labels.map((label) => {
    const button = document.createElement('button');

    button.textContent = label;
    document.body.appendChild(button);

    return button;
  });
};

const createKeyboardEvent = (key: string, options: KeydownOptions = {}): KeyboardEvent => {
  const event = new KeyboardEvent('keydown', {
    key,
    bubbles: true,
    cancelable: true,
    shiftKey: options.shiftKey ?? false,
    ctrlKey: options.ctrlKey ?? false,
    metaKey: options.metaKey ?? false,
    altKey: options.altKey ?? false,
  });

  // `target: null` is a deliberate value here, so `??` must not fall back.
  const target = 'target' in options ? options.target : document.body;

  Object.defineProperty(event, 'target', {
    configurable: true,
    get: () => target,
  });

  return event;
};

/** The whole ordered roving-focus state, so a wrong item cannot pass. */
const focusedFlags = (items: HTMLElement[]): boolean[] => items.map(item => item.hasAttribute(FOCUSED_ATTR));

describe('Flipper — mutation coverage', () => {
  beforeAll(() => {
    // jsdom implements neither scrollIntoViewIfNeeded nor scrollIntoView, and
    // every flip scrolls the focused item. Stub the preferred one globally; the
    // fallback test overrides it per element.
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoViewIfNeeded', {
      configurable: true,
      value: vi.fn(),
    });
  });

  afterAll(() => {
    Reflect.deleteProperty(HTMLElement.prototype, 'scrollIntoViewIfNeeded');
  });

  beforeEach(() => {
    document.body.innerHTML = '';
    vi.clearAllMocks();
  });

  afterEach(() => {
    document.body.innerHTML = '';
    // Order matters: restoring a spy that was installed over a fake timer must
    // happen before the fakes are uninstalled, otherwise the restored (fake)
    // descriptor is written back on top of the real timers.
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  describe('construction options', () => {
    // Pins a latent defect: with no focusedItemClass the iterator calls
    // classList.add(''), which throws SyntaxError in every engine (the stub
    // below is what keeps this test from throwing). Update when it is fixed.
    it('calls classList.add with an empty token when focusedItemClass is omitted', () => {
      const items = createItems(['One', 'Two']);
      const add = vi.fn<(token: string) => void>();
      const remove = vi.fn<(token: string) => void>();

      Object.defineProperty(items[0], 'classList', {
        configurable: true,
        value: { add,
          remove },
      });

      const flipper = new Flipper({ items });

      flipper.flipRight();

      expect(add.mock.calls).toStrictEqual([['']]);
      expect(items[0]).toHaveAttribute(FOCUSED_ATTR, 'true');
    });

    it('starts with an empty item list when no items are passed', () => {
      const onFlip = vi.fn();
      const flipper = new Flipper({ focusedItemClass: focusedClass });

      flipper.onFlip(onFlip);
      flipper.activate();
      flipper.flipRight();

      expect(flipper.hasFocus()).toBe(false);
      expect(onFlip.mock.calls).toStrictEqual([[]]);

      flipper.deactivate();
    });

    it('keeps the contenteditable opt-in that was passed to the constructor', () => {
      const items = createItems(['One', 'Two']);
      const flipper = new Flipper({
        focusedItemClass: focusedClass,
        items,
        handleContentEditableTargets: true,
      });

      expect(flipper.getHandleContentEditableTargets()).toBe(true);

      flipper.setHandleContentEditableTargets(false);

      expect(flipper.getHandleContentEditableTargets()).toBe(false);
    });

    it('leaves typeahead disabled unless it is opted into', () => {
      const items = createItems(['Apple', 'Banana', 'Cherry']);
      const flipper = new Flipper({
        focusedItemClass: focusedClass,
        items,
      });

      flipper.activate();

      const event = createKeyboardEvent('b');

      flipper.handleExternalKeydown(event);

      expect(focusedFlags(items)).toStrictEqual([false, false, false]);
      expect(event.defaultPrevented).toBe(false);

      flipper.deactivate();
    });
  });

  describe('activate / deactivate', () => {
    it('does not touch the iterator cursor when no cursor position is given', () => {
      const items = createItems(['One', 'Two', 'Three']);
      const setCursor = vi.spyOn(DomIterator.prototype, 'setCursor');
      const flipper = new Flipper({
        focusedItemClass: focusedClass,
        items,
      });

      flipper.activate(items);

      expect(setCursor.mock.calls).toStrictEqual([]);

      flipper.activate(items, 1);

      expect(setCursor.mock.calls).toStrictEqual([[1]]);

      flipper.deactivate();
    });

    it('clears the pending Tab skip on deactivate', () => {
      const items = createItems(['One', 'Two', 'Three']);
      const flipper = new Flipper({
        focusedItemClass: focusedClass,
        items,
      });

      flipper.activate();
      flipper.deactivate();
      flipper.activate();
      flipper.handleExternalKeydown(createKeyboardEvent('Tab'));

      expect(focusedFlags(items)).toStrictEqual([true, false, false]);

      flipper.deactivate();
    });

    it('ignores every navigation keydown while deactivated', () => {
      const items = createItems(['One', 'Two', 'Three']);
      const onFlip = vi.fn();
      const flipper = new Flipper({
        focusedItemClass: focusedClass,
        items,
      });

      flipper.onFlip(onFlip);

      const event = createKeyboardEvent('ArrowDown');

      flipper.handleExternalKeydown(event);

      expect(focusedFlags(items)).toStrictEqual([false, false, false]);
      expect(onFlip.mock.calls).toStrictEqual([]);
      expect(event.defaultPrevented).toBe(false);
    });
  });

  describe('aria-activedescendant host', () => {
    it('mirrors the current item onto a host installed after activation', () => {
      const items = createItems(['One', 'Two']);
      const host = document.createElement('div');

      document.body.appendChild(host);

      const flipper = new Flipper({
        focusedItemClass: focusedClass,
        items,
      });

      flipper.activate();
      flipper.focusItem(1);
      flipper.setActiveDescendantHost(host);

      expect(items[1].id).not.toBe('');
      expect(host.getAttribute('aria-activedescendant')).toBe(items[1].id);
      expect(items[1].getAttribute('aria-selected')).toBe('true');

      flipper.deactivate();
    });
  });

  describe('focusFirst / focusItem', () => {
    it('focusFirst returns to the first item even when it is already focused', () => {
      const items = createItems(['One', 'Two', 'Three']);
      const flipper = new Flipper({
        focusedItemClass: focusedClass,
        items,
      });

      flipper.activate();
      flipper.focusItem(0);
      flipper.focusFirst();

      expect(focusedFlags(items)).toStrictEqual([true, false, false]);

      flipper.deactivate();
    });

    it('focusItem on an empty flipper leaves the next Tab press free', () => {
      const items = createItems(['One', 'Two', 'Three']);
      const flipper = new Flipper({ focusedItemClass: focusedClass });

      flipper.focusItem(0);
      flipper.activate(items);
      flipper.handleExternalKeydown(createKeyboardEvent('Tab'));

      expect(focusedFlags(items)).toStrictEqual([true, false, false]);

      flipper.deactivate();
    });

    it('focusItem clears the focus for any position below zero', () => {
      const items = createItems(['One', 'Two', 'Three']);
      const flipper = new Flipper({
        focusedItemClass: focusedClass,
        items,
      });

      flipper.activate();
      flipper.focusItem(1);

      expect(focusedFlags(items)).toStrictEqual([false, true, false]);

      flipper.focusItem(-2);

      expect(focusedFlags(items)).toStrictEqual([false, false, false]);

      flipper.deactivate();
    });

    it('focusItem beyond position zero leaves the next Tab press free', () => {
      const items = createItems(['One', 'Two', 'Three']);
      const flipper = new Flipper({
        focusedItemClass: focusedClass,
        items,
      });

      flipper.activate();
      flipper.focusItem(1);
      flipper.handleExternalKeydown(createKeyboardEvent('Tab'));

      expect(focusedFlags(items)).toStrictEqual([false, false, true]);

      flipper.deactivate();
    });
  });

  describe('flipLeft', () => {
    it('moves focus backwards and runs the flip callbacks', () => {
      const items = createItems(['One', 'Two', 'Three']);
      const onFlip = vi.fn();
      const flipper = new Flipper({
        focusedItemClass: focusedClass,
        items,
      });

      flipper.onFlip(onFlip);
      flipper.activate();
      flipper.focusItem(1);
      onFlip.mockClear();

      flipper.flipLeft();

      expect(focusedFlags(items)).toStrictEqual([true, false, false]);
      expect(onFlip.mock.calls).toStrictEqual([[]]);

      flipper.deactivate();
    });
  });

  describe('onFlip registration', () => {
    it('removeOnFlip removes only the requested callback', () => {
      const items = createItems(['One', 'Two']);
      const first = vi.fn();
      const second = vi.fn();
      const flipper = new Flipper({
        focusedItemClass: focusedClass,
        items,
      });

      flipper.onFlip(first);
      flipper.onFlip(second);
      flipper.removeOnFlip(first);
      flipper.activate();
      flipper.flipRight();

      expect(first.mock.calls).toStrictEqual([]);
      expect(second.mock.calls).toStrictEqual([[]]);

      flipper.deactivate();
    });
  });

  describe('shift + arrow keys', () => {
    it('lets the browser handle Shift with every arrow key', () => {
      const items = createItems(['One', 'Two', 'Three']);
      const onFlip = vi.fn();
      const onArrowLeft = vi.fn();
      const flipper = new Flipper({
        focusedItemClass: focusedClass,
        items,
        onArrowLeft,
      });

      flipper.onFlip(onFlip);
      flipper.activate();

      const prevented = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].map((key) => {
        const event = createKeyboardEvent(key, { shiftKey: true });

        flipper.handleExternalKeydown(event);

        return event.defaultPrevented;
      });

      expect(prevented).toStrictEqual([false, false, false, false]);
      expect(focusedFlags(items)).toStrictEqual([false, false, false]);
      expect(onFlip.mock.calls).toStrictEqual([]);
      expect(onArrowLeft.mock.calls).toStrictEqual([]);

      flipper.deactivate();
    });

    it('still flips backwards on Shift+Tab', () => {
      const items = createItems(['One', 'Two', 'Three']);
      const flipper = new Flipper({
        focusedItemClass: focusedClass,
        items,
      });

      flipper.activate();
      flipper.focusItem(1);

      const event = createKeyboardEvent('Tab', { shiftKey: true });

      flipper.handleExternalKeydown(event);

      expect(focusedFlags(items)).toStrictEqual([true, false, false]);
      expect(event.defaultPrevented).toBe(true);

      flipper.deactivate();
    });
  });

  describe('keydown switch', () => {
    it('ArrowUp moves focus backwards', () => {
      const items = createItems(['One', 'Two', 'Three']);
      const flipper = new Flipper({
        focusedItemClass: focusedClass,
        items,
      });

      flipper.activate();
      flipper.focusItem(1);
      flipper.handleExternalKeydown(createKeyboardEvent('ArrowUp'));

      expect(focusedFlags(items)).toStrictEqual([true, false, false]);

      flipper.deactivate();
    });

    it('ArrowLeft runs the onArrowLeft callback and nothing else', () => {
      const items = createItems(['One', 'Two', 'Three']);
      const onArrowLeft = vi.fn();
      const flipper = new Flipper({
        focusedItemClass: focusedClass,
        items,
        onArrowLeft,
      });

      flipper.activate();
      flipper.focusItem(1);

      const event = createKeyboardEvent('ArrowLeft');

      flipper.handleExternalKeydown(event);

      expect(onArrowLeft.mock.calls).toStrictEqual([[]]);
      expect(focusedFlags(items)).toStrictEqual([false, true, false]);
      expect(event.defaultPrevented).toBe(true);

      flipper.deactivate();
    });

    it('ArrowLeft is inert when no onArrowLeft callback was supplied', () => {
      const items = createItems(['One', 'Two', 'Three']);
      const flipper = new Flipper({
        focusedItemClass: focusedClass,
        items,
      });

      flipper.activate();
      flipper.focusItem(1);
      flipper.handleExternalKeydown(createKeyboardEvent('ArrowLeft'));

      expect(focusedFlags(items)).toStrictEqual([false, true, false]);

      flipper.deactivate();
    });

    it('ArrowRight opens the nested menu of an item that declares children', () => {
      const items = createItems(['One', 'Two', 'Three']);
      const clicked: number[] = [];
      const activated: number[] = [];

      items[1].setAttribute('data-blok-has-children', '');
      items.forEach((item, index) => {
        item.addEventListener('click', () => clicked.push(index));
      });

      const flipper = new Flipper({
        focusedItemClass: focusedClass,
        items,
        activateCallback: (item: HTMLElement) => activated.push(items.indexOf(item)),
      });

      flipper.activate();
      flipper.focusItem(1);
      flipper.handleExternalKeydown(createKeyboardEvent('ArrowRight'));

      expect(clicked).toStrictEqual([1]);
      expect(activated).toStrictEqual([1]);
      expect(focusedFlags(items)).toStrictEqual([false, true, false]);

      flipper.deactivate();
    });

    it('ArrowRight does nothing for an item without children', () => {
      const items = createItems(['One', 'Two', 'Three']);
      const clicked: number[] = [];

      items.forEach((item, index) => {
        item.addEventListener('click', () => clicked.push(index));
      });

      const flipper = new Flipper({
        focusedItemClass: focusedClass,
        items,
      });

      flipper.activate();
      flipper.focusItem(0);
      flipper.handleExternalKeydown(createKeyboardEvent('ArrowRight'));

      expect(clicked).toStrictEqual([]);
      expect(focusedFlags(items)).toStrictEqual([true, false, false]);

      flipper.deactivate();
    });

    it('leaves Enter alone when nothing is focused', () => {
      const items = createItems(['One', 'Two']);
      const flipper = new Flipper({
        focusedItemClass: focusedClass,
        items,
      });

      flipper.activate();

      const event = createKeyboardEvent('Enter');

      flipper.handleExternalKeydown(event);

      expect(event.defaultPrevented).toBe(false);
      expect(focusedFlags(items)).toStrictEqual([false, false]);

      flipper.deactivate();
    });

    it('stops a handled navigation keydown from propagating', () => {
      const items = createItems(['One', 'Two']);
      const flipper = new Flipper({
        focusedItemClass: focusedClass,
        items,
      });

      flipper.activate();

      const event = createKeyboardEvent('ArrowDown');
      const stopPropagation = vi.spyOn(event, 'stopPropagation');
      const stopImmediatePropagation = vi.spyOn(event, 'stopImmediatePropagation');

      flipper.handleExternalKeydown(event);

      expect(stopPropagation.mock.calls).toStrictEqual([[]]);
      expect(stopImmediatePropagation.mock.calls).toStrictEqual([[]]);

      flipper.deactivate();
    });
  });

  describe('Enter activation', () => {
    it('stops propagation and prevents default in both the router and the handler', () => {
      const items = createItems(['One', 'Two']);
      const flipper = new Flipper({
        focusedItemClass: focusedClass,
        items,
      });

      flipper.activate();
      flipper.focusItem(0);

      const event = createKeyboardEvent('Enter');
      const stopPropagation = vi.spyOn(event, 'stopPropagation');
      const preventDefault = vi.spyOn(event, 'preventDefault');

      flipper.handleExternalKeydown(event);

      expect(stopPropagation).toHaveBeenCalledTimes(2);
      expect(preventDefault).toHaveBeenCalledTimes(2);

      flipper.deactivate();
    });

    it('clicks the focused item when no activate callback was supplied', () => {
      const items = createItems(['One', 'Two']);
      const clicked: number[] = [];

      items.forEach((item, index) => {
        item.addEventListener('click', () => clicked.push(index));
      });

      const flipper = new Flipper({
        focusedItemClass: focusedClass,
        items,
      });

      flipper.activate();
      flipper.focusItem(0);
      flipper.handleExternalKeydown(createKeyboardEvent('Enter'));

      expect(clicked).toStrictEqual([0]);

      flipper.deactivate();
    });
  });

  describe('scrolling the focused item into view', () => {
    it('falls back to scrollIntoView when scrollIntoViewIfNeeded is missing', () => {
      const items = createItems(['One', 'Two']);
      const scrollIntoView = vi.fn<(options?: ScrollIntoViewOptions) => void>();

      Object.defineProperty(items[0], 'scrollIntoViewIfNeeded', {
        configurable: true,
        value: undefined,
      });
      Object.defineProperty(items[0], 'scrollIntoView', {
        configurable: true,
        value: scrollIntoView,
      });

      const flipper = new Flipper({
        focusedItemClass: focusedClass,
        items,
      });

      flipper.activate();
      flipper.flipRight();

      expect(scrollIntoView.mock.calls).toStrictEqual([[{ block: 'nearest' }]]);

      flipper.deactivate();
    });
  });

  describe('typeahead', () => {
    it('is ignored while the flipper is deactivated', () => {
      vi.useFakeTimers();

      const items = createItems(['Apple', 'Banana', 'Cherry']);
      const flipper = new Flipper({
        focusedItemClass: focusedClass,
        items,
        typeAhead: true,
      });

      const event = createKeyboardEvent('b');

      flipper.handleExternalKeydown(event);

      expect(focusedFlags(items)).toStrictEqual([false, false, false]);
      expect(event.defaultPrevented).toBe(false);
    });

    it('ignores printable keys pressed with a modifier', () => {
      vi.useFakeTimers();

      const items = createItems(['Apple', 'Banana', 'Cherry']);
      const flipper = new Flipper({
        focusedItemClass: focusedClass,
        items,
        typeAhead: true,
      });

      flipper.activate();

      const prevented = [{ ctrlKey: true }, { metaKey: true }, { altKey: true }].map((modifier) => {
        const event = createKeyboardEvent('b', modifier);

        flipper.handleExternalKeydown(event);

        return event.defaultPrevented;
      });

      expect(prevented).toStrictEqual([false, false, false]);
      expect(focusedFlags(items)).toStrictEqual([false, false, false]);

      flipper.deactivate();
    });

    it('does not swallow multi-character navigation keys', () => {
      vi.useFakeTimers();

      const items = createItems(['Apple', 'Banana', 'Cherry']);
      const flipper = new Flipper({
        focusedItemClass: focusedClass,
        items,
        typeAhead: true,
      });

      flipper.activate();
      flipper.handleExternalKeydown(createKeyboardEvent('Tab'));

      expect(focusedFlags(items)).toStrictEqual([true, false, false]);

      flipper.deactivate();
    });

    it('consumes the printable keystroke it handled', () => {
      vi.useFakeTimers();

      const items = createItems(['Apple', 'Banana']);
      const flipper = new Flipper({
        focusedItemClass: focusedClass,
        items,
        typeAhead: true,
      });

      flipper.activate();

      const event = createKeyboardEvent('b');
      const stopPropagation = vi.spyOn(event, 'stopPropagation');
      const stopImmediatePropagation = vi.spyOn(event, 'stopImmediatePropagation');

      flipper.handleExternalKeydown(event);

      expect(event.defaultPrevented).toBe(true);
      expect(stopPropagation.mock.calls).toStrictEqual([[]]);
      expect(stopImmediatePropagation.mock.calls).toStrictEqual([[]]);
      expect(focusedFlags(items)).toStrictEqual([false, true]);

      flipper.deactivate();
    });

    it('does not clear a timer on the first keystroke of a window', () => {
      vi.useFakeTimers();

      const items = createItems(['Apple', 'Banana']);
      const clearTimeoutSpy = vi.spyOn(globalThis, 'clearTimeout');
      const flipper = new Flipper({
        focusedItemClass: focusedClass,
        items,
        typeAhead: true,
      });

      flipper.activate();
      flipper.handleExternalKeydown(createKeyboardEvent('b'));

      expect(clearTimeoutSpy.mock.calls).toStrictEqual([]);
      expect(focusedFlags(items)).toStrictEqual([false, true]);

      flipper.deactivate();
    });

    it('restarts the buffer window on every keystroke', () => {
      vi.useFakeTimers();

      const items = createItems(['Cat', 'Car', 'Dog']);
      const flipper = new Flipper({
        focusedItemClass: focusedClass,
        items,
        typeAhead: true,
      });

      flipper.activate();

      flipper.handleExternalKeydown(createKeyboardEvent('c'));
      expect(focusedFlags(items)).toStrictEqual([true, false, false]);

      vi.advanceTimersByTime(300);
      flipper.handleExternalKeydown(createKeyboardEvent('a'));
      expect(focusedFlags(items)).toStrictEqual([true, false, false]);

      // Past the 500ms window measured from the FIRST keystroke: the buffer must
      // still read "car", which only holds if each keystroke reset the timer.
      vi.advanceTimersByTime(300);
      flipper.handleExternalKeydown(createKeyboardEvent('r'));
      expect(focusedFlags(items)).toStrictEqual([false, true, false]);

      flipper.deactivate();
    });

    it('keeps the current focus when the buffer stops matching', () => {
      vi.useFakeTimers();

      const items = createItems(['Cat', 'Car', 'Dog']);
      const onFlip = vi.fn();
      const flipper = new Flipper({
        focusedItemClass: focusedClass,
        items,
        typeAhead: true,
      });

      flipper.onFlip(onFlip);
      flipper.activate();

      flipper.handleExternalKeydown(createKeyboardEvent('d'));

      expect(focusedFlags(items)).toStrictEqual([false, false, true]);
      expect(onFlip.mock.calls).toStrictEqual([[]]);

      flipper.handleExternalKeydown(createKeyboardEvent('z'));

      expect(focusedFlags(items)).toStrictEqual([false, false, true]);
      expect(onFlip.mock.calls).toStrictEqual([[]]);

      flipper.deactivate();
    });

    it('skips disabled items while matching', () => {
      vi.useFakeTimers();

      const items = createItems(['Cat', 'Car', 'Dog']);

      items[0].setAttribute('data-blok-disabled', '');

      const flipper = new Flipper({
        focusedItemClass: focusedClass,
        items,
        typeAhead: true,
      });

      flipper.activate();
      flipper.handleExternalKeydown(createKeyboardEvent('c'));

      expect(focusedFlags(items)).toStrictEqual([false, true, false]);

      flipper.deactivate();
    });

    it('trims the label before matching', () => {
      vi.useFakeTimers();

      const items = createItems(['  Padded', 'Zebra']);
      const flipper = new Flipper({
        focusedItemClass: focusedClass,
        items,
        typeAhead: true,
      });

      flipper.activate();
      flipper.handleExternalKeydown(createKeyboardEvent('p'));

      expect(focusedFlags(items)).toStrictEqual([true, false]);

      flipper.deactivate();
    });
  });

  describe('event target filtering', () => {
    it('handles a keydown that carries no target', () => {
      const items = createItems(['One', 'Two']);
      const flipper = new Flipper({
        focusedItemClass: focusedClass,
        items,
      });

      flipper.activate();
      flipper.handleExternalKeydown(createKeyboardEvent('ArrowDown', { target: null }));

      expect(focusedFlags(items)).toStrictEqual([true, false]);

      flipper.deactivate();
    });

    it('forwards every navigation key from a flipper navigation target input', () => {
      const items = createItems(['One', 'Two', 'Three']);
      const input = document.createElement('input');

      input.setAttribute('data-blok-flipper-navigation-target', 'true');
      document.body.appendChild(input);

      const flipper = new Flipper({
        focusedItemClass: focusedClass,
        items,
      });

      flipper.activate();
      flipper.focusItem(1);

      const prevented = ['ArrowUp', 'ArrowDown', 'ArrowRight', 'ArrowLeft', 'Enter'].map((key) => {
        const event = createKeyboardEvent(key, { target: input });

        flipper.handleExternalKeydown(event);

        return event.defaultPrevented;
      });

      expect(prevented).toStrictEqual([true, true, true, true, true]);

      flipper.deactivate();
    });

    it('still skips a non-navigation key from a flipper navigation target input', () => {
      const items = createItems(['One', 'Two', 'Three']);
      const input = document.createElement('input');

      input.setAttribute('data-blok-flipper-navigation-target', 'true');
      document.body.appendChild(input);

      const flipper = new Flipper({
        focusedItemClass: focusedClass,
        items,
      });

      flipper.activate();

      const event = createKeyboardEvent('Home', { target: input });

      flipper.handleExternalKeydown(event);

      expect(event.defaultPrevented).toBe(false);
      expect(focusedFlags(items)).toStrictEqual([false, false, false]);

      flipper.deactivate();
    });

    it('skips any target inside an opened inline link tool input', () => {
      const items = createItems(['One', 'Two']);
      const wrapper = document.createElement('div');
      const inner = document.createElement('span');

      wrapper.setAttribute('data-blok-link-tool-input-opened', 'true');
      wrapper.appendChild(inner);
      document.body.appendChild(wrapper);

      const flipper = new Flipper({
        focusedItemClass: focusedClass,
        items,
      });

      flipper.activate();

      const event = createKeyboardEvent('ArrowDown', { target: inner });

      flipper.handleExternalKeydown(event);

      expect(focusedFlags(items)).toStrictEqual([false, false]);
      expect(event.defaultPrevented).toBe(false);

      flipper.deactivate();
    });
  });
});
