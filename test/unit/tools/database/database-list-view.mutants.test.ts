import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { DatabaseListView } from '../../../../src/tools/database/database-list-view';
import type { DatabaseRow, PropertyDefinition, SelectOption } from '../../../../src/tools/database/types';
import type { I18n } from '../../../../types';

/**
 * Mutation-focused companion to database-list-view.test.ts.
 *
 * Every assertion here pins a COMPLETE produced value — the whole serialized
 * subtree, the whole attribute map, or the exact collaborator call list — because
 * the marker attributes this view writes all carry an EMPTY value: `hasAttribute`
 * and `querySelector('[marker]')` both stay true when the value is replaced, so
 * only the serialized value can see the change.
 *
 * The i18n stub answers `T(<key>)` rather than the key itself: with an identity
 * stub, `t('')` and a concatenated `'+ ' + t(key)` are indistinguishable from a
 * key that was blanked.
 */

const TITLE_PROP: PropertyDefinition = { id: 'title', name: 'Title', type: 'title', position: 'a0' };

const makeRow = (overrides: Partial<DatabaseRow> = {}): DatabaseRow => ({
  id: 'row-1',
  position: 'a0',
  properties: { title: 'Fix bug' },
  ...overrides,
});

const createI18n = (): I18n => ({
  t: vi.fn((key: string) => `T(${key})`),
  has: vi.fn(() => true),
  getEnglishTranslation: vi.fn(() => ''),
  getLocale: vi.fn(() => 'en'),
});

const attrs = (el: Element): Record<string, string> =>
  Object.fromEntries(Array.from(el.attributes).map((attr): [string, string] => [attr.name, attr.value]));

const rowPropsHtml = (rowId: string): string =>
  '<div data-blok-database-list-row-properties="">'
  + '<button data-blok-database-list-row-open="" aria-label="T(tools.database.openRow)"></button>'
  + `<button data-blok-database-delete-row="" data-row-id="${rowId}" aria-label="T(tools.database.deleteRow)">×</button>`
  + '</div>';

const rowHtml = (rowId: string, title: string): string =>
  `<div data-blok-database-list-row="" data-row-id="${rowId}" role="listitem">`
  + `<div data-blok-database-list-row-title="">${title}</div>`
  + rowPropsHtml(rowId)
  + '</div>';

const ADD_ROW_HTML =
  '<button data-blok-database-add-row="" aria-label="T(tools.database.addRow)">+ T(tools.database.newRow)</button>';

const FLAT_HTML =
  '<div data-blok-database-list="" role="list" aria-label="T(tools.database.listView)">'
  + rowHtml('row-1', 'Fix bug')
  + ADD_ROW_HTML
  + '</div>';

const PLACEHOLDER_TITLE_HTML =
  '<div data-blok-database-list-row-title="" data-placeholder="">T(tools.database.rowTitlePlaceholder)</div>';

const OPTION_A: SelectOption = { id: 'opt-a', label: 'Alpha', color: 'red', position: 'a0' };

