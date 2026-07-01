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

      expect(document.activeElement).toBe(items[1]);
      expect(items[1].getAttribute('tabindex')).toBe('0');
      expect(items[0].getAttribute('tabindex')).toBe('-1');
    });

    it('moves focus to the previous item on ArrowLeft', () => {
      controller = new RovingTabindexController(items);
      controller.focus(2);

      items[2].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true, cancelable: true }));

      expect(document.activeElement).toBe(items[1]);
    });

    it('ignores vertical arrows in horizontal orientation', () => {
      controller = new RovingTabindexController(items);
      items[0].focus();

      const event = new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true });

      items[0].dispatchEvent(event);

      expect(document.activeElement).toBe(items[0]);
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
      expect(document.activeElement).toBe(items[1]);

      items[1].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true, cancelable: true }));
      expect(document.activeElement).toBe(items[0]);
    });
  });

  describe('looping', () => {
    it('wraps from last to first on the forward key when loop is enabled (default)', () => {
      controller = new RovingTabindexController(items);
      controller.focus(2);

      items[2].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }));

      expect(document.activeElement).toBe(items[0]);
    });

    it('clamps at the last item when loop is disabled', () => {
      controller = new RovingTabindexController(items, { loop: false });
      controller.focus(2);

      items[2].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }));

      expect(document.activeElement).toBe(items[2]);
    });
  });

  describe('Home / End', () => {
    it('focuses the first item on Home and the last on End', () => {
      controller = new RovingTabindexController(items);
      controller.focus(1);

      items[1].dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true, cancelable: true }));
      expect(document.activeElement).toBe(items[2]);

      items[2].dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true, cancelable: true }));
      expect(document.activeElement).toBe(items[0]);
    });
  });

  describe('hidden items', () => {
    it('skips items hidden via display:none when navigating', () => {
      items[1].style.display = 'none';
      controller = new RovingTabindexController(items);
      items[0].focus();

      items[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }));

      expect(document.activeElement).toBe(items[2]);
    });

    it('focusFirst lands on the first visible item', () => {
      items[0].style.display = 'none';
      controller = new RovingTabindexController(items, { tabbable: false });

      controller.focusFirst();

      expect(document.activeElement).toBe(items[1]);
    });
  });

  describe('focusFirst / focusLast / activeElement', () => {
    it('exposes the active element and focuses first / last on demand', () => {
      controller = new RovingTabindexController(items, { tabbable: false });

      controller.focusFirst();
      expect(document.activeElement).toBe(items[0]);
      expect(controller.activeElement).toBe(items[0]);

      controller.focusLast();
      expect(document.activeElement).toBe(items[2]);
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

      expect(document.activeElement).toBe(items[0]);
    });
  });
});
