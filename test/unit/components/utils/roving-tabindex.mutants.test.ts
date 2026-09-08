import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import {
  RovingTabindexController,
  type RovingTabindexOptions,
} from '../../../../src/components/utils/roving-tabindex';

let container: HTMLElement;
let items: HTMLElement[];
let controller: RovingTabindexController;

const build = (count: number, options: RovingTabindexOptions = {}): void => {
  container = document.createElement('div');
  items = Array.from({ length: count }, (_, index) => {
    const button = document.createElement('button');

    button.textContent = `item ${index}`;
    container.appendChild(button);

    return button;
  });
  document.body.appendChild(container);
  controller = new RovingTabindexController(items, options);
};

const press = (from: number, key: string): KeyboardEvent => {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });

  items[from].dispatchEvent(event);

  return event;
};

/** The roving state, which is set even when the target cannot take DOM focus. */
const stops = (): (string | null)[] => items.map((item) => item.getAttribute('tabindex'));

const activeIndex = (): number => items.indexOf(document.activeElement as HTMLElement);

const hide = (index: number): void => {
  items[index].style.display = 'none';
};

/**
 * Five mutants survive, all inert:
 *
 * - the `count === 0` guard in `move` and its body: with no items there are no
 *   keydown listeners to reach it, and the scan it guards returns -1 on its own
 *   because `stepsRemaining` starts at 0.
 * - `return -1` mutated to `return +1` in the step-budget guard: the budget only
 *   runs out when every item is hidden, and focusing index 1 then resolves to no
 *   visible item either way.
 * - the `!isHidden(clamped)` early return and its body, forced to fall through:
 *   `findVisible(clamped, 1)` immediately returns `clamped` for a visible item,
 *   so the shortcut and the scan agree.
 */
describe('RovingTabindexController mutants', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    controller.destroy();
    container.remove();
    vi.restoreAllMocks();
  });

  describe('hidden items', () => {
    it('skips an item hidden only from assistive technology', () => {
      build(3);
      items[1].setAttribute('aria-hidden', 'true');
      press(0, 'ArrowRight');

      expect(activeIndex()).toBe(2);
    });

    it('skips an item hidden by the hidden attribute', () => {
      build(3);
      items[1].hidden = true;
      press(0, 'ArrowRight');

      expect(activeIndex()).toBe(2);
    });

    it('skips an item hidden by a style', () => {
      build(3);
      hide(1);
      press(0, 'ArrowRight');

      expect(activeIndex()).toBe(2);
    });
  });

  describe('arrow navigation', () => {
    it('wraps forward off the end', () => {
      build(3);
      controller.focus(2);
      press(2, 'ArrowRight');

      expect(activeIndex()).toBe(0);
    });

    it('wraps backward off the start', () => {
      build(3);
      press(0, 'ArrowLeft');

      expect(activeIndex()).toBe(2);
    });

    it('stops at the end when looping is off', () => {
      build(3, { loop: false });
      controller.focus(2);
      press(2, 'ArrowRight');

      expect(activeIndex()).toBe(2);
    });

    it('still steps inside the group when looping is off', () => {
      build(3, { loop: false });
      press(0, 'ArrowRight');

      expect(activeIndex()).toBe(1);
    });

    it('steps backward inside the group when looping is off', () => {
      build(3, { loop: false });
      controller.focus(1);
      press(1, 'ArrowLeft');

      expect(activeIndex()).toBe(0);
    });

    it('wraps past a hidden last item rather than stopping on it', () => {
      build(3);
      hide(2);
      controller.focus(1);
      press(1, 'ArrowRight');

      expect(activeIndex()).toBe(0);
    });

    it('follows the vertical axis when configured', () => {
      build(3, { orientation: 'vertical' });
      press(0, 'ArrowDown');

      expect(activeIndex()).toBe(1);
    });

    it('takes over the default action for every key it handles', () => {
      build(3);

      expect(press(1, 'ArrowLeft').defaultPrevented).toBe(true);
      expect(press(0, 'Home').defaultPrevented).toBe(true);
      expect(press(0, 'End').defaultPrevented).toBe(true);
    });

    it('leaves a key it does not handle alone', () => {
      build(3);

      const event = press(0, 'ArrowUp');

      expect(event.defaultPrevented).toBe(false);
      expect(activeIndex()).toBe(-1);
    });
  });

  describe('Home and End', () => {
    it('goes to the last VISIBLE item, scanning backwards', () => {
      build(3);
      hide(2);
      press(0, 'End');

      expect(activeIndex()).toBe(1);
    });

    it('goes to the first visible item, scanning forwards', () => {
      build(3);
      hide(0);
      press(1, 'Home');

      expect(activeIndex()).toBe(1);
    });
  });

  describe('focus by index', () => {
    it('clamps an index past the end onto the last item', () => {
      build(3);
      controller.focus(99);

      expect(activeIndex()).toBe(2);
    });

    it('moves forward off a hidden target', () => {
      build(3);
      hide(1);
      controller.focus(1);

      expect(activeIndex()).toBe(2);
    });

    it('falls back to scanning backwards when nothing visible follows', () => {
      build(3);
      hide(2);
      controller.focus(2);

      expect(activeIndex()).toBe(1);
    });

    it('does nothing at all when every item is hidden', () => {
      build(3);
      items.forEach((_, index) => hide(index));

      const before = stops();
      const errors = vi.fn();

      window.addEventListener('error', errors);
      expect(() => controller.focusFirst()).not.toThrow();
      press(0, 'ArrowRight');
      window.removeEventListener('error', errors);

      expect(stops()).toStrictEqual(before);
      expect(errors).not.toHaveBeenCalled();
    });

    it('survives a group with no items', () => {
      build(0);

      expect(() => controller.focus(0)).not.toThrow();
      expect(controller.activeElement).toBeUndefined();
    });
  });

  describe('tab stops', () => {
    it('keeps exactly one stop and rolls it to the focused item', () => {
      build(3);

      expect(stops()).toStrictEqual(['0', '-1', '-1']);

      controller.focus(2);

      expect(stops()).toStrictEqual(['-1', '-1', '0']);
    });

    it('keeps the whole group out of the tab order when it is not tabbable', () => {
      build(3, { tabbable: false });
      controller.focus(1);

      expect(stops()).toStrictEqual(['-1', '-1', '-1']);
      expect(activeIndex()).toBe(1);
    });
  });
});
