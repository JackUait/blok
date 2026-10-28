import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { DatabasePropertyTypePopover } from '../../../../src/tools/database/database-property-type-popover';
import type { PropertyType } from '../../../../src/tools/database/types';
import type { I18n } from '../../../../types';
import { propertyTypeMeta } from '../../../../src/tools/database/database-property-types';

const rect = (overrides: Partial<DOMRect>): DOMRect => ({
  x: 0, y: 0, width: 0, height: 0, top: 0, right: 0, bottom: 0, left: 0,
  toJSON: () => ({}),
  ...overrides,
});

describe('DatabasePropertyTypePopover', () => {
  let onSelect: ReturnType<typeof vi.fn<(type: PropertyType, name: string) => void>>;
  let popover: DatabasePropertyTypePopover;
  let anchor: HTMLElement;

  beforeEach(() => {
    vi.clearAllMocks();
    onSelect = vi.fn<(type: PropertyType, name: string) => void>();
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

    // A top-layer modal pulls focus back into itself; a menu on body would hide under it.
    it('mounts inside the top-layer modal that holds its anchor, and focuses its name field there', () => {
      const dialog = document.createElement('div');
      const named = new DatabasePropertyTypePopover({ onSelect, withNameField: true });

      dialog.setAttribute('role', 'dialog');
      dialog.setAttribute('aria-modal', 'true');
      dialog.setAttribute('data-blok-top-layer', 'true');
      dialog.appendChild(anchor);
      document.body.appendChild(dialog);
      named.open(anchor);
      const el = document.querySelector('[data-blok-database-property-type-popover]');

      expect(el?.parentElement).toBe(dialog);
      expect(el?.querySelector('[data-blok-database-property-name-input]')).toHaveFocus();
      named.destroy();
      dialog.remove();

      expect(document.querySelector('[data-blok-database-property-type-popover]')).toBeNull();
    });

    // The side peek is in the top layer but not modal: on body the menu would paint under it.
    it('mounts inside a top-layer panel that is not modal, like the side peek', () => {
      const peek = document.createElement('div');

      peek.setAttribute('data-blok-top-layer', 'true');
      peek.appendChild(anchor);
      document.body.appendChild(peek);
      popover.open(anchor);

      expect(document.querySelector('[data-blok-database-property-type-popover]')?.parentElement).toBe(peek);
      popover.destroy();
      peek.remove();
    });

    it('stays on body for a modal outside the top layer', () => {
      const peek = document.createElement('div');

      peek.setAttribute('aria-modal', 'true');
      peek.appendChild(anchor);
      document.body.appendChild(peek);
      popover.open(anchor);

      expect(document.querySelector('[data-blok-database-property-type-popover]')?.parentElement).toBe(document.body);
      popover.destroy();
      peek.remove();
    });

    it('takes the anchor direction so it mirrors in an RTL editor', () => {
      anchor.style.direction = 'rtl';
      popover.open(anchor);
      const el = document.querySelector('[data-blok-database-property-type-popover]');
      expect(el?.getAttribute('dir')).toBe('rtl');
    });

    it('uses fixed positioning for correct scroll behavior', () => {
      popover.open(anchor);
      const el = document.querySelector('[data-blok-database-property-type-popover]') as HTMLElement;
      expect(el.style.position).toBe('fixed');
    });

    it('stays attached when a nested ancestor scrolls after opening', () => {
      const scrollHost = document.createElement('div');

      scrollHost.appendChild(anchor);
      document.body.appendChild(scrollHost);
      const anchorRectSpy = vi.spyOn(anchor, 'getBoundingClientRect').mockReturnValue(
        rect({ top: 100, bottom: 140, left: 50, right: 90, width: 40, height: 40 })
      );

      popover.open(anchor);
      const el = document.querySelector('[data-blok-database-property-type-popover]') as HTMLElement;

      expect(el.style.top).toBe('144px');

      anchorRectSpy.mockReturnValue(
        rect({ top: 60, bottom: 100, left: 50, right: 90, width: 40, height: 40 })
      );
      scrollHost.dispatchEvent(new Event('scroll'));

      expect(el.style.top).toBe('104px');
    });

    it('flips above the anchor instead of overflowing the viewport bottom', () => {
      vi.spyOn(anchor, 'getBoundingClientRect').mockReturnValue(
        rect({ top: 700, bottom: 740, left: 50, right: 90, width: 40, height: 40 })
      );
      vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(function getOffsetHeight(this: HTMLElement): number {
        return this.hasAttribute('data-blok-database-property-type-popover') ? 200 : 0;
      });

      popover.open(anchor);
      const el = document.querySelector('[data-blok-database-property-type-popover]') as HTMLElement;

      // notion-spec-2 §18.5: above, its bottom sits 1px over the button.
      expect(el.style.top).toBe('499px');
      expect(el.getAttribute('data-side')).toBe('top');
    });

    // notion-spec-2 §18.5: too tall for either side, it covers its button with its bottom 11px over the viewport's.
    it('covers the anchor, bottom pinned 11px above the viewport bottom, when it fits neither below nor above', () => {
      vi.spyOn(window, 'innerHeight', 'get').mockReturnValue(717);
      vi.spyOn(anchor, 'getBoundingClientRect').mockReturnValue(
        rect({ top: 390, bottom: 424, left: 50, right: 182, width: 132, height: 34 })
      );
      vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(function getOffsetHeight(this: HTMLElement): number {
        return this.hasAttribute('data-blok-database-property-type-popover') ? 600 : 0;
      });

      popover.open(anchor);
      const el = document.querySelector('[data-blok-database-property-type-popover]') as HTMLElement;

      expect(el.style.top).toBe('106px');
    });

    // notion-spec-2 §18.5: a search shrinks the list and it stays bottom-anchored; it never jumps under the button.
    it('keeps the side it opened on when a search shrinks it', () => {
      const scrollHost = document.createElement('div');
      let height = 600;

      scrollHost.appendChild(anchor);
      document.body.appendChild(scrollHost);
      vi.spyOn(window, 'innerHeight', 'get').mockReturnValue(717);
      vi.spyOn(anchor, 'getBoundingClientRect').mockReturnValue(
        rect({ top: 390, bottom: 424, left: 50, right: 182, width: 132, height: 34 })
      );
      vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(function getOffsetHeight(this: HTMLElement): number {
        return this.hasAttribute('data-blok-database-property-type-popover') ? height : 0;
      });

      popover.open(anchor);
      const el = document.querySelector('[data-blok-database-property-type-popover]') as HTMLElement;

      height = 200;
      scrollHost.dispatchEvent(new Event('scroll'));

      expect(el.style.top).toBe('506px');
      expect(el.getAttribute('data-side')).toBe('bottom');
    });

    it('renders every user-addable property type', () => {
      popover.open(anchor);
      const types: PropertyType[] = ['text', 'number', 'select', 'multiSelect', 'status', 'date', 'files', 'checkbox', 'url', 'phone', 'email', 'uniqueId', 'createdTime', 'lastEditedTime', 'createdBy', 'lastEditedBy'];
      for (const type of types) {
        const item = document.querySelector(`[data-blok-database-property-type-option="${type}"]`);
        expect(item).not.toBeNull();
      }
    });

    it('offers Person only when the host has a people directory', () => {
      popover.open(anchor);
      expect(document.querySelector('[data-blok-database-property-type-option="person"]')).toBeNull();

      const withPeople = new DatabasePropertyTypePopover({ onSelect, hasPeople: true });

      withPeople.open(anchor);
      expect(document.querySelector('[data-blok-database-property-type-option="person"]')).not.toBeNull();
      withPeople.destroy();
    });

    it('names the new property from its name field, as Notion\'s "+" flow does', () => {
      const named = vi.fn<(type: PropertyType, name: string) => void>();
      const flow = new DatabasePropertyTypePopover({ onSelect: named, withNameField: true });

      flow.open(anchor);
      const field = document.querySelector<HTMLInputElement>('[data-blok-database-property-name-input]');

      expect(field).not.toBeNull();
      expect(field).toHaveFocus();
      if (field === null) return;
      field.value = 'Budget';
      field.dispatchEvent(new Event('input'));
      document.querySelector<HTMLElement>('[data-blok-database-property-type-option="number"]')?.click();

      expect(named).toHaveBeenCalledWith('number', 'Budget');
      flow.destroy();
    });

    // notion-spec-2 §18.5: a typed name then Enter makes a Text property with that name.
    it('makes a Text property from the typed name on Enter', () => {
      const named = vi.fn<(type: PropertyType, name: string) => void>();
      const flow = new DatabasePropertyTypePopover({ onSelect: named, withNameField: true });

      flow.open(anchor);
      const field = document.querySelector<HTMLInputElement>('[data-blok-database-property-name-input]');

      if (field === null) throw new Error('no name field');
      field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      expect(named).not.toHaveBeenCalled();
      field.value = 'Budget';
      field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));

      expect(named).toHaveBeenCalledWith('text', 'Budget');
      expect(flow.isOpen).toBe(false);
      flow.destroy();
    });

    // notion-spec-2 §18.5: arrows highlight a type, Enter makes it at once.
    it('walks the shown types with the arrows and makes the highlighted one on Enter', () => {
      const named = vi.fn<(type: PropertyType, name: string) => void>();
      const flow = new DatabasePropertyTypePopover({ onSelect: named, withNameField: true });

      flow.open(anchor);
      const field = document.querySelector<HTMLInputElement>('[data-blok-database-property-name-input]');
      const key = (k: string): void => {
        document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));
      };
      const active = (): string[] => [...document.querySelectorAll('[data-blok-database-property-type-option-active]')]
        .map((el) => el.getAttribute('data-blok-database-property-type-option') ?? '');

      if (field === null) throw new Error('no name field');
      field.value = 'Cost';
      key('ArrowDown');
      expect(active()).toEqual(['text']);
      key('ArrowDown');
      key('ArrowDown');
      key('ArrowUp');
      expect(active()).toEqual(['number']);
      key('Enter');

      expect(named).toHaveBeenCalledTimes(1);
      expect(named).toHaveBeenCalledWith('number', 'Cost');
      expect(flow.isOpen).toBe(false);
      flow.destroy();
    });

    // notion-spec-2 §19.8: the arrows walk the menu from its top, AI Autofill rows first; a 🔍 click drops the highlight.
    it('walks from "Search types" into the AI Autofill rows first, then the types', () => {
      const autofill = vi.fn<(mode: 'summary' | 'translate', name: string) => void>();
      const flow = new DatabasePropertyTypePopover({ onSelect: vi.fn(), withNameField: true, onAutofill: autofill });
      const active = (): string[] => [...document.querySelectorAll('[data-blok-database-property-type-option-active]')]
        .map((el) => el.getAttribute('data-blok-database-property-autofill-option') ?? el.getAttribute('data-blok-database-property-type-option') ?? '');

      flow.open(anchor);
      const field = document.querySelector<HTMLInputElement>('[data-blok-database-property-name-input]');

      field?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }));
      expect(active()).toEqual(['summary']);
      document.querySelector<HTMLElement>('[data-blok-database-property-type-search]')?.click();
      expect(active()).toEqual([]);
      const search = document.querySelector<HTMLInputElement>('[data-blok-database-property-type-search-input]');
      const key = (k: string): void => {
        search?.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));
      };

      key('ArrowDown');
      expect(active()).toEqual(['summary']);
      key('ArrowDown');
      expect(active()).toEqual(['translate']);
      key('ArrowDown');
      expect(active()).toEqual(['text']);
      key('ArrowUp');
      key('Enter');

      expect(autofill).toHaveBeenCalledWith('translate', '');
      expect(flow.isOpen).toBe(false);
      flow.destroy();
    });

    it('skips types the search hid', () => {
      const named = vi.fn<(type: PropertyType, name: string) => void>();
      const flow = new DatabasePropertyTypePopover({ onSelect: named, withNameField: true, i18n: { t: (k: string) => k.replace('tools.database.propertyType', ''), has: () => true } as unknown as I18n });

      flow.open(anchor);
      document.querySelector<HTMLElement>('[data-blok-database-property-type-search]')?.click();
      const search = document.querySelector<HTMLInputElement>('[data-blok-database-property-type-search-input]');

      if (search === null) throw new Error('no search field');
      search.value = 'phone';
      search.dispatchEvent(new Event('input'));
      search.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }));
      search.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));

      expect(named).toHaveBeenCalledWith('phone', '');
      flow.destroy();
    });

    // research/08, research/12 §1, research/14 §1, notion-spec-2 §17.9: the table header "+" picker.
    it('draws the grid layout with "Select type", the header order and a "Type property name…" field', () => {
      const i18n = { t: (key: string) => `i18n:${key}`, has: () => true } as unknown as I18n;
      const grid = new DatabasePropertyTypePopover({ onSelect: vi.fn(), withNameField: true, i18n, layout: 'grid' });

      grid.open(anchor);
      const root = document.querySelector('[data-blok-database-property-type-popover]');
      const order = [...document.querySelectorAll('[data-blok-database-property-type-option]')]
        .map((el) => el.getAttribute('data-blok-database-property-type-option'));

      expect(root?.getAttribute('data-blok-database-property-type-layout')).toBe('grid');
      expect(root?.querySelector('[data-blok-database-property-type-list-heading]')?.textContent?.trim()).toBe('i18n:tools.database.formSelectType');
      expect(root?.querySelector('[data-blok-database-property-name-input]')?.getAttribute('placeholder')).toBe('i18n:tools.database.propertyNamePlaceholder');
      expect(order).toEqual([
        'text', 'number', 'select', 'multiSelect', 'status', 'date', 'files', 'checkbox', 'url', 'phone', 'email',
        'relation', 'rollup', 'formula', 'button', 'uniqueId', 'place', 'createdTime', 'lastEditedTime', 'createdBy', 'lastEditedBy',
        'verification',
      ]);
      grid.destroy();
    });

    it('keeps the list layout by default', () => {
      popover.open(anchor);

      expect(document.querySelector('[data-blok-database-property-type-popover]')?.hasAttribute('data-blok-database-property-type-layout')).toBe(false);
    });

    // feel/findings-table T12: Notion's name field heads the menu; the types sit in a grid that scrolls under it.
    it('puts the name field in a header and the types in one scrolling grid', () => {
      const flow = new DatabasePropertyTypePopover({ onSelect: vi.fn(), withNameField: true });

      flow.open(anchor);
      const root = document.querySelector('[data-blok-database-property-type-popover]');
      const header = root?.querySelector(':scope > [data-blok-database-property-type-header]');
      const grid = root?.querySelector(':scope > [data-blok-database-property-type-body] > [data-blok-database-property-type-grid]');

      expect(header?.querySelector('[data-blok-database-property-name-input]')).not.toBeNull();
      expect(grid?.querySelectorAll(':scope > [data-blok-database-property-type-option]').length).toBeGreaterThan(10);
      expect(root?.querySelector('[data-blok-database-property-type-body] > [data-blok-database-property-type-heading]')).not.toBeNull();
      flow.destroy();
    });

    // Notion 2026-10-25: a Text glyph, then "Property name".
    it('heads the menu with a Text glyph and a "Property name" field', () => {
      const i18n = { t: (key: string) => `i18n:${key}`, has: () => true } as unknown as I18n;
      const flow = new DatabasePropertyTypePopover({ onSelect: vi.fn(), withNameField: true, i18n });

      flow.open(anchor);
      const root = document.querySelector('[data-blok-database-property-type-popover]');
      const header = root?.querySelector('[data-blok-database-property-type-header]');
      const glyph = header?.querySelector(':scope > [data-blok-database-property-type-glyph]');
      const field = header?.querySelector<HTMLInputElement>('[data-blok-database-property-name-input]');

      expect(glyph?.nextElementSibling).toBe(field);
      const textIcon = document.createElement('div');

      textIcon.innerHTML = propertyTypeMeta('text').icon;
      expect(glyph?.innerHTML).toBe(textIcon.innerHTML);
      expect(field?.placeholder).toBe('i18n:tools.database.propertyName');
      // The shared field look draws the box and its focus ring.
      expect(field?.getAttribute('data-blok-field')).toBe('text');
      expect(root?.querySelector('[data-blok-database-property-type-heading]')?.textContent?.trim()).toBe('i18n:tools.database.propertyTypeListHeading');
      flow.destroy();
    });

    // Notion 2026-10-25: the list is headed "Type" with a magnifier that turns into a filter field.
    it('heads the list "Type" with a search button that filters the types', () => {
      const i18n = { t: (key: string) => `i18n:${key}`, has: () => true } as unknown as I18n;
      const flow = new DatabasePropertyTypePopover({ onSelect: vi.fn(), withNameField: true, i18n });

      flow.open(anchor);
      const root = document.querySelector('[data-blok-database-property-type-popover]');
      const heading = root?.querySelector('[data-blok-database-property-type-list-heading]');
      const search = heading?.querySelector<HTMLButtonElement>('button[data-blok-database-property-type-search]');

      expect(heading?.textContent?.trim()).toBe('i18n:tools.database.propertyTypeListHeading');
      expect(search?.getAttribute('aria-label')).toBe('i18n:tools.database.csvSearchTypes');
      search?.click();
      const field = root?.querySelector<HTMLInputElement>('[data-blok-database-property-type-search-input]');

      expect(field).toHaveFocus();
      expect(field?.getAttribute('aria-label')).toBe('i18n:tools.database.csvSearchTypes');
      // notion-spec-2 §18.5: the label stays, and the field opens under it.
      expect(heading?.textContent?.trim()).toBe('i18n:tools.database.propertyTypeListHeading');
      expect(heading?.nextElementSibling).toBe(field);
      search?.click();
      expect(root?.querySelectorAll('[data-blok-database-property-type-search-input]')).toHaveLength(1);
      if (field === null || field === undefined) return;
      field.value = 'TIME';
      field.dispatchEvent(new Event('input'));
      const shown = [...document.querySelectorAll<HTMLElement>('[data-blok-database-property-type-option]')]
        .filter((option) => !option.hidden)
        .map((option) => option.getAttribute('data-blok-database-property-type-option'));

      // Labels here are the i18n keys; the match ignores case.
      expect(shown).toEqual(['createdTime', 'lastEditedTime']);
      field.value = '';
      field.dispatchEvent(new Event('input'));
      expect([...document.querySelectorAll<HTMLElement>('[data-blok-database-property-type-option]')].every((option) => !option.hidden)).toBe(true);
      flow.destroy();
    });

    it('draws Summarize with the Text lines glyph', () => {
      const flow = new DatabasePropertyTypePopover({ onSelect: vi.fn(), withNameField: true, onAutofill: vi.fn() });
      const lines = document.createElement('div');

      lines.innerHTML = propertyTypeMeta('text').icon;
      flow.open(anchor);

      expect(document.querySelector('[data-blok-database-property-autofill-option="summary"] [data-blok-database-property-type-option-icon]')?.innerHTML).toBe(lines.innerHTML);
      flow.destroy();
    });

    it('lists the types in Notion\'s order, one per row', () => {
      const flow = new DatabasePropertyTypePopover({ onSelect: vi.fn(), hasPeople: true });

      flow.open(anchor);
      const order = [...document.querySelectorAll('[data-blok-database-property-type-option]')]
        .map((option) => option.getAttribute('data-blok-database-property-type-option'));

      expect(order).toEqual([
        'text', 'number', 'select', 'multiSelect', 'status', 'date', 'person', 'files', 'checkbox', 'url', 'email', 'phone',
        'formula', 'relation', 'rollup', 'createdTime', 'createdBy', 'lastEditedTime', 'lastEditedBy', 'button', 'place', 'uniqueId',
        'verification',
      ]);
      flow.destroy();
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
      expect(onSelect).toHaveBeenCalledWith('text', '');
    });

    it('calls onSelect with "number" when number option is clicked', () => {
      popover.open(anchor);
      const item = document.querySelector('[data-blok-database-property-type-option="number"]') as HTMLElement;
      item.click();
      expect(onSelect).toHaveBeenCalledWith('number', '');
    });

    it('calls onSelect with "select" when select option is clicked', () => {
      popover.open(anchor);
      const item = document.querySelector('[data-blok-database-property-type-option="select"]') as HTMLElement;
      item.click();
      expect(onSelect).toHaveBeenCalledWith('select', '');
    });

    it('calls onSelect with "multiSelect" when multiSelect option is clicked', () => {
      popover.open(anchor);
      const item = document.querySelector('[data-blok-database-property-type-option="multiSelect"]') as HTMLElement;
      item.click();
      expect(onSelect).toHaveBeenCalledWith('multiSelect', '');
    });

    it('calls onSelect with "date" when date option is clicked', () => {
      popover.open(anchor);
      const item = document.querySelector('[data-blok-database-property-type-option="date"]') as HTMLElement;
      item.click();
      expect(onSelect).toHaveBeenCalledWith('date', '');
    });

    it('calls onSelect with "checkbox" when checkbox option is clicked', () => {
      popover.open(anchor);
      const item = document.querySelector('[data-blok-database-property-type-option="checkbox"]') as HTMLElement;
      item.click();
      expect(onSelect).toHaveBeenCalledWith('checkbox', '');
    });

    it('calls onSelect with "url" when url option is clicked', () => {
      popover.open(anchor);
      const item = document.querySelector('[data-blok-database-property-type-option="url"]') as HTMLElement;
      item.click();
      expect(onSelect).toHaveBeenCalledWith('url', '');
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
        if (label !== null) {
          expect((label.textContent ?? '').trim().length).toBeGreaterThan(0);
        }
      }
    });

    it('sets data-blok-popover-opened on the popover element so the card drawer does not close on mousedown', () => {
      popover.open(anchor);
      const el = document.querySelector('[data-blok-database-property-type-popover]');
      expect(el).not.toBeNull();
      expect(el!.hasAttribute('data-blok-popover-opened')).toBe(true);
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

  // notion-spec-2 §19.22: Escape plays the open in reverse (opacity → 0, scale → 0.96, ~200ms), then the menu leaves.
  describe('close motion', () => {
    const SELECTOR = '[data-blok-database-property-type-popover]';
    let finish: () => void = () => undefined;

    beforeEach(() => {
      const finished = new Promise<void>((resolve) => { finish = resolve; });

      Object.defineProperty(HTMLElement.prototype, 'getAnimations', {
        configurable: true,
        value: () => [{ finished }],
      });
    });

    afterEach(() => {
      Reflect.deleteProperty(HTMLElement.prototype, 'getAnimations');
    });

    it('keeps the menu on screen, closed, until the Escape fade ends', async () => {
      popover.open(anchor);
      const el = document.querySelector<HTMLElement>(SELECTOR);

      el?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

      expect(el?.isConnected).toBe(true);
      expect(el?.hasAttribute('data-blok-closing')).toBe(true);
      expect(el?.hasAttribute('inert')).toBe(true);
      expect(popover.isOpen).toBe(false);
      finish();
      await Promise.resolve();
      await Promise.resolve();

      expect(el?.isConnected).toBe(false);
    });

    it('drops a fading menu at once when it opens again', () => {
      popover.open(anchor);
      document.querySelector<HTMLElement>(SELECTOR)?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      popover.open(anchor);

      expect(document.querySelectorAll(SELECTOR)).toHaveLength(1);
      expect(document.querySelector(SELECTOR)?.hasAttribute('data-blok-closing')).toBe(false);
    });

    it('removes the menu at once when a type is picked, so it never sits over the panel that follows', () => {
      popover.open(anchor);
      document.querySelector<HTMLElement>('[data-blok-database-property-type-option="number"]')?.click();

      expect(document.querySelector(SELECTOR)).toBeNull();
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
