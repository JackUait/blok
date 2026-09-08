import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { DatabasePropertyTypePopover } from '../../../../src/tools/database/database-property-type-popover';
import type { PropertyType } from '../../../../src/tools/database/types';
import type { I18n } from '../../../../types';

const echoI18n = (): I18n => ({
  t: (key: string) => `i18n:${key}`,
  has: () => true,
} as unknown as I18n);

interface Harness {
  popover: DatabasePropertyTypePopover;
  anchor: HTMLElement;
  onSelect: ReturnType<typeof vi.fn>;
}

/** `null` means "no i18n at all"; a default parameter cannot express that. */
const build = (i18n: I18n | null = echoI18n()): Harness => {
  const anchor = document.createElement('button');

  document.body.appendChild(anchor);

  const onSelect = vi.fn();

  return {
    popover: new DatabasePropertyTypePopover({ onSelect, i18n: i18n ?? undefined }),
    anchor,
    onSelect,
  };
};

const panel = (): HTMLElement | null =>
  document.body.querySelector('[data-blok-database-property-type-popover]');

const optionFor = (type: string): HTMLElement | null =>
  document.body.querySelector(`[data-blok-database-property-type-option="${type}"]`);

const TYPES: PropertyType[] = ['text', 'number', 'select', 'multiSelect', 'date', 'checkbox', 'url'];

describe('database property type popover mutants', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    document.body.innerHTML = '';
  });

  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  describe('what it opens', () => {
    it('offers every property type, in order, each with an icon', () => {
      const { popover, anchor } = build();

      popover.open(anchor);

      const options = Array.from(
        document.body.querySelectorAll('[data-blok-database-property-type-option]'),
      );

      expect(options.map((el) => el.getAttribute('data-blok-database-property-type-option')))
        .toStrictEqual(TYPES);

      for (const option of options) {
        expect(option.querySelector('[data-blok-database-property-type-option-icon] svg')).not.toBeNull();
      }
    });

    it('gives each type a distinct icon', () => {
      const { popover, anchor } = build();

      popover.open(anchor);

      const icons = Array.from(
        document.body.querySelectorAll('[data-blok-database-property-type-option-icon]'),
      ).map((el) => el.innerHTML);

      expect(new Set(icons).size).toBe(icons.length);
    });

    it('routes the heading and every label through i18n', () => {
      const { popover, anchor } = build();

      popover.open(anchor);

      expect(
        document.body.querySelector('[data-blok-database-property-type-heading]')?.textContent,
      ).toBe('i18n:tools.database.propertyTypeHeading');
      expect(optionFor('multiSelect')?.querySelector('span')?.textContent)
        .toBe('i18n:tools.database.propertyTypeMultiSelect');
    });

    it('falls back to the key itself with no i18n', () => {
      const { popover, anchor } = build(null);

      popover.open(anchor);

      expect(
        document.body.querySelector('[data-blok-database-property-type-heading]')?.textContent,
      ).toBe('tools.database.propertyTypeHeading');
      expect(optionFor('url')?.querySelector('span')?.textContent)
        .toBe('tools.database.propertyTypeUrl');
    });

    it('marks itself as an open popover and lifts it above the page', () => {
      const { popover, anchor } = build();

      popover.open(anchor);

      const el = panel();

      expect(el?.hasAttribute('data-blok-popover')).toBe(true);
      expect(el?.hasAttribute('data-blok-popover-opened')).toBe(true);
      expect(el?.style.zIndex).toBe('1000');
    });

    it('anchors itself below the trigger', () => {
      const { popover, anchor } = build();

      popover.open(anchor);

      expect(panel()?.style.position).toBe('fixed');
      expect(panel()?.getAttribute('data-side')).toBe('bottom');
    });

    it('replaces a panel that is already open rather than stacking a second', () => {
      const { popover, anchor } = build();

      popover.open(anchor);
      popover.open(anchor);

      expect(document.body.querySelectorAll('[data-blok-database-property-type-popover]')).toHaveLength(1);
    });
  });

  describe('choosing a type', () => {
    it.each(TYPES)('reports %s and closes', (type) => {
      const { popover, anchor, onSelect } = build();

      popover.open(anchor);
      optionFor(type)?.click();

      expect(onSelect).toHaveBeenCalledWith(type);
      expect(panel()).toBeNull();
    });
  });

  describe('dismissal', () => {
    it('closes on a press outside itself and its trigger', () => {
      const { popover, anchor } = build();

      popover.open(anchor);
      document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));

      expect(panel()).toBeNull();
    });

    it('stays open for a press inside itself', () => {
      const { popover, anchor } = build();

      popover.open(anchor);

      const heading = document.body.querySelector('[data-blok-database-property-type-heading]');

      heading?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));

      expect(panel()).not.toBeNull();
    });

    it('stays open for a press on its own trigger', () => {
      const { popover, anchor } = build();

      popover.open(anchor);
      anchor.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));

      expect(panel()).not.toBeNull();
    });

    it('stops listening once closed', () => {
      const { popover, anchor, onSelect } = build();

      popover.open(anchor);
      popover.close();

      expect(() => document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))).not.toThrow();
      expect(onSelect).not.toHaveBeenCalled();
    });

    it('is safe to close twice, and to close without opening', () => {
      const { popover, anchor } = build();

      popover.open(anchor);
      popover.close();

      expect(() => popover.close()).not.toThrow();
      expect(() => new DatabasePropertyTypePopover({ onSelect: vi.fn() }).close()).not.toThrow();
    });

    it('tears down through destroy as well as close', () => {
      const { popover, anchor } = build();

      popover.open(anchor);
      popover.destroy();

      expect(panel()).toBeNull();
    });
  });
});
