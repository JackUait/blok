import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { DatabaseViewPopover } from '../../../../src/tools/database/database-view-popover';
import type { ViewType } from '../../../../src/tools/database/types';

describe('DatabaseViewPopover', () => {
  let onSelect: ReturnType<typeof vi.fn<(type: ViewType) => void>>;
  let popover: DatabaseViewPopover;
  let anchor: HTMLElement;

  beforeEach(() => {
    vi.clearAllMocks();
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

  describe('open()', () => {
    it('appends a popover element to document body', () => {
      popover.open(anchor);
      const el = document.querySelector('[data-blok-database-view-popover]');
      expect(el).not.toBeNull();
    });

    it('renders a heading with "Add a new view" text', () => {
      popover.open(anchor);
      const el = document.querySelector('[data-blok-database-view-popover]')!;
      expect(el.textContent).toContain('Add a new view');
    });

    it('renders Board option as enabled', () => {
      popover.open(anchor);
      const boardItem = document.querySelector('[data-blok-database-view-option="board"]') as HTMLElement;
      expect(boardItem).not.toBeNull();
      expect(boardItem.style.opacity).not.toBe('0.35');
      expect(boardItem.style.cursor).not.toBe('not-allowed');
    });

    it('renders Board, List, Table and Gallery options', () => {
      popover.open(anchor);
      const options = document.querySelectorAll('[data-blok-database-view-option]');
      const types = Array.from(options).map((el) => el.getAttribute('data-blok-database-view-option'));
      expect(types).toEqual(['board', 'list', 'table', 'gallery']);
    });

    it('renders Table and Gallery options as disabled', () => {
      popover.open(anchor);
      for (const type of ['table', 'gallery']) {
        const item = document.querySelector(`[data-blok-database-view-option="${type}"]`) as HTMLElement;
        expect(item).not.toBeNull();
        expect(item.style.opacity).toBe('0.35');
        expect(item.style.pointerEvents).toBe('none');
      }
    });

    it('renders List option as enabled', () => {
      popover.open(anchor);
      const listItem = document.querySelector('[data-blok-database-view-option="list"]') as HTMLElement;
      expect(listItem).not.toBeNull();
      expect(listItem.style.opacity).not.toBe('0.35');
      expect(listItem.style.pointerEvents).not.toBe('none');
    });

    it('calls onSelect with "list" when List option is clicked', () => {
      popover.open(anchor);
      const listItem = document.querySelector('[data-blok-database-view-option="list"]') as HTMLElement;
      listItem.click();
      expect(onSelect).toHaveBeenCalledWith('list');
    });

    it('calls onSelect with "board" when Board option is clicked', () => {
      popover.open(anchor);
      const boardItem = document.querySelector('[data-blok-database-view-option="board"]') as HTMLElement;
      boardItem.click();
      expect(onSelect).toHaveBeenCalledWith('board');
    });

    it('closes the popover after selecting Board', () => {
      popover.open(anchor);
      const boardItem = document.querySelector('[data-blok-database-view-option="board"]') as HTMLElement;
      boardItem.click();
      const el = document.querySelector('[data-blok-database-view-popover]');
      expect(el).toBeNull();
    });

    it('does not call onSelect when disabled option is clicked', () => {
      popover.open(anchor);
      const tableItem = document.querySelector('[data-blok-database-view-option="table"]') as HTMLElement;
      tableItem.click();
      expect(onSelect).not.toHaveBeenCalled();
    });

    it('uses fixed positioning for correct scroll behavior', () => {
      popover.open(anchor);
      const el = document.querySelector('[data-blok-database-view-popover]') as HTMLElement;
      expect(el.style.position).toBe('fixed');
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
    it('closes popover when clicking outside', () => {
      popover.open(anchor);
      // eslint-disable-next-line internal-unit-test/no-direct-event-dispatch
      document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
      const el = document.querySelector('[data-blok-database-view-popover]');
      expect(el).toBeNull();
    });
  });
});
