import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { DatabasePropertyTypePopover } from '../../../../src/tools/database/database-property-type-popover';
import type { PropertyType } from '../../../../src/tools/database/types';

describe('DatabasePropertyTypePopover', () => {
  let onSelect: ReturnType<typeof vi.fn<(type: PropertyType) => void>>;
  let popover: DatabasePropertyTypePopover;
  let anchor: HTMLElement;

  beforeEach(() => {
    vi.clearAllMocks();
    onSelect = vi.fn<(type: PropertyType) => void>();
    anchor = document.createElement('button');
    document.body.appendChild(anchor);
    popover = new DatabasePropertyTypePopover({ onSelect });
  });

  afterEach(() => {
    popover.destroy();
    anchor.remove();
    vi.restoreAllMocks();
  });

  describe('open()', () => {
    it('appends a popover element to document body', () => {
      popover.open(anchor);
      const el = document.querySelector('[data-blok-database-property-type-popover]');
      expect(el).not.toBeNull();
    });

    it('uses fixed positioning for correct scroll behavior', () => {
      popover.open(anchor);
      const el = document.querySelector('[data-blok-database-property-type-popover]') as HTMLElement;
      expect(el.style.position).toBe('fixed');
    });

    it('renders all 7 user-addable property types', () => {
      popover.open(anchor);
      const types: PropertyType[] = ['text', 'number', 'select', 'multiSelect', 'date', 'checkbox', 'url'];
      for (const type of types) {
        const item = document.querySelector(`[data-blok-database-property-type-option="${type}"]`);
        expect(item).not.toBeNull();
      }
    });

    it('does not render title or richText options', () => {
      popover.open(anchor);
      expect(document.querySelector('[data-blok-database-property-type-option="title"]')).toBeNull();
      expect(document.querySelector('[data-blok-database-property-type-option="richText"]')).toBeNull();
    });

    it('calls onSelect with "text" when text option is clicked', () => {
      popover.open(anchor);
      const item = document.querySelector('[data-blok-database-property-type-option="text"]') as HTMLElement;
      item.click();
      expect(onSelect).toHaveBeenCalledWith('text');
    });

    it('calls onSelect with "number" when number option is clicked', () => {
      popover.open(anchor);
      const item = document.querySelector('[data-blok-database-property-type-option="number"]') as HTMLElement;
      item.click();
      expect(onSelect).toHaveBeenCalledWith('number');
    });

    it('calls onSelect with "select" when select option is clicked', () => {
      popover.open(anchor);
      const item = document.querySelector('[data-blok-database-property-type-option="select"]') as HTMLElement;
      item.click();
      expect(onSelect).toHaveBeenCalledWith('select');
    });

    it('calls onSelect with "multiSelect" when multiSelect option is clicked', () => {
      popover.open(anchor);
      const item = document.querySelector('[data-blok-database-property-type-option="multiSelect"]') as HTMLElement;
      item.click();
      expect(onSelect).toHaveBeenCalledWith('multiSelect');
    });

    it('calls onSelect with "date" when date option is clicked', () => {
      popover.open(anchor);
      const item = document.querySelector('[data-blok-database-property-type-option="date"]') as HTMLElement;
      item.click();
      expect(onSelect).toHaveBeenCalledWith('date');
    });

    it('calls onSelect with "checkbox" when checkbox option is clicked', () => {
      popover.open(anchor);
      const item = document.querySelector('[data-blok-database-property-type-option="checkbox"]') as HTMLElement;
      item.click();
      expect(onSelect).toHaveBeenCalledWith('checkbox');
    });

    it('calls onSelect with "url" when url option is clicked', () => {
      popover.open(anchor);
      const item = document.querySelector('[data-blok-database-property-type-option="url"]') as HTMLElement;
      item.click();
      expect(onSelect).toHaveBeenCalledWith('url');
    });

    it('closes the popover after selecting a type', () => {
      popover.open(anchor);
      const item = document.querySelector('[data-blok-database-property-type-option="text"]') as HTMLElement;
      item.click();
      const el = document.querySelector('[data-blok-database-property-type-popover]');
      expect(el).toBeNull();
    });

    it('each option has an icon element', () => {
      popover.open(anchor);
      const types: PropertyType[] = ['text', 'number', 'select', 'multiSelect', 'date', 'checkbox', 'url'];
      for (const type of types) {
        const item = document.querySelector(`[data-blok-database-property-type-option="${type}"]`);
        expect(item).not.toBeNull();
        const icon = item!.querySelector('[data-blok-database-property-type-option-icon]');
        expect(icon).not.toBeNull();
      }
    });

    it('each option has a label with non-empty text', () => {
      popover.open(anchor);
      const types: PropertyType[] = ['text', 'number', 'select', 'multiSelect', 'date', 'checkbox', 'url'];
      for (const type of types) {
        const item = document.querySelector(`[data-blok-database-property-type-option="${type}"]`);
        const label = item!.querySelector('span');
        expect(label).not.toBeNull();
        expect(label!.textContent!.trim().length).toBeGreaterThan(0);
      }
    });

    it('closing and reopening replaces the old popover with a new one', () => {
      popover.open(anchor);
      popover.open(anchor);
      const els = document.querySelectorAll('[data-blok-database-property-type-popover]');
      expect(els.length).toBe(1);
    });
  });

  describe('close()', () => {
    it('removes the popover element from the DOM', () => {
      popover.open(anchor);
      popover.close();
      const el = document.querySelector('[data-blok-database-property-type-popover]');
      expect(el).toBeNull();
    });

    it('is safe to call when popover is not open', () => {
      expect(() => popover.close()).not.toThrow();
    });
  });

  describe('destroy()', () => {
    it('removes the popover element from the DOM', () => {
      popover.open(anchor);
      popover.destroy();
      const el = document.querySelector('[data-blok-database-property-type-popover]');
      expect(el).toBeNull();
    });
  });

  describe('outside click', () => {
    it('closes popover when clicking outside', () => {
      popover.open(anchor);
      document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
      const el = document.querySelector('[data-blok-database-property-type-popover]');
      expect(el).toBeNull();
    });

    it('does not close popover when clicking inside the popover', () => {
      popover.open(anchor);
      const el = document.querySelector('[data-blok-database-property-type-popover]') as HTMLElement;
      el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
      const stillOpen = document.querySelector('[data-blok-database-property-type-popover]');
      expect(stillOpen).not.toBeNull();
    });
  });
});