describe('DatabaseListView — mutation coverage', () => {
  let i18n: I18n;

  beforeEach(() => {
    vi.clearAllMocks();
    i18n = createI18n();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('createView — flat branch', () => {
    it('serializes the whole flat list: wrapper markers, row markers, open/delete buttons and add-row button', () => {
      const view = new DatabaseListView({
        readOnly: false,
        i18n,
        rows: [makeRow()],
        titlePropertyId: 'title',
        schema: [TITLE_PROP],
        visiblePropertyIds: [],
      });

      const list = view.createView();

      expect(list.outerHTML).toBe(FLAT_HTML);
      expect(attrs(list)).toStrictEqual({
        'data-blok-database-list': '',
        'role': 'list',
        'aria-label': 'T(tools.database.listView)',
      });

      const addRowBtn = list.querySelector('[data-blok-database-add-row]');

      // The flat add-row button is created without an optionId: a guard that
      // always fired would stamp the string "undefined" here.
      expect(addRowBtn === null ? null : attrs(addRowBtn)).toStrictEqual({
        'data-blok-database-add-row': '',
        'aria-label': 'T(tools.database.addRow)',
      });
    });

    it('renders the placeholder title with an empty data-placeholder marker when the stored title is an empty string', () => {
      const view = new DatabaseListView({
        readOnly: false,
        i18n,
        rows: [makeRow({ properties: { title: '' } })],
        titlePropertyId: 'title',
        schema: [TITLE_PROP],
        visiblePropertyIds: [],
      });

      const list = view.createView();
      const titleEl = list.querySelector('[data-blok-database-list-row-title]');

      expect(titleEl?.outerHTML).toBe(PLACEHOLDER_TITLE_HTML);
    });

    it('falls back to the placeholder when the row carries no value at all for the title property', () => {
      const view = new DatabaseListView({
        readOnly: false,
        i18n,
        rows: [makeRow({ properties: {} })],
        titlePropertyId: 'title',
        schema: [TITLE_PROP],
        visiblePropertyIds: [],
      });

      const list = view.createView();
      const titleEl = list.querySelector('[data-blok-database-list-row-title]');

      // `?? ''` — a non-empty fallback would read as a real title and drop the marker.
      expect(titleEl?.outerHTML).toBe(PLACEHOLDER_TITLE_HTML);
    });

    it('renders the flat list when the group options array is empty even though getRows was supplied', () => {
      const view = new DatabaseListView({
        readOnly: false,
        i18n,
        rows: [makeRow()],
        titlePropertyId: 'title',
        schema: [TITLE_PROP],
        visiblePropertyIds: [],
        options: [],
        getRows: () => [],
      });

      const list = view.createView();

      expect(list.outerHTML).toBe(FLAT_HTML);
      expect(list.querySelectorAll('[data-blok-database-list-group]')).toHaveLength(0);
    });

    it('renders the flat list when group options exist but no getRows accessor was supplied', () => {
      const view = new DatabaseListView({
        readOnly: false,
        i18n,
        rows: [makeRow()],
        titlePropertyId: 'title',
        schema: [TITLE_PROP],
        visiblePropertyIds: [],
        options: [OPTION_A],
      });

      const list = view.createView();

      expect(list.outerHTML).toBe(FLAT_HTML);
      expect(list.querySelectorAll('[data-blok-database-list-group]')).toHaveLength(0);
    });
  });

  describe('createView — grouped branch', () => {
    it('serializes a whole group: markers on group, header, toggle, dot, title, count and rows container', () => {
      const view = new DatabaseListView({
        readOnly: false,
        i18n,
        rows: [],
        titlePropertyId: 'title',
        schema: [TITLE_PROP],
        visiblePropertyIds: [],
        options: [OPTION_A],
        getRows: () => [makeRow()],
      });

      const list = view.createView();

      expect(list.outerHTML).toBe(
        '<div data-blok-database-list="">'
        + '<div data-blok-database-list-group="" data-option-id="opt-a">'
        + '<div data-blok-database-list-group-header="">'
        + '<span data-blok-database-list-group-toggle="">▼</span>'
        + '<span data-blok-database-list-group-dot="" style="background-color: var(--blok-color-red-text);"></span>'
        + '<span data-blok-database-list-group-title="">Alpha</span>'
        + '<span data-blok-database-list-group-count="">1</span>'
        + '</div>'
        + '<div data-blok-database-list-rows="" role="list">'
        + rowHtml('row-1', 'Fix bug')
        + '</div>'
        + '<button data-blok-database-add-row="" aria-label="T(tools.database.addRow)" data-option-id="opt-a">'
        + '+ T(tools.database.newRow)'
        + '</button>'
        + '</div>'
        + '</div>'
      );
    });

    it('leaves the group dot unstyled when the option carries no color', () => {
      const view = new DatabaseListView({
        readOnly: false,
        i18n,
        rows: [],
        titlePropertyId: 'title',
        schema: [TITLE_PROP],
        visiblePropertyIds: [],
        options: [{ id: 'opt-a', label: 'Alpha', position: 'a0' }],
        getRows: () => [],
      });

      const list = view.createView();
      const dot = list.querySelector('[data-blok-database-list-group-dot]');

      expect(dot?.outerHTML).toBe('<span data-blok-database-list-group-dot=""></span>');
      expect(attrs(dot ?? document.createElement('span'))).toStrictEqual({
        'data-blok-database-list-group-dot': '',
      });
    });

    it('collapses a read-only group without touching the add-row button it never created', () => {
      const errorEvents = vi.fn((event: Event) => {
        // Cancel so jsdom does not also forward the throw to the virtual console.
        event.preventDefault();
      });

      window.addEventListener('error', errorEvents);

      try {
        const view = new DatabaseListView({
          readOnly: true,
          i18n,
          rows: [],
          titlePropertyId: 'title',
          schema: [TITLE_PROP],
          visiblePropertyIds: [],
          options: [OPTION_A],
          getRows: () => [makeRow()],
        });

        const list = view.createView();
        const group = list.querySelector('[data-blok-database-list-group]');

        expect(group?.querySelector('[data-blok-database-add-row]')).toBeNull();
        expect(Array.from(group?.children ?? []).map(child => child.getAttribute('data-blok-database-list-rows') === ''
          ? 'rows'
          : 'header')).toStrictEqual(['header', 'rows']);

        const header = group?.querySelector<HTMLElement>('[data-blok-database-list-group-header]');
        const rowsContainer = group?.querySelector<HTMLElement>('[data-blok-database-list-rows]');
        const toggle = group?.querySelector<HTMLElement>('[data-blok-database-list-group-toggle]');

        header?.click();

        expect(rowsContainer?.style.display).toBe('none');
        expect(toggle?.textContent).toBe('▶');
        // The collapse handler must skip the null add-row button; the throw it
        // would otherwise raise reaches jsdom as a window error event, not as a
        // synchronous exception out of `click()`.
        expect(errorEvents).not.toHaveBeenCalled();
      } finally {
        window.removeEventListener('error', errorEvents);
      }
    });
  });

  describe('appendRow', () => {
    it('appends to a container that has no add-row button and never calls insertBefore', () => {
      const view = new DatabaseListView({
        readOnly: false,
        i18n,
        rows: [],
        titlePropertyId: 'title',
        schema: [TITLE_PROP],
        visiblePropertyIds: [],
      });

      const container = document.createElement('div');
      // `insertBefore(node, null)` builds the same tree as `appendChild(node)`,
      // so the branch is only visible as the call that was NOT made. jsdom's
      // appendChild does not route through the instance insertBefore.
      const insertSpy = vi.spyOn(container, 'insertBefore');
      const appendSpy = vi.spyOn(container, 'appendChild');

      view.appendRow(container, makeRow({ id: 'row-9', properties: { title: 'Nine' } }));

      expect(insertSpy).not.toHaveBeenCalled();
      expect(appendSpy).toHaveBeenCalledTimes(1);
      expect(container.innerHTML).toBe(rowHtml('row-9', 'Nine'));
    });
  });

  describe('removeRow', () => {
    it('ignores a row id that is not present', () => {
      const view = new DatabaseListView({
        readOnly: false,
        i18n,
        rows: [makeRow()],
        titlePropertyId: 'title',
        schema: [TITLE_PROP],
        visiblePropertyIds: [],
      });

      const list = view.createView();

      expect(() => view.removeRow(list, 'row-missing')).not.toThrow();
      expect(list.outerHTML).toBe(FLAT_HTML);
    });
  });

  describe('updateRowTitle', () => {
    it('does nothing when the row element exists but carries no title element', () => {
      const view = new DatabaseListView({
        readOnly: false,
        i18n,
        rows: [],
        titlePropertyId: 'title',
        schema: [TITLE_PROP],
        visiblePropertyIds: [],
      });

      const wrapper = document.createElement('div');
      const orphanRow = document.createElement('div');

      orphanRow.setAttribute('data-row-id', 'row-1');
      wrapper.appendChild(orphanRow);

      // `querySelector` on a found row returns null (not undefined) when the
      // title child is missing — the null half of the guard is what saves this.
      expect(() => view.updateRowTitle(wrapper, 'row-1', 'Renamed')).not.toThrow();
      expect(wrapper.outerHTML).toBe('<div><div data-row-id="row-1"></div></div>');
    });

    it('drops the placeholder marker when a real title replaces an empty one', () => {
      const view = new DatabaseListView({
        readOnly: false,
        i18n,
        rows: [makeRow({ properties: { title: '' } })],
        titlePropertyId: 'title',
        schema: [TITLE_PROP],
        visiblePropertyIds: [],
      });

      const list = view.createView();

      view.updateRowTitle(list, 'row-1', 'Renamed');

      const titleEl = list.querySelector('[data-blok-database-list-row-title]');

      expect(titleEl?.outerHTML).toBe('<div data-blok-database-list-row-title="">Renamed</div>');
      expect(attrs(titleEl ?? document.createElement('div'))).toStrictEqual({
        'data-blok-database-list-row-title': '',
      });
    });

    it('restores the localised placeholder and an empty marker when the title is cleared', () => {
      const view = new DatabaseListView({
        readOnly: false,
        i18n,
        rows: [makeRow({ properties: { title: 'Fix bug' } })],
        titlePropertyId: 'title',
        schema: [TITLE_PROP],
        visiblePropertyIds: [],
      });

      const list = view.createView();

      view.updateRowTitle(list, 'row-1', '');

      const titleEl = list.querySelector('[data-blok-database-list-row-title]');

      expect(titleEl?.outerHTML).toBe(PLACEHOLDER_TITLE_HTML);
    });
  });

  describe('property badges', () => {
    it('skips a visible property id that the schema does not define', () => {
      const view = new DatabaseListView({
        readOnly: false,
        i18n,
        rows: [makeRow({ properties: { title: 'Fix bug',
          ghost: 'ghost value' } })],
        titlePropertyId: 'title',
        schema: [TITLE_PROP],
        visiblePropertyIds: ['ghost'],
      });

      const list = view.createView();
      const properties = list.querySelector('[data-blok-database-list-row-properties]');

      expect(properties?.outerHTML).toBe(rowPropsHtml('row-1'));
    });

    it('renders no badge for a checkbox property the row has no value for', () => {
      const view = new DatabaseListView({
        readOnly: false,
        i18n,
        rows: [makeRow({ properties: { title: 'Fix bug' } })],
        titlePropertyId: 'title',
        schema: [TITLE_PROP, { id: 'done',
          name: 'Done',
          type: 'checkbox',
          position: 'a1' }],
        visiblePropertyIds: ['done'],
      });

      const list = view.createView();
      const properties = list.querySelector('[data-blok-database-list-row-properties]');

      // Checkbox is the only branch that renders something for a falsy value,
      // so it is the only value type that makes the undefined/null guard visible.
      expect(properties?.outerHTML).toBe(rowPropsHtml('row-1'));
    });

    it('renders no badge for a checkbox property explicitly stored as null', () => {
      const view = new DatabaseListView({
        readOnly: false,
        i18n,
        rows: [makeRow({ properties: { title: 'Fix bug',
          done: null } })],
        titlePropertyId: 'title',
        schema: [TITLE_PROP, { id: 'done',
          name: 'Done',
          type: 'checkbox',
          position: 'a1' }],
        visiblePropertyIds: ['done'],
      });

      const list = view.createView();
      const properties = list.querySelector('[data-blok-database-list-row-properties]');

      expect(properties?.outerHTML).toBe(rowPropsHtml('row-1'));
    });

    it('serializes a checked checkbox badge with its glyph and its visually-hidden state text', () => {
      const view = new DatabaseListView({
        readOnly: false,
        i18n,
        rows: [makeRow({ properties: { title: 'Fix bug',
          done: true } })],
        titlePropertyId: 'title',
        schema: [TITLE_PROP, { id: 'done',
          name: 'Done',
          type: 'checkbox',
          position: 'a1' }],
        visiblePropertyIds: ['done'],
      });

      const list = view.createView();
      const badge = list.querySelector('[data-blok-database-list-row-property]');

      // Every visually-hidden declaration is asserted as READ BACK: cssstyle
      // normalises `padding: 0` to `0px` and `border: 0` to `0px`.
      expect(badge?.outerHTML).toBe(
        '<span data-blok-database-list-row-property="" data-property-id="done">'
        + '<span data-blok-database-checkbox-glyph="" aria-hidden="true" data-state="checked">✓</span>'
        + '<span style="position: absolute; width: 1px; height: 1px; padding: 0px; margin: -1px;'
        + ' overflow: hidden; clip-path: inset(50%); white-space: nowrap; border: 0px;">'
        + 'T(tools.database.checkboxChecked)'
        + '</span>'
        + '</span>'
      );
    });

    it('serializes an unchecked checkbox badge with an empty glyph and the unchecked state text', () => {
      const view = new DatabaseListView({
        readOnly: false,
        i18n,
        rows: [makeRow({ properties: { title: 'Fix bug',
          done: false } })],
        titlePropertyId: 'title',
        schema: [TITLE_PROP, { id: 'done',
          name: 'Done',
          type: 'checkbox',
          position: 'a1' }],
        visiblePropertyIds: ['done'],
      });

      const list = view.createView();
      const badge = list.querySelector('[data-blok-database-list-row-property]');

      expect(badge?.outerHTML).toBe(
        '<span data-blok-database-list-row-property="" data-property-id="done">'
        + '<span data-blok-database-checkbox-glyph="" aria-hidden="true" data-state="unchecked"></span>'
        + '<span style="position: absolute; width: 1px; height: 1px; padding: 0px; margin: -1px;'
        + ' overflow: hidden; clip-path: inset(50%); white-space: nowrap; border: 0px;">'
        + 'T(tools.database.checkboxUnchecked)'
        + '</span>'
        + '</span>'
      );
    });

    it('renders no badge for a select property whose definition carries no config', () => {
      const view = new DatabaseListView({
        readOnly: false,
        i18n,
        rows: [makeRow({ properties: { title: 'Fix bug',
          status: 'opt-a' } })],
        titlePropertyId: 'title',
        schema: [TITLE_PROP, { id: 'status',
          name: 'Status',
          type: 'select',
          position: 'a1' }],
        visiblePropertyIds: ['status'],
      });

      const list = view.createView();
      const properties = list.querySelector('[data-blok-database-list-row-properties]');

      expect(properties?.outerHTML).toBe(rowPropsHtml('row-1'));
    });

    /*
     * PROVEN EQUIVALENT — `const options = propDef.config?.options ?? []` with
     * the `[]` replaced by `["Stryker was here"]` (mutant 288:50).
     *
     * The array is read exactly once, by `options.find(o => o.id === value)`.
     * `"Stryker was here".id` is `undefined`, so the predicate reduces to
     * `undefined === value`, and a `value` of `undefined` already returned `null`
     * at the guard on line 278. `find` therefore yields `undefined` under both
     * versions, both take `if (option === undefined) return null`, and nothing
     * else reads `options`. No input can separate them.
     *
     * The fallback IS exercised by the test above: the OptionalChaining mutant on
     * the same line (`propDef.config.options`) dies there, which only happens if
     * that test reaches this expression with `config` undefined.
     */
    it('renders no badge for a select value that matches none of the configured options', () => {
      const view = new DatabaseListView({
        readOnly: false,
        i18n,
        rows: [makeRow({ properties: { title: 'Fix bug',
          status: 'opt-gone' } })],
        titlePropertyId: 'title',
        schema: [TITLE_PROP, { id: 'status',
          name: 'Status',
          type: 'select',
          position: 'a1',
          config: { options: [OPTION_A] } }],
        visiblePropertyIds: ['status'],
      });

      const list = view.createView();
      const properties = list.querySelector('[data-blok-database-list-row-properties]');

      expect(properties?.outerHTML).toBe(rowPropsHtml('row-1'));
    });

    it('matches the select option by id rather than taking the first one', () => {
      const view = new DatabaseListView({
        readOnly: false,
        i18n,
        rows: [makeRow({ properties: { title: 'Fix bug',
          status: 'opt-b' } })],
        titlePropertyId: 'title',
        schema: [TITLE_PROP, { id: 'status',
          name: 'Status',
          type: 'select',
          position: 'a1',
          config: { options: [OPTION_A, { id: 'opt-b',
            label: 'Beta',
            color: 'green',
            position: 'a1' }] } }],
        visiblePropertyIds: ['status'],
      });

      const list = view.createView();
      const badge = list.querySelector('[data-blok-database-list-row-property]');

      expect(badge?.outerHTML).toBe(
        '<span data-blok-database-list-row-property="" data-property-id="status"'
        + ' style="background-color: var(--blok-color-green-bg); color: var(--blok-color-green-text);">'
        + 'Beta'
        + '</span>'
      );
    });

    it('leaves a select badge unstyled when the matched option carries no color', () => {
      const view = new DatabaseListView({
        readOnly: false,
        i18n,
        rows: [makeRow({ properties: { title: 'Fix bug',
          status: 'opt-plain' } })],
        titlePropertyId: 'title',
        schema: [TITLE_PROP, { id: 'status',
          name: 'Status',
          type: 'select',
          position: 'a1',
          config: { options: [{ id: 'opt-plain',
            label: 'Plain',
            position: 'a0' }] } }],
        visiblePropertyIds: ['status'],
      });

      const list = view.createView();
      const badge = list.querySelector('[data-blok-database-list-row-property]');

      expect(badge?.outerHTML).toBe(
        '<span data-blok-database-list-row-property="" data-property-id="status">Plain</span>'
      );
      expect(attrs(badge ?? document.createElement('span'))).toStrictEqual({
        'data-blok-database-list-row-property': '',
        'data-property-id': 'status',
      });
    });

    it('renders no badge for a non-select, non-checkbox property holding a boolean', () => {
      const view = new DatabaseListView({
        readOnly: false,
        i18n,
        rows: [makeRow({ properties: { title: 'Fix bug',
          flag: true } })],
        titlePropertyId: 'title',
        schema: [TITLE_PROP, { id: 'flag',
          name: 'Flag',
          type: 'text',
          position: 'a1' }],
        visiblePropertyIds: ['flag'],
      });

      const list = view.createView();
      const properties = list.querySelector('[data-blok-database-list-row-properties]');

      expect(properties?.outerHTML).toBe(rowPropsHtml('row-1'));
    });
  });
});
