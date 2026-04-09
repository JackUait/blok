import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { PopoverEvent } from '@/types/utils/popover/popover-event';
import type { ViewType } from '../../../../src/tools/database/types';

/**
 * Use vi.hoisted so the class is available inside the vi.mock factory
 * (which is hoisted to the top of the file by Vitest).
 */
const { MockPopover, mockPopoverInstances } = vi.hoisted(() => {
  const instances: Array<{
    params: unknown;
    show: () => void;
    destroy: () => void;
    on: (event: string, cb: () => void) => void;
    triggerClosed: () => void;
    el: HTMLElement | null;
    closedCallbacks: Array<() => void>;
  }> = [];

  class MockPopoverClass {
    public el: HTMLElement | null = null;
    public closedCallbacks: Array<() => void> = [];
    public params: unknown;

    constructor(params: unknown) {
      this.params = params;
      instances.push(this);
    }

    show(): void {
      this.el = document.createElement('div');
      this.el.setAttribute('data-blok-database-view-popover', '');
      document.body.appendChild(this.el);
    }

    destroy(): void {
      this.el?.remove();
      this.el = null;
    }

    on(event: string, cb: () => void): void {
      if (event === 'closed') {
        this.closedCallbacks.push(cb);
      }
    }

    /** Trigger the Closed event — simulates an outside click or explicit close */
    triggerClosed(): void {
      for (const cb of this.closedCallbacks) {
        cb();
      }
    }
  }

  return { MockPopover: MockPopoverClass, mockPopoverInstances: instances };
});

vi.mock('../../../../src/components/utils/popover', () => ({
  PopoverDesktop: MockPopover,
  PopoverItemType: {
    Default: 'default',
    Separator: 'separator',
    Html: 'html',
  },
}));

import { DatabaseViewPopover } from '../../../../src/tools/database/database-view-popover';

describe('DatabaseViewPopover', () => {
  let onSelect: ReturnType<typeof vi.fn<(type: ViewType) => void>>;
  let popover: DatabaseViewPopover;
  let anchor: HTMLElement;

  beforeEach(() => {
    vi.clearAllMocks();
    mockPopoverInstances.length = 0;
    onSelect = vi.fn<(type: ViewType) => void>();
    anchor = document.createElement('button');
    document.body.appendChild(anchor);
    popover = new DatabaseViewPopover({ onSelect });
  });

  afterEach(() => {
    popover.destroy();
    anchor.remove();
    vi.restoreAllMocks();
  });

  /** Helper to get items from the latest mock PopoverDesktop instance. */
  const getLastItems = (): Array<{ element?: HTMLElement; closeOnActivate?: boolean }> => {
    const instance = mockPopoverInstances.at(-1)!;

    return (instance.params as { items: Array<{ element?: HTMLElement; closeOnActivate?: boolean }> }).items;
  };

  describe('open()', () => {
    it('appends a popover element to document body', () => {
      popover.open(anchor);
      const el = document.querySelector('[data-blok-database-view-popover]');

      expect(el).not.toBeNull();
    });

    it('renders a heading with "Add view" text', () => {
      popover.open(anchor);
      const items = getLastItems();
      const headingEl = items
        .map((item) => item.element)
        .find((el) => el?.hasAttribute('data-blok-database-view-popover-heading'));

      expect(headingEl).not.toBeUndefined();
      expect(headingEl!.textContent).toContain('Add view');
    });

    it('renders Board option as enabled', () => {
      popover.open(anchor);
      const items = getLastItems();
      const boardEl = items
        .map((item) => item.element)
        .find((el) => el?.getAttribute('data-blok-database-view-option') === 'board') as HTMLElement | undefined;

      expect(boardEl).not.toBeUndefined();
      expect(boardEl!.style.opacity).not.toBe('0.35');
      expect(boardEl!.style.cursor).not.toBe('not-allowed');
    });

    it('renders Board and List options', () => {
      popover.open(anchor);
      const items = getLastItems();
      const types = items
        .map((item) => item.element?.getAttribute('data-blok-database-view-option'))
        .filter(Boolean);

      expect(types).toEqual(['board', 'list']);
    });

    it('renders List option as enabled', () => {
      popover.open(anchor);
      const items = getLastItems();
      const listEl = items
        .map((item) => item.element)
        .find((el) => el?.getAttribute('data-blok-database-view-option') === 'list') as HTMLElement | undefined;

      expect(listEl).not.toBeUndefined();
      expect(listEl!.style.opacity).not.toBe('0.35');
      expect(listEl!.style.pointerEvents).not.toBe('none');
    });

    it('calls onSelect with "list" when List option is clicked', () => {
      popover.open(anchor);
      const items = getLastItems();
      const listEl = items
        .map((item) => item.element)
        .find((el) => el?.getAttribute('data-blok-database-view-option') === 'list') as HTMLElement;

      listEl.click();
      expect(onSelect).toHaveBeenCalledWith('list');
    });

    it('calls onSelect with "board" when Board option is clicked', () => {
      popover.open(anchor);
      const items = getLastItems();
      const boardEl = items
        .map((item) => item.element)
        .find((el) => el?.getAttribute('data-blok-database-view-option') === 'board') as HTMLElement;

      boardEl.click();
      expect(onSelect).toHaveBeenCalledWith('board');
    });

    it('closes the popover after PopoverEvent.Closed fires following Board selection', () => {
      popover.open(anchor);
      const instance = mockPopoverInstances.at(-1)!;
      const items = getLastItems();
      const boardEl = items
        .map((item) => item.element)
        .find((el) => el?.getAttribute('data-blok-database-view-option') === 'board') as HTMLElement;

      boardEl.click();
      // PopoverDesktop fires Closed after an item with closeOnActivate is activated
      instance.triggerClosed();

      const el = document.querySelector('[data-blok-database-view-popover]');

      expect(el).toBeNull();
    });

    it('passes closeOnActivate for view option items', () => {
      popover.open(anchor);
      const items = getLastItems();
      const viewItems = items.filter((item) => item.element?.hasAttribute('data-blok-database-view-option'));

      expect(viewItems.length).toBeGreaterThan(0);
      for (const item of viewItems) {
        expect(item.closeOnActivate).toBe(true);
      }
    });

    it('calls onClose callback when popover closes via PopoverEvent.Closed', () => {
      const onClose = vi.fn();
      const popoverWithClose = new DatabaseViewPopover({ onSelect, onClose });

      popoverWithClose.open(anchor);
      const instance = mockPopoverInstances.at(-1)!;

      instance.triggerClosed();
      expect(onClose).toHaveBeenCalledOnce();

      popoverWithClose.destroy();
    });

    it('replaces existing popover when open() is called twice', () => {
      popover.open(anchor);
      popover.open(anchor);

      const els = document.querySelectorAll('[data-blok-database-view-popover]');

      expect(els.length).toBe(1);
    });
  });

  describe('close()', () => {
    it('removes the popover element from the DOM', () => {
      popover.open(anchor);
      popover.close();
      const el = document.querySelector('[data-blok-database-view-popover]');

      expect(el).toBeNull();
    });
  });

  describe('outside click', () => {
    it('closes popover when PopoverEvent.Closed is triggered', () => {
      popover.open(anchor);
      const instance = mockPopoverInstances.at(-1)!;

      // Simulate PopoverDesktop firing its Closed event (e.g. on outside click)
      instance.triggerClosed();

      const el = document.querySelector('[data-blok-database-view-popover]');

      expect(el).toBeNull();
    });
  });
});
