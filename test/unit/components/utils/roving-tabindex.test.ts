import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import { RovingTabindexController } from '../../../../src/components/utils/roving-tabindex';

/**
 * Builds `count` buttons, appends them to the document body (so `.focus()`
 * updates `document.activeElement`), and returns them.
 */
const makeItems = (count: number): HTMLElement[] => {
  const items: HTMLElement[] = [];

  for (let i = 0; i < count; i++) {
    const el = document.createElement('button');

    el.textContent = `item-${i}`;
    document.body.appendChild(el);
    items.push(el);
  }

  return items;
};

describe('RovingTabindexController', () => {
  let items: HTMLElement[];
  let controller: RovingTabindexController | null = null;

  beforeEach(() => {
    items = makeItems(3);
  });

  afterEach(() => {
    controller?.destroy();
    controller = null;
    items.forEach((item) => item.remove());
  });

  describe('initial tabindex', () => {
    it('marks the first item tabbable and the rest not (default tabbable group)', () => {
      controller = new RovingTabindexController(items);

      expect(items[0].getAttribute('tabindex')).toBe('0');
      expect(items[1].getAttribute('tabindex')).toBe('-1');
      expect(items[2].getAttribute('tabindex')).toBe('-1');
    });

    it('keeps every item out of the tab order when tabbable is false', () => {
      controller = new RovingTabindexController(items, { tabbable: false });

      expect(items[0].getAttribute('tabindex')).toBe('-1');
      expect(items[1].getAttribute('tabindex')).toBe('-1');
      expect(items[2].getAttribute('tabindex')).toBe('-1');
    });
  });

  describe('horizontal arrow navigation (default orientation)', () => {
    it('moves focus to the next item on ArrowRight and rolls the tabindex', () => {
      controller = new RovingTabindexController(items);
      items[0].focus();

      items[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }));

      expect(items[1]).toHaveFocus();
      expect(items[1].getAttribute('tabindex')).toBe('0');
      expect(items[0].getAttribute('tabindex')).toBe('-1');
    });

    it('moves focus to the previous item on ArrowLeft', () => {
      controller = new RovingTabindexController(items);
      controller.focus(2);

      items[2].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true, cancelable: true }));

      expect(items[1]).toHaveFocus();
    });

    it('ignores vertical arrows in horizontal orientation', () => {
      controller = new RovingTabindexController(items);
      items[0].focus();

      const event = new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true });

      items[0].dispatchEvent(event);

      expect(items[0]).toHaveFocus();
      expect(event.defaultPrevented).toBe(false);
    });

    it('preventDefault on a handled arrow key', () => {
      controller = new RovingTabindexController(items);
      items[0].focus();

      const event = new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true });

      items[0].dispatchEvent(event);

      expect(event.defaultPrevented).toBe(true);
    });
  });

  describe('vertical orientation', () => {
    it('navigates with ArrowDown / ArrowUp', () => {
      controller = new RovingTabindexController(items, { orientation: 'vertical' });
      items[0].focus();

      items[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }));
      expect(items[1]).toHaveFocus();

      items[1].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true, cancelable: true }));
      expect(items[0]).toHaveFocus();
    });
  });

  describe('looping', () => {
    it('wraps from last to first on the forward key when loop is enabled (default)', () => {
      controller = new RovingTabindexController(items);
      controller.focus(2);

      items[2].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }));

      expect(items[0]).toHaveFocus();
    });

    it('clamps at the last item when loop is disabled', () => {
      controller = new RovingTabindexController(items, { loop: false });
      controller.focus(2);

      items[2].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }));

      expect(items[2]).toHaveFocus();
    });
  });

  describe('Home / End', () => {
    it('focuses the first item on Home and the last on End', () => {
      controller = new RovingTabindexController(items);
      controller.focus(1);

      items[1].dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true, cancelable: true }));
      expect(items[2]).toHaveFocus();

      items[2].dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true, cancelable: true }));
      expect(items[0]).toHaveFocus();
    });
  });

  describe('hidden items', () => {
    it('skips items hidden via display:none when navigating', () => {
      items[1].style.display = 'none';
      controller = new RovingTabindexController(items);
      items[0].focus();

      items[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }));

      expect(items[2]).toHaveFocus();
    });

    it('skips items hidden via a stylesheet class (display:none from CSS rules)', () => {
      const style = document.createElement('style');

      style.textContent = '.rt-test-hidden { display: none; }';
      document.head.appendChild(style);

      try {
        items[1].classList.add('rt-test-hidden');
        controller = new RovingTabindexController(items);
        items[0].focus();

        items[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }));

        expect(items[2]).toHaveFocus();
      } finally {
        style.remove();
      }
    });

    it('skips items hidden via visibility:hidden when navigating', () => {
      items[1].style.visibility = 'hidden';
      controller = new RovingTabindexController(items);
      items[0].focus();

      items[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }));

      expect(items[2]).toHaveFocus();
    });

    it('focusFirst lands on the first visible item', () => {
      items[0].style.display = 'none';
      controller = new RovingTabindexController(items, { tabbable: false });

      controller.focusFirst();

      expect(items[1]).toHaveFocus();
    });
  });

  describe('focusFirst / focusLast / activeElement', () => {
    it('exposes the active element and focuses first / last on demand', () => {
      controller = new RovingTabindexController(items, { tabbable: false });

      controller.focusFirst();
      expect(items[0]).toHaveFocus();
      expect(controller.activeElement).toBe(items[0]);

      controller.focusLast();
      expect(items[2]).toHaveFocus();
      expect(controller.activeElement).toBe(items[2]);
    });
  });

  describe('destroy', () => {
    it('stops responding to arrow keys after destroy', () => {
      controller = new RovingTabindexController(items);
      items[0].focus();
      controller.destroy();
      controller = null;

      items[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }));

      expect(items[0]).toHaveFocus();
    });
  });
});
