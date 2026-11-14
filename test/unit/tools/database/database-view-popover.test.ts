import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
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
import { VIEW_ICONS } from '../../../../src/tools/database/database-tab-bar';

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

    it('opens with the database menu motion', () => {
      popover.open(anchor);

      expect((mockPopoverInstances.at(-1)?.params as { class?: string } | undefined)?.class?.split(' ')).toContain('blok-database-menu');
    });

    it('renders a heading', () => {
      popover.open(anchor);
      const items = getLastItems();
      const headingEl = items
        .map((item) => item.element)
        .find((el) => el?.hasAttribute('data-blok-database-view-popover-heading'));

      expect(headingEl).not.toBeUndefined();
      expect(headingEl!.textContent).not.toBe('');
    });

    it('renders Board option as enabled', () => {
      popover.open(anchor);
      const items = getLastItems();
      const boardEl = items
        .map((item) => item.element)
        .find((el) => el?.getAttribute('data-blok-database-view-option') === 'board');

      expect(boardEl).not.toBeUndefined();
      expect(boardEl!.style.opacity).not.toBe('0.35');
      expect(boardEl!.style.cursor).not.toBe('not-allowed');
    });

    it('lists the layouts in Notion order, Dashboard after Chart (research/08:113, notion-motion Round 15 A)', () => {
      popover.open(anchor);
      const items = getLastItems();
      const types = items
        .map((item) => item.element?.getAttribute('data-blok-database-view-option'))
        .filter(Boolean);

      expect(types).toEqual(['table', 'board', 'gallery', 'list', 'chart', 'dashboard', 'timeline', 'feed', 'map', 'calendar', 'form']);
    });

    it('calls onSelect with "table" when Table option is clicked', () => {
      popover.open(anchor);
      const items = getLastItems();
      const tableEl = items
        .map((item) => item.element)
        .find((el) => el?.getAttribute('data-blok-database-view-option') === 'table');

      tableEl?.click();

      expect(onSelect).toHaveBeenCalledWith('table');
    });

    it('renders List option as enabled', () => {
      popover.open(anchor);
      const items = getLastItems();
      const listEl = items
        .map((item) => item.element)
        .find((el) => el?.getAttribute('data-blok-database-view-option') === 'list');

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

  describe("Notion's tile grid (feel/findings-toolbar V04)", () => {
    const params = (): { class?: string; width?: string; items: Array<{ type?: string; element?: HTMLElement }> } =>
      mockPopoverInstances.at(-1)!.params as { class?: string; width?: string; items: Array<{ type?: string; element?: HTMLElement }> };
    const option = (type: string): HTMLElement =>
      params().items.map((item) => item.element).find((el) => el?.getAttribute('data-blok-database-view-option') === type)!;

    it('heads the menu "Add a new view"', () => {
      popover.open(anchor);

      const heading = params().items.map((item) => item.element).find((el) => el?.hasAttribute('data-blok-database-view-popover-heading'));

      expect(heading?.textContent).toBe('Add a new view');
    });

    it('draws each layout as a tile button: its glyph, then its label, no description', () => {
      popover.open(anchor);

      const board = option('board');

      expect(board.tagName).toBe('BUTTON');
      expect(board.getAttribute('type')).toBe('button');
      expect([...board.children].map((child) => child.getAttributeNames()[0])).toEqual([
        'data-blok-database-view-option-icon',
        'data-blok-database-view-option-label',
      ]);
      expect(board.querySelector('[data-blok-database-view-option-desc]')).toBeNull();
    });

    // Notion draws one timeline glyph in the tile and in the tab (notion-live/addview.png, timeline.png).
    it('draws the Timeline tile with the Timeline tab\'s icon', () => {
      popover.open(anchor);

      const tab = document.createElement('span');

      tab.innerHTML = VIEW_ICONS.timeline;
      expect(option('timeline').querySelector('[data-blok-database-view-option-icon]')?.innerHTML).toBe(tab.innerHTML);
    });

    // notion-motion Round 9 (r9-addview-svgs.raw), research/07:50, 81-scratch-form.png:
    // Notion draws one glyph per layout in the tile and in the tab.
    it.each(['table', 'board', 'gallery', 'list', 'chart', 'dashboard', 'timeline', 'feed', 'map', 'calendar', 'form'])('draws the %s tile with its tab\'s icon', (type) => {
      popover.open(anchor);

      const tab = document.createElement('span');

      tab.innerHTML = VIEW_ICONS[type];
      expect(option(type).querySelector('[data-blok-database-view-option-icon]')?.innerHTML).toBe(tab.innerHTML);
    });

    // motion-addview.json: "+" ends at y 252 and the card starts at y 256.
    it('opens 4px below the "+"', () => {
      popover.open(anchor);

      expect((mockPopoverInstances.at(-1)?.params as { offset?: number }).offset).toBe(4);
    });

    // notion-motion.md Round 31 §3: from "N more…" › New view, a flyout centred on the row, its left on the row's right.
    it('opens beside a menu row with no gap when asked for the aside placement', () => {
      popover.open(anchor, 'aside');

      const opened = mockPopoverInstances.at(-1)?.params as { offset?: number; placeLeftOfAnchor?: boolean; asideSide?: string; width?: string };

      expect(opened.placeLeftOfAnchor).toBe(true);
      expect(opened.asideSide).toBe('right');
      expect(opened.offset).toBe(0);
      expect(opened.width).toBe('390px');
    });

    // notion-motion.md Round 32 §1 (r32-a-more-newview-narrow.*): with no room on the right it flips left,
    // its right edge on the fold menu's left + 4, and either side stops 11.8 above the window bottom.
    it('opens on the left of the row with the aside-left placement, 11.8 from the window edges', () => {
      popover.open(anchor, 'aside-left');

      const opened = mockPopoverInstances.at(-1)?.params as { offset?: number; placeLeftOfAnchor?: boolean; asideSide?: string; viewportMargin?: number };

      expect(opened.placeLeftOfAnchor).toBe(true);
      expect(opened.asideSide).toBe('left');
      expect(opened.offset).toBe(0);
      expect(opened.viewportMargin).toBe(11.8);
    });

    it('keeps the right-side flyout 11.8 from the window edges too', () => {
      popover.open(anchor, 'aside');

      expect((mockPopoverInstances.at(-1)?.params as { viewportMargin?: number }).viewportMargin).toBe(11.8);
    });

    // Round 31 §3: Notion's fold menu holds its own "New data source" row, right beside the flyout.
    it('leaves "New data source" out of a flyout beside the fold menu, which has its own', () => {
      const withSource = new DatabaseViewPopover({ onSelect, onNewSource: vi.fn() });

      withSource.open(anchor, 'aside');
      expect(params().items.some((item) => item.element?.hasAttribute('data-blok-database-view-new-source') === true)).toBe(false);
      withSource.open(anchor, 'aside-left');
      expect(params().items.some((item) => item.element?.hasAttribute('data-blok-database-view-new-source') === true)).toBe(false);
      withSource.open(anchor);
      expect(params().items.some((item) => item.element?.hasAttribute('data-blok-database-view-new-source') === true)).toBe(true);      withSource.close();
    });

    it('is a 390px grid menu', () => {
      popover.open(anchor);

      expect(params().class).toBe('blok-database-menu blok-database-add-view-menu');
      expect(params().width).toBe('390px');
    });

    it('puts a divider before "New data source", a row button', () => {
      const withSource = new DatabaseViewPopover({ onSelect, onNewSource: vi.fn() });

      withSource.open(anchor);

      const { items } = params();
      const sourceIndex = items.findIndex((item) => item.element?.hasAttribute('data-blok-database-view-new-source'));

      expect(items[sourceIndex - 1].type).toBe('separator');
      withSource.destroy();
      expect(items[sourceIndex].element?.tagName).toBe('BUTTON');
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
