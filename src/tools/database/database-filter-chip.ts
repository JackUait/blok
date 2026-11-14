import { nanoid } from 'nanoid';
import { IconChevronDown, IconCross, IconDotsHorizontal, IconTrash } from '../../components/icons';
import { DatabasePanel, panelInput, panelRow, panelSeparator, panelText } from './database-panel';
import type { PanelPage } from './database-panel';
import type { ViewSettingsContext } from './database-view-settings-panel';
import { ME_FILTER_VALUE, THIS_PAGE_FILTER_VALUE } from './database-query';
import {
  isQuantifiedText,
  joinOperator,
  keepLead,
  menuOperatorOf,
  operatorChoicesFor,
  operatorLabelKey,
  operatorNeedsValue,
  quantifierChoices,
  relativeValueLabelKey,
  splitOperator,
} from './database-filter-labels';
import { openFlyout } from './database-sort-flyouts';
import { promoteToTopLayer, removeFromTopLayer } from '../../components/utils/top-layer';
import { editorLocale, formatDatePart, parseFilterDay, resolveWeekStart } from './cells/date-format';
import { MonthCalendar } from './cells/month-calendar';
import { addFilterRule, emptyFilterTree, withEntryIds } from './filter-tree';
import { RELATIVE_DATE_UNITS, RELATIVE_DATE_VALUES, formatRelativeSpan, parseRelativeSpan, relativeWindow, resolveDay, toLocalDay } from './relative-dates';
import type { RelativeDateUnit, RelativeSpan } from './relative-dates';
import { optionColorOf, shownStatusOption } from './cells/option-colors';
import { orderedStatusOptions, statusGroupOf, statusGroupsOf } from './property-values';
import type { FilterConfig, PropertyDefinition, PropertyType, SelectOption } from './types';

type Filter = FilterConfig & { id: string };

/** notion-motion.md Round 18 §2 (r18-filter-op-open.raw): rows 182x28 in a 190-wide list. */
export const OPERATOR_FLYOUT_WIDTH = 190;
/** notion-motion.md Round 18 §2 (r18-filter-more.raw): the rule ⋯ list. */
export const MORE_FLYOUT_WIDTH = 240;
export const MORE_FLYOUT_GAP = 2;
const INVALID_NOTE_MARGIN = 12;
const INVALID_NOTE_OVERLAP = 4;
/** notion-motion.md Round 20 §3 (r20-ct-rel.raw): the presets menu is 240 wide, its top the field's bottom + 6. */
const DATE_PRESET_MENU_WIDTH = 240;
const DATE_PRESET_MENU_GAP = 6;

const idList = (value: FilterConfig['value']): string[] => {
  if (Array.isArray(value)) return value.filter((id): id is string => typeof id === 'string');

  return typeof value === 'string' && value !== '' ? [value] : [];
};

const toggled = (ids: string[], id: string): string[] => (ids.includes(id) ? ids.filter((other) => other !== id) : [...ids, id]);

/**
 * Keeps a value the new operator can still read; otherwise starts it empty.
 * `emptyDay`: the toolbar chip leaves "is" without a day after a span, as Notion's
 * simple popover does (notion-motion.md Round 19 §2, r19-date-is.raw); a rule editor takes Today.
 */
const valueFor = (property: PropertyDefinition, operator: string, value: FilterConfig['value'], emptyDay: boolean): FilterConfig['value'] => {
  if (!operatorNeedsValue(operator)) return null;
  // A single day is no range: a kept 'today' would filter while the chip read empty.
  if (operator === 'is_between') return typeof value === 'string' && /^[^/]+\/[^/]+$/.test(value) ? value : null;
  if (property.type === 'date' && parseRelativeSpan(value) !== undefined) return emptyDay && operator === 'equals' ? null : 'today';

  return value;
};

const DEFAULT_SPAN: RelativeSpan = { direction: 'this', count: 1, unit: 'week' };

/** A window operator as Notion's relative editor reads it: `past_month` is Past 1 month. */
const spanOf = (saved: string, value: FilterConfig['value']): RelativeSpan | undefined => {
  const operator = splitOperator(saved).operator;

  if (operator === 'relative_to_today') return parseRelativeSpan(value) ?? DEFAULT_SPAN;
  if (operator === 'this_week') return DEFAULT_SPAN;
  const [direction, unit] = operator.split('_');

  if ((direction === 'past' || direction === 'next') && (unit === 'week' || unit === 'month' || unit === 'year')) {
    return { direction, count: 1, unit };
  }

  return undefined;
};

/** "This week" keeps its Notion API name; every other span saves as `relative_to_today`. */
const spanFilter = (span: RelativeSpan): Pick<FilterConfig, 'operator' | 'value'> =>
  span.direction === 'this' && span.unit === 'week'
    ? { operator: 'this_week', value: null }
    : { operator: 'relative_to_today', value: formatRelativeSpan(span.direction === 'this' ? { ...span, count: 1 } : span) };

const capital = (word: string): string => `${word.charAt(0).toUpperCase()}${word.slice(1)}`;

const DAY = /^\d{4}-\d{2}-\d{2}$/;

const optionPill = (option: SelectOption, type: PropertyDefinition['type']): HTMLElement => {
  const pill = document.createElement('span');

  pill.setAttribute('data-blok-database-option-pill', '');
  pill.setAttribute('data-color', optionColorOf(type === 'status' ? shownStatusOption(option) : option));
  pill.textContent = option.label;

  return pill;
};

/** One span of a chip: an aria-hidden icon, or text. */
export const chipPart = (attribute: string, content: { icon?: string; text?: string }): HTMLElement => {
  const el = document.createElement('span');

  el.setAttribute(attribute, '');
  if (content.icon !== undefined) {
    el.setAttribute('aria-hidden', 'true');
    el.innerHTML = content.icon;
  }
  if (content.text !== undefined) el.textContent = content.text;

  return el;
};

/**
 * Notion's chip: a glyph, the text, then a down chevron. The text is one span
 * (cut at 180px): the name in 500, then the colon and value in 400 (Round 19 §2).
 * The bar and the settings Filters page share it.
 */
export const filterChip = (testId: string, label: string, parts: { glyph: string; name: string; colon?: boolean; value?: string }): HTMLButtonElement => {
  const el = document.createElement('button');
  const text = chipPart('data-blok-database-chip-text', {});

  el.type = 'button';
  el.setAttribute('data-blok-testid', testId);
  el.setAttribute('aria-label', label);
  el.setAttribute('data-blok-database-filter-pill', '');
  el.append(chipPart('data-blok-database-chip-glyph', { icon: parts.glyph }));
  text.append(chipPart('data-blok-database-chip-name', { text: parts.name }));
  if (parts.value !== undefined && parts.value !== '') {
    text.append(`${parts.colon === true ? ':' : ''} `, chipPart('data-blok-database-chip-value', { text: parts.value }));
  }
  el.append(text);
  el.append(chipPart('data-blok-database-chip-chevron', { icon: IconChevronDown }));

  return el;
};

/**
 * A filter chip's popover, as Notion draws it (findings V17): a header with
 * "Name operator ▾" and a "…" menu, then the value editor. Select options sit
 * in a token field and list as coloured pills; the chosen one keeps a ✓.
 */
class FilterChipPages {
  private readonly ctx: ViewSettingsContext;
  private readonly filterId: string;
  /** The token field's search: kept across the refresh every edit causes. */
  private query = '';
  /** The panel last built, so a control can reach the redrawn page after its own edit. */
  private panel: DatabasePanel | undefined;
  /** Set when another editor (view settings) owns the rule: edits go there. */
  private readonly writer: ((patch: Partial<Pick<FilterConfig, 'operator' | 'value'>>) => void) | undefined;
  /** The "is" day calendar: its shown month, the day it last marked, and how to draw it in the latest page. */
  private calendar: MonthCalendar | undefined;
  private calendarDay: string | undefined;
  private calendarRedraw: (() => void) | undefined;
  /** The "Invalid date" message beside the day field, on the body (the popover clips its overflow). */
  private invalidNote: HTMLElement | undefined;
  /** Closes a rule editor's value flyout (`values`). */
  private closeValues: (() => void) | undefined;
  /** A pointer is down inside the panel: a field's blur commit waits for its click. */
  private pointerHeld = false;
  private trackedRoot: HTMLElement | undefined;
  /** The simple popover's day field as last drawn, with the text it was drawn with. */
  private dayField: { input: HTMLInputElement; shown: string } | undefined;

  constructor(ctx: ViewSettingsContext, filterId: string, writer?: (patch: Partial<Pick<FilterConfig, 'operator' | 'value'>>) => void) {
    this.ctx = ctx;
    this.filterId = filterId;
    this.writer = writer;
  }

  /** The relative editor or "Is between"'s range, or undefined for any other operator. */
  dateRuleControls(operator: string, value: FilterConfig['value']): HTMLElement[] | undefined {
    const span = spanOf(operator, value);

    if (span !== undefined) return this.relativeEditor(span);

    return operator === 'is_between' ? this.betweenControls(value) : undefined;
  }

  root(): PanelPage {
    return {
      build: (panel) => {
        this.panel = panel;
        this.trackPointer(panel.root);
        this.hideInvalid();
        const filter = this.current();
        const property = this.ctx.schema().find((p) => p.id === filter?.propertyId);

        if (filter === undefined || property === undefined) return [panelText(this.t('filterGone'))];

        return [this.header(panel, filter, property), ...this.valueControls(filter, property)];
      },
    };
  }

  /** The value controls alone: an advanced rule's value flyout. A Checkbox pick calls `done`, as Notion's menu closes. */
  values(done: () => void): PanelPage {
    this.closeValues = done;

    return {
      build: (panel) => {
        this.panel = panel;
        this.trackPointer(panel.root);
        this.hideInvalid();
        const filter = this.current();
        const property = this.ctx.schema().find((p) => p.id === filter?.propertyId);

        if (filter === undefined || property === undefined) return [panelText(this.t('filterGone'))];
        const rows = this.valueControls(filter, property);

        if (property.type === 'checkbox') rows.forEach((row) => row.addEventListener('click', done));

        return rows;
      },
    };
  }

  private t(key: string, vars?: Record<string, string | number>): string {
    return this.ctx.i18n.t(`tools.database.${key}`, vars);
  }

  /**
   * Removes what the pages put outside the panel. notion-motion.md Round 23 §1 (r23-o1-*-ds.raw, r23-o2-*-ds.raw):
   * a close that is not Escape writes a typed day; text that is no day is dropped and the old value stays.
   */
  dispose(escape = false): void {
    this.hideInvalid();
    const field = this.dayField;

    this.dayField = undefined;
    if (escape || field === undefined || !field.input.isConnected || this.current() === undefined) return;
    const text = field.input.value.trim();

    if (text === '' || text === field.shown.trim()) return;
    const day = parseFilterDay(text, editorLocale(this.ctx.i18n));

    if (day !== null && day !== this.current()?.value) this.update({ value: day });
  }

  /**
   * notion-motion.md Round 22 §1 (r22-d-t5-tip.raw): "Invalid date" sits left of the field box, its right edge on the
   * field's left edge. It is an error message, not a hint: it shows at once, and the popover clips its own overflow.
   */
  private showInvalid(input: HTMLInputElement, field: HTMLElement): void {
    this.hideInvalid();
    const note = document.createElement('div');
    const text = document.createElement('span');
    const box = field.getBoundingClientRect();

    note.id = `blok-database-date-error-${nanoid(6)}`;
    note.setAttribute('data-blok-interface', 'database-date-error');
    note.setAttribute('data-blok-database-chip-date-error', '');
    note.setAttribute('role', 'alert');
    // The top-layer reset zeroes the box's own padding, so the text carries it.
    text.textContent = this.t('filterInvalidDate');
    note.appendChild(text);
    document.body.appendChild(note);
    promoteToTopLayer(note);
    const size = note.getBoundingClientRect();

    // notion-motion.md Round 23 §1 (r23-tip-360.raw, r23-tip-320.raw): with no room on the left it goes under the box,
    // centred, its top 4 above the box's bottom. Notion's cut-off lies between 0 and 19.3 px of room; Blok keeps 12.
    const roomLeft = box.left - size.width >= INVALID_NOTE_MARGIN;

    note.style.left = `${roomLeft ? box.left - size.width : box.left + (box.width - size.width) / 2}px`;
    note.style.top = `${roomLeft ? box.top + (box.height - size.height) / 2 : box.bottom - INVALID_NOTE_OVERLAP}px`;
    input.setAttribute('aria-describedby', note.id);
    this.invalidNote = note;
    // It is placed once, so any scroll takes it away instead of leaving it behind.
    window.addEventListener('scroll', this.hideInvalidOnScroll, { capture: true, once: true });
  }

  private readonly hideInvalidOnScroll = (): void => {
    this.hideInvalid();
  };

  private hideInvalid(): void {
    const note = this.invalidNote;

    if (note === undefined) return;
    this.invalidNote = undefined;
    window.removeEventListener('scroll', this.hideInvalidOnScroll, { capture: true });
    document.querySelector(`[aria-describedby="${CSS.escape(note.id)}"]`)?.removeAttribute('aria-describedby');
    removeFromTopLayer(note);
    note.remove();
  }

  private trackPointer(root: HTMLElement): void {
    if (this.trackedRoot === root) return;
    this.trackedRoot = root;
    root.addEventListener('pointerdown', () => {
      this.pointerHeld = true;
      document.addEventListener('pointerup', () => {
        this.pointerHeld = false;
      }, { once: true, capture: true });
    }, true);
  }

  private current(): Filter | undefined {
    return withEntryIds(this.ctx.view().filters).find((f) => f.id === this.filterId);
  }

  private write(next: (filters: Filter[]) => FilterConfig[]): void {
    this.ctx.updatePersonal({ filters: next(withEntryIds(this.ctx.view().filters)) });
  }

  /** An operator in `patch` keeps the saved lead part (quantifier, End date) unless `lead` is false. */
  private update(patch: Partial<Pick<FilterConfig, 'operator' | 'value'>>, lead = true): void {
    if (this.writer !== undefined) {
      this.writer(patch);

      return;
    }
    this.write((filters) => filters.map((f) => {
      if (f.id !== this.filterId) return f;

      return { ...f, ...patch, ...(patch.operator !== undefined && lead ? { operator: keepLead(f.operator, patch.operator) } : {}) };
    }));
  }

  /** A header button: an optional plain lead text, a medium-weight label, a chevron. */
  private headerButton(testId: string, label: string, onClick: (button: HTMLButtonElement) => void, name?: string): HTMLButtonElement {
    const button = document.createElement('button');
    const text = document.createElement('span');
    const chevron = document.createElement('span');

    button.type = 'button';
    button.setAttribute('data-blok-database-chip-operator', '');
    button.setAttribute('data-blok-testid', testId);
    text.setAttribute('data-blok-database-chip-operator-label', '');
    text.textContent = label;
    chevron.setAttribute('aria-hidden', 'true');
    chevron.innerHTML = IconChevronDown;
    if (name !== undefined) button.append(name, ' ');
    button.append(text, chevron);
    button.addEventListener('click', () => onClick(button));

    return button;
  }

  /**
   * notion-motion.md Round 13: a Date filter heads "Start date ⌄ operator ⌄" (no name), a
   * rollup of the Name "Name any ⌄ operator ⌄" (r13-filter-date.png, r13-filter-ops-rollup.png).
   */
  private header(panel: DatabasePanel, filter: Filter, property: PropertyDefinition): HTMLElement {
    const header = document.createElement('div');
    const lead = document.createElement('span');
    const more = document.createElement('button');
    const opKey = operatorLabelKey(property.type, filter.operator);
    const { lead: part } = splitOperator(filter.operator);
    const opLabel = (opKey === undefined ? filter.operator : this.ctx.i18n.t(opKey)).toLocaleLowerCase();
    const openOperators = (button: HTMLElement): void => {
      this.operatorFlyout(button, panel, property);
    };

    header.setAttribute('data-blok-database-chip-header', '');
    if (property.type === 'date') {
      lead.append(
        this.headerButton('database-filter-side', this.t(part === 'end' ? 'dateEnd' : 'dateStart'), (button) => this.sideFlyout(button, panel)),
        this.headerButton('database-filter-operator', opLabel, openOperators)
      );
    } else if (isQuantifiedText(property, filter.operator)) {
      lead.append(
        property.name,
        ' ',
        this.headerButton('database-filter-quantifier', this.ctx.i18n.t(`tools.database.filterOperator.${part ?? 'any'}`).toLocaleLowerCase(), () => panel.push(this.quantifiers())),
        this.headerButton('database-filter-operator', opLabel, openOperators)
      );
    } else {
      lead.append(this.headerButton('database-filter-operator', opLabel, openOperators, property.name));
    }

    more.type = 'button';
    more.setAttribute('data-blok-database-chip-more', '');
    more.setAttribute('data-blok-testid', 'database-filter-more');
    more.setAttribute('aria-label', this.t('tableMoreActions'));
    more.innerHTML = IconDotsHorizontal;
    more.addEventListener('click', () => this.moreFlyout(more, panel));
    header.append(lead, more);

    return header;
  }

  /**
   * Notion's Start date / End date menu (r13-filter-ops-date.raw). Start date is the plain operator.
   * notion-motion.md Round 22 §2 (r22-sd-simple-rows.raw): a 190x65 flyout under the button. Blok keeps its ✓ on the current side.
   */
  private sideFlyout(button: HTMLElement, panel: DatabasePanel): void {
    const { lead, operator } = splitOperator(this.current()?.operator ?? '');

    openFlyout(button, panel, 'database-filter-side-picker', OPERATOR_FLYOUT_WIDTH, (pick) => (['start', 'end'] as const).map((side) => panelRow({
      label: this.t(side === 'end' ? 'dateEnd' : 'dateStart'),
      testId: `database-filter-side-${side}`,
      checked: (lead === 'end') === (side === 'end'),
      onClick: () => pick(() => {
        this.update({ operator: joinOperator(side === 'end' ? 'end' : undefined, operator) }, false);
        panel.refresh();
      }),
    })), { flip: true });
  }

  /** Notion's Any / None / Every menu (r13-filter-ops-rollup.raw). */
  private quantifiers(): PanelPage {
    return {
      build: (panel) => {
        const { lead, operator } = splitOperator(this.current()?.operator ?? '');

        return quantifierChoices().map((choice) => panelRow({
          label: this.ctx.i18n.t(choice.labelKey),
          testId: `database-filter-quantifier-${choice.operator}`,
          checked: (lead ?? 'any') === choice.operator,
          onClick: () => {
            this.update({ operator: joinOperator(choice.operator, operator) }, false);
            panel.back();
          },
        }));
      },
    };
  }

  /** notion-motion.md Round 18 §2: a 190-wide list under the button. Blok keeps its checkmark on the current one. */
  private operatorFlyout(button: HTMLElement, panel: DatabasePanel, property: PropertyDefinition): void {
    const current = this.current()?.operator ?? '';

    openFlyout(button, panel, 'database-filter-operator-picker', OPERATOR_FLYOUT_WIDTH, (pick) => operatorChoicesFor(property, current).map((choice) => panelRow({
      label: this.ctx.i18n.t(choice.labelKey),
      testId: `database-filter-op-${choice.operator}`,
      checked: menuOperatorOf(current) === choice.operator,
      onClick: () => pick(() => {
        this.update(operatorPick(property, choice.operator, { operator: this.current()?.operator ?? '', value: this.current()?.value ?? null }, this.writer === undefined));
        panel.refresh();

        // notion-motion.md Round 20 §3: after "is on or after" the focus went to the date field (the other day operators share it).
        return panel.root.querySelector<HTMLElement>('[data-blok-database-chip-date-input]');
      }),
    // notion-motion.md Round 22 §6 (r22-flip-tf-op.raw): above the button, its bottom on the button's top, when it does not fit below.
    })), { flip: true });
  }

  /** notion-motion.md Round 18 §2 (r18-filter-more.raw): 240x65, left on the button's right + 2, top on its top. */
  private moreFlyout(button: HTMLElement, panel: DatabasePanel): void {
    openFlyout(button, panel, 'database-filter-more-menu', MORE_FLYOUT_WIDTH, (pick) => [
      panelRow({
        label: this.t('filterDelete'),
        testId: 'database-filter-delete',
        icon: IconTrash,
        onClick: () => pick(() => {
          this.write((filters) => filters.filter((f) => f.id !== this.filterId));
          panel.close();
        }),
      }),
      panelRow({
        label: this.t('filterAddToAdvanced'),
        testId: 'database-filter-to-advanced',
        onClick: () => pick(() => {
          const filter = this.current();

          if (filter === undefined) return;
          const tree = this.ctx.view().filterTree ?? emptyFilterTree();

          this.ctx.updatePersonal({
            filters: withEntryIds(this.ctx.view().filters).filter((f) => f.id !== this.filterId),
            filterTree: addFilterRule(tree, tree.id, { id: nanoid(), propertyId: filter.propertyId, operator: filter.operator, value: filter.value }),
          });
          panel.close();
        }),
      }),
    ], { beside: MORE_FLYOUT_GAP });
  }

  private valueControls(filter: Filter, property: PropertyDefinition): HTMLElement[] {
    const { value } = filter;
    const operator = splitOperator(filter.operator).operator;

    const isDate = property.type === 'date' || property.type === 'createdTime' || property.type === 'lastEditedTime';

    if (isDate && spanOf(operator, value) !== undefined) return this.relativeEditor(spanOf(operator, value) ?? DEFAULT_SPAN);
    if (!operatorNeedsValue(operator)) return [];
    if (isQuantifiedText(property, filter.operator)) return [this.valueInput(typeof value === 'string' ? value : '', (text) => this.update({ value: text }))];

    switch (property.type) {
      case 'select':
      case 'multiSelect':
        return this.optionControls(property, idList(value));
      case 'status':
        return this.statusControls(property, idList(value));
      case 'checkbox':
        return [true, false].map((checked) => panelRow({
          label: this.t(checked ? 'filterChecked' : 'filterUnchecked'),
          testId: `database-filter-checkbox-${String(checked)}`,
          checked: value === checked,
          onClick: () => this.update({ value: checked }),
        }));
      case 'person':
      case 'createdBy':
      case 'lastEditedBy':
        return this.idRows(value, [
          { id: ME_FILTER_VALUE, label: this.t('filterMe'), testId: 'database-filter-person-me' },
          ...(this.ctx.people?.() ?? []).map((person) => ({ id: person.id, label: person.name, testId: `database-filter-person-${person.id}` })),
        ]);
      case 'relation':
        return this.relationRows(property, value);
      case 'date':
      case 'createdTime':
      case 'lastEditedTime':
        return this.dateControls(operator, value);
      case 'number':
      case 'uniqueId':
        return [this.valueInput(typeof value === 'number' ? String(value) : '', (text) => {
          const n = Number(text);

          this.update({ value: text.trim() === '' || !Number.isFinite(n) ? null : n });
        })];
      case 'files':
      case 'formula':
      case 'rollup':
      case 'button':
      case 'verification':
        return [];
      case 'title':
      case 'text':
      case 'url':
      case 'richText':
      case 'email':
      case 'phone':
      case 'place':
        return [this.valueInput(typeof value === 'string' ? value : '', (text) => this.update({ value: text }))];
    }
  }

  private valueInput(value: string, onInput: (text: string) => void): HTMLInputElement {
    return panelInput({
      value,
      placeholder: this.t('filterValuePlaceholder'),
      label: this.t('filterValue'),
      testId: 'database-filter-value',
      onInput,
    });
  }

  /** The token field (chosen options, a search) above the options as coloured pills. */
  private optionControls(property: PropertyDefinition, ids: string[]): HTMLElement[] {
    const options = property.config?.options ?? [];
    const field = document.createElement('div');
    const search = document.createElement('input');
    const list = document.createElement('div');
    const fill = (): void => {
      const needle = this.query.trim().toLowerCase();

      list.replaceChildren(...options
        .filter((option) => needle === '' || option.label.toLowerCase().includes(needle))
        .map((option) => {
          const row = panelRow({
            label: option.label,
            testId: `database-filter-option-${option.id}`,
            checked: ids.includes(option.id),
            checkbox: true,
            onClick: () => {
              this.query = '';
              this.update({ value: toggled(ids, option.id) });
            },
          });

          row.querySelector('[data-blok-database-panel-label]')?.replaceChildren(optionPill(option, property.type));

          return row;
        }));
    };

    field.setAttribute('data-blok-database-chip-tokens', '');
    for (const id of ids) {
      const option = options.find((o) => o.id === id);

      if (option === undefined) continue;
      const token = optionPill(option, property.type);
      const remove = document.createElement('button');

      token.setAttribute('data-blok-database-select-chip', id);
      remove.type = 'button';
      remove.setAttribute('data-blok-database-select-chip-remove', '');
      remove.setAttribute('data-blok-testid', `database-filter-token-remove-${id}`);
      remove.setAttribute('aria-label', this.ctx.i18n.t('tools.database.removeOption', { option: option.label }));
      remove.innerHTML = IconCross;
      remove.addEventListener('click', () => this.update({ value: ids.filter((other) => other !== id) }));
      token.appendChild(remove);
      field.appendChild(token);
    }
    search.type = 'text';
    search.value = this.query;
    search.setAttribute('data-blok-database-select-search', '');
    search.setAttribute('data-blok-testid', 'database-filter-option-search');
    search.placeholder = this.t('filterOptionsPlaceholder');
    search.setAttribute('aria-label', this.t('filterValue'));
    search.addEventListener('input', () => {
      this.query = search.value;
      fill();
    });
    search.addEventListener('keydown', (event) => {
      if (event.key === 'Backspace' && search.value === '' && ids.length > 0) {
        event.preventDefault();
        this.update({ value: ids.slice(0, -1) });
      }
    });
    field.appendChild(search);
    list.setAttribute('data-blok-database-chip-options', '');
    fill();

    return [field, list];
  }

  /**
   * notion-motion.md Round 20 §1 (r20-st.raw, r20-st-rows.raw): each group row, then its options, then
   * "Clear selection". No search. A group row ticks or unticks all its options; the value stays option ids.
   */
  private statusControls(property: PropertyDefinition, ids: string[]): HTMLElement[] {
    const options = orderedStatusOptions(property);
    const rows = statusGroupsOf(property).flatMap((group) => {
      const members = options.filter((option) => statusGroupOf(property, option.id)?.id === group.id);
      const all = members.length > 0 && members.every((option) => ids.includes(option.id));
      const head = panelRow({
        label: group.name,
        testId: `database-filter-status-group-${group.id}`,
        checked: all,
        onClick: () => this.update({ value: all
          ? ids.filter((id) => !members.some((option) => option.id === id))
          : [...ids, ...members.map((option) => option.id).filter((id) => !ids.includes(id))] }),
      });

      head.setAttribute('data-blok-database-filter-status-group', '');
      head.setAttribute('data-color', group.color ?? 'default');

      return [head, ...members.map((option) => {
        const row = panelRow({
          label: option.label,
          testId: `database-filter-option-${option.id}`,
          checked: ids.includes(option.id),
          onClick: () => this.update({ value: toggled(ids, option.id) }),
        });

        row.setAttribute('data-blok-database-filter-status-option', '');
        row.querySelector('[data-blok-database-panel-label]')?.replaceChildren(optionPill(option, property.type));

        return row;
      })];
    });

    return [...rows, panelSeparator(), panelRow({
      label: this.ctx.i18n.t('tools.database.filterClearSelection'),
      testId: 'database-filter-clear-selection',
      onClick: () => this.update({ value: [] }),
    })];
  }

  private idRows(value: FilterConfig['value'], entries: Array<{ id: string; label: string; testId: string }>): HTMLElement[] {
    const ids = idList(value);

    return entries.map((entry) => panelRow({
      label: entry.label,
      testId: entry.testId,
      checked: ids.includes(entry.id),
      onClick: () => this.update({ value: toggled(ids, entry.id) }),
    }));
  }

  /** "This page" first on a row page of the related database, or while chosen, then the related rows. */
  private relationRows(property: PropertyDefinition, value: FilterConfig['value']): HTMLElement[] {
    const ids = idList(value);
    const pageDatabase = this.ctx.thisPageDatabase?.() ?? null;
    const page = ids.includes(THIS_PAGE_FILTER_VALUE) || (pageDatabase !== null && property.relation?.targetDatabaseId === pageDatabase)
      ? [{ id: THIS_PAGE_FILTER_VALUE, label: this.t('filterThisPage'), testId: 'database-filter-related-this-page' }]
      : [];

    return this.idRows(value, [
      ...page,
      ...(this.ctx.relatedRows?.(property) ?? []).map((row) => ({
        id: row.id,
        label: row.title === '' ? this.t('relationUntitled') : row.title,
        testId: `database-filter-related-${row.id}`,
      })),
    ]);
  }

  private dateControls(operator: string, value: FilterConfig['value']): HTMLElement[] {
    if (operator === 'is_between') return this.betweenControls(value);

    // notion-motion.md Round 22 §2: a rule editor's value flyout holds the simple popover's field and calendar.
    return this.dayControls(value, this.writer !== undefined);
  }

  /**
   * notion-motion.md Round 20 §3 (r20-ct.raw, r20-ct-rel.raw, r20-ct-wk.raw, r20-ct-2025.raw): one
   * "Select or type a date…" field with ⊗ (once there is a value) and a presets ⌄, then the month calendar.
   * A preset shows its name in the field; a day shows long ("March 5, 2025", Round 14).
   */
  /**
   * `advanced`: a rule editor's value flyout (Round 22 §2, r22-adv-seldate*.raw, r22-adv-fclick.raw). No ⌄: a pointer
   * click on the empty field opens the presets, and a preset pick closes the flyout.
   */
  private dayControls(value: FilterConfig['value'], advanced = false): HTMLElement[] {
    const locale = editorLocale(this.ctx.i18n);
    const preset = RELATIVE_DATE_VALUES.find((relative) => relative === value);
    const exact = typeof value === 'string' && DAY.test(value) ? value : undefined;
    const picked = resolveDay(value, new Date());
    const dayText = exact === undefined ? '' : formatDatePart(exact, locale);
    const shown = preset === undefined ? dayText : this.ctx.i18n.t(relativeValueLabelKey(preset));
    const field = document.createElement('div');
    const input = document.createElement('input');
    const presets = document.createElement('button');

    field.setAttribute('data-blok-database-chip-date-field', '');
    field.setAttribute('data-blok-field', 'text');
    input.type = 'text';
    input.value = shown;
    input.placeholder = this.t('filterDatePlaceholder');
    input.setAttribute('aria-label', this.t('filterExactDate'));
    input.setAttribute('data-blok-database-chip-date-input', '');
    input.setAttribute('data-blok-testid', 'database-filter-value');
    // Writes the typed text; false when it is no date. Text the field already shows (a preset's name) writes nothing.
    const commit = (text: string): boolean => {
      if (text.trim() === shown.trim() || text.trim() === '') return true;
      const day = parseFilterDay(text, locale);

      if (day === null) {
        input.setAttribute('aria-invalid', 'true');
        this.showInvalid(input, field);

        return false;
      }
      this.update({ value: day });

      return true;
    };

    input.addEventListener('input', () => {
      input.removeAttribute('aria-invalid');
      this.hideInvalid();
    });
    input.addEventListener('keydown', (event) => {
      if (event.isComposing) return;
      if (event.key !== 'Enter') return;
      event.preventDefault();
      if (input.value.trim() !== shown.trim() && commit(input.value)) this.focusDateField();
    });
    // notion-motion.md Round 22 §1: Tab and a click inside the popover commit, as Enter does. The write waits until
    // the click is done, so the redraw never takes the clicked control away; a click that wrote (a day) wins.
    input.addEventListener('blur', () => {
      const text = input.value;

      if (text.trim() === shown.trim()) return;
      const before = this.current()?.value;
      const done = (): void => {
        setTimeout(() => {
          const panel = this.panel;

          // A closed popover writes nothing: Escape closes it before the field's own keydown runs. A click outside is unmeasured.
          if (this.current()?.value !== before || panel === undefined || !panel.isOpen) return;
          const inside = panel.root.contains(document.activeElement);

          // r22-d-t1-tab-ds.raw: after Tab the focus is on the new ⊗.
          if (commit(text) && inside && !pressed) panel.root.querySelector<HTMLElement>('[data-blok-testid="database-filter-date-clear"]')?.focus();
        }, 0);
      };
      const pressed = this.pointerHeld;

      if (pressed) document.addEventListener('pointerup', done, { once: true, capture: true });
      else done();
    });
    field.appendChild(input);
    if (!advanced) this.dayField = { input, shown };
    if (value !== null && value !== undefined && value !== '') {
      const clear = document.createElement('button');

      clear.type = 'button';
      clear.setAttribute('data-blok-database-chip-date-clear', '');
      clear.setAttribute('data-blok-testid', 'database-filter-date-clear');
      clear.setAttribute('aria-label', this.ctx.i18n.t('tools.database.dateClear'));
      clear.innerHTML = IconCross;
      clear.addEventListener('click', () => {
        this.update({ value: null });
        this.focusDateField();
      });
      field.appendChild(clear);
    }
    if (advanced) {
      field.setAttribute('data-blok-database-chip-date-rule', '');
      input.addEventListener('click', (event) => {
        if (event.detail > 0 && input.value === '') this.presetMenu(field, value);
      });

      return [field, this.dayCalendar(picked, locale), ...(preset !== undefined ? [this.updatesNote()] : [])];
    }
    presets.type = 'button';
    presets.setAttribute('data-blok-database-chip-date-presets', '');
    presets.setAttribute('data-blok-testid', 'database-filter-date-presets');
    presets.setAttribute('aria-label', this.t('filterDatePresets'));
    presets.setAttribute('aria-haspopup', 'menu');
    presets.innerHTML = IconChevronDown;
    presets.addEventListener('click', () => {
      // Typed text commits first (Round 22 §1), so the menu opens on the redrawn field.
      if (input.value.trim() !== shown.trim() && input.value.trim() !== '' && commit(input.value)) {
        const redrawn = this.panel?.root.querySelector<HTMLElement>('[data-blok-database-chip-date-field]');

        if (redrawn !== null && redrawn !== undefined) this.presetMenu(redrawn, this.current()?.value ?? null);

        return;
      }
      this.presetMenu(field, value);
    });
    field.appendChild(presets);

    return [field, this.dayCalendar(picked, locale), ...(preset !== undefined ? [this.updatesNote()] : [])];
  }

  /** The calendar outlives the redraw every write causes, so a month step stays until the value changes. */
  private dayCalendar(picked: string | undefined, locale: string): HTMLElement {
    const holder = document.createElement('div');
    const draw = (): void => {
      holder.replaceChildren(calendar.header(), calendar.grid());
    };
    const calendar = this.calendar ?? new MonthCalendar({
      locale,
      weekStart: resolveWeekStart(locale),
      // The panel root outlives every redraw; the holder does not.
      directionOf: this.panel?.root ?? holder,
      t: (key) => this.ctx.i18n.t(key),
      isSelected: (iso) => iso === this.calendarDay,
      onPick: (iso) => {
        const focused = this.panel?.root.contains(document.activeElement) === true && document.activeElement?.hasAttribute('data-blok-database-date-day') === true;

        this.update({ value: iso });
        if (focused) this.calendar?.focusDay();
      },
      redraw: () => this.calendarRedraw?.(),
    }, picked ?? toLocalDay(new Date()));

    // r22-d-t1-custom-ds.raw: a cleared day turns the calendar back to this month.
    if (this.calendar !== undefined && picked !== this.calendarDay) calendar.show(picked ?? toLocalDay(new Date()));
    this.calendar = calendar;
    this.calendarDay = picked;
    this.calendarRedraw = draw;
    holder.setAttribute('data-blok-database-chip-month', '');
    draw();

    return holder;
  }

  /**
   * notion-motion.md Round 20 §3 (r20-ct-rel.raw): 240 wide under the field (Notion's left is the field's − 2, not
   * matched), rows Today … One month from now, Custom date, the current one with a ✓ and no fill.
   */
  private presetMenu(field: HTMLElement, value: FilterConfig['value']): void {
    const panel = this.panel;

    if (panel === undefined) return;
    const isPreset = (RELATIVE_DATE_VALUES as readonly unknown[]).includes(value);
    // The anchor is the field box, which takes no focus: Escape hands it to the ⌄, or the field where there is none.
    const presetsButton = (): HTMLElement | null => panel.root.querySelector<HTMLElement>('[data-blok-testid="database-filter-date-presets"]')
      ?? panel.root.querySelector<HTMLElement>('[data-blok-database-chip-date-input]');

    openFlyout(field, panel, 'database-filter-date-menu', DATE_PRESET_MENU_WIDTH, (pick) => [
      ...RELATIVE_DATE_VALUES.map((relative) => panelRow({
        label: this.ctx.i18n.t(relativeValueLabelKey(relative)),
        testId: `database-filter-date-${relative}`,
        checked: value === relative,
        onClick: () => pick(() => {
          this.update({ value: relative });
          // r22-adv-wk.raw: in a rule editor's flyout a preset closes the flyout.
          if (this.writer !== undefined) this.closeValues?.();

          return presetsButton();
        }),
      })),
      // It clears the value. Round 20 §3 (r20-ct-custom.raw): a preset hands the focus to the field.
      // Round 22 §1 (r22-d-t1-custom-ds.raw): a typed day hands it to the ⌄.
      panelRow({
        label: this.t('filterDateCustom'),
        testId: 'database-filter-date-custom',
        checked: !isPreset,
        onClick: () => pick(() => {
          const typed = !isPreset && value !== null && value !== undefined && value !== '';

          if (isPreset || typed) this.update({ value: null });

          return typed ? presetsButton() : this.panel?.root.querySelector<HTMLElement>('[data-blok-database-chip-date-input]');
        }),
      }),
    ], { gap: DATE_PRESET_MENU_GAP, escapeFocus: presetsButton });
  }

  /** "Is between": a start and an end day, saved as a date range once both are whole. */
  private betweenControls(value: FilterConfig['value']): HTMLElement[] {
    const [start = '', end = ''] = typeof value === 'string' ? value.split('/') : [];
    const range = { start, end };
    const field = (which: 'start' | 'end'): HTMLInputElement => panelInput({
      value: range[which],
      placeholder: 'YYYY-MM-DD',
      label: this.t(which === 'start' ? 'dateStart' : 'dateEnd'),
      testId: `database-filter-between-${which}`,
      onInput: (text) => {
        range[which] = text;
        if (DAY.test(range.start) && DAY.test(range.end)) this.update({ value: `${range.start}/${range.end}` });
      },
    });
    const wrap = document.createElement('div');

    wrap.setAttribute('data-blok-database-chip-between', '');
    wrap.append(field('start'), field('end'));

    return [wrap];
  }

  /**
   * Notion's "is relative to today" editor (findings V18): This / Past / Next,
   * a count for Past and Next, the unit, a calendar that marks the window, and
   * a note that the window moves with the date.
   */
  private relativeEditor(span: RelativeSpan): HTMLElement[] {
    const row = document.createElement('div');
    const select = (testId: string, label: string, choices: Array<[string, string]>, current: string, onPick: (value: string) => void): HTMLSelectElement => {
      const el = document.createElement('select');

      el.setAttribute('data-blok-database-chip-select', '');
      el.setAttribute('data-blok-testid', testId);
      el.setAttribute('aria-label', label);
      el.append(...choices.map(([value, text]) => {
        const option = document.createElement('option');

        option.value = value;
        option.textContent = text;
        option.selected = value === current;

        return option;
      }));
      el.addEventListener('change', () => onPick(el.value));

      return el;
    };
    const one = span.direction === 'this' || span.count === 1;

    row.setAttribute('data-blok-database-chip-relative', '');
    row.append(select(
      'database-filter-direction',
      this.t('filterDirection'),
      (['past', 'next', 'this'] as const).map((direction) => [direction, this.t(`filterDirection${capital(direction)}`)]),
      span.direction,
      (direction) => this.update(spanFilter({ ...span, direction: direction as RelativeSpan['direction'] }))
    ));
    if (span.direction !== 'this') {
      const count = panelInput({
        value: String(span.count),
        placeholder: '1',
        label: this.t('filterCount'),
        testId: 'database-filter-count',
        onInput: (text) => {
          const n = Number(text);

          if (Number.isInteger(n) && n >= 1) this.update(spanFilter({ ...span, count: n }));
        },
      });

      count.inputMode = 'numeric';
      row.append(count);
    }
    row.append(select(
      'database-filter-unit',
      this.t('filterUnit'),
      RELATIVE_DATE_UNITS.map((unit) => [unit, this.t(one ? `filterUnitOne${capital(unit)}` : `filterUnit${capital(unit)}`)]),
      span.unit,
      (unit) => this.update(spanFilter({ ...span, unit: unit as RelativeDateUnit }))
    ));

    return [row, this.windowCalendar(span), this.updatesNote()];
  }

  /** An edit redraws the page, so the field to focus is the new one. */
  private focusDateField(): void {
    this.panel?.root.querySelector<HTMLElement>('[data-blok-testid="database-filter-value"]')?.focus();
  }

  /** "Filter will update with the current date": under a relative window or a preset day (Round 20 §3, r20-ct-wk.raw). */
  private updatesNote(): HTMLElement {
    const note = panelText(this.t('filterUpdatesWithDate'));

    note.setAttribute('data-blok-database-chip-note', '');

    return note;
  }

  /** This month's grid with the filter's window marked. It only shows the window: the selects edit it. */
  private windowCalendar(span: RelativeSpan): HTMLElement {
    const now = new Date();
    const window = relativeWindow('relative_to_today', formatRelativeSpan(span), now);
    const grid = document.createElement('div');
    const title = document.createElement('div');
    const first = new Date(now.getFullYear(), now.getMonth(), 1);
    const start = new Date(first.getFullYear(), first.getMonth(), 1 - first.getDay());
    const today = toLocalDay(now);

    grid.setAttribute('data-blok-database-chip-calendar', '');
    grid.setAttribute('data-blok-testid', 'database-filter-calendar');
    grid.setAttribute('aria-hidden', 'true');
    title.setAttribute('data-blok-database-chip-calendar-title', '');
    title.textContent = first.toLocaleDateString(undefined, { month: 'short', year: 'numeric' });
    grid.appendChild(title);
    const dayAt = (offset: number): Date => new Date(start.getFullYear(), start.getMonth(), start.getDate() + offset);

    grid.append(...Array.from({ length: 7 }, (_, offset) => {
      const weekday = document.createElement('span');

      weekday.setAttribute('data-blok-database-chip-weekday', '');
      weekday.textContent = dayAt(offset).toLocaleDateString(undefined, { weekday: 'narrow' });

      return weekday;
    }));
    grid.append(...Array.from({ length: 42 }, (_, offset) => {
      const date = dayAt(offset);
      const iso = toLocalDay(date);
      const day = document.createElement('span');

      day.setAttribute('data-blok-database-chip-day', iso);
      day.textContent = String(date.getDate());
      day.toggleAttribute('data-outside', date.getMonth() !== first.getMonth());
      day.toggleAttribute('data-today', iso === today);
      day.toggleAttribute('data-in-window', window !== undefined && window.from <= iso && iso <= window.to);

      return day;
    }));

    return grid;
  }
}

/**
 * The operator and value an operator pick makes: a relative pick starts a span, "Is between" an empty range.
 * The saved lead part (a quantifier, End date) stays.
 */
export const operatorPick = (
  property: PropertyDefinition,
  operator: string,
  current: Pick<FilterConfig, 'operator' | 'value'>,
  emptyDay = false
): Pick<FilterConfig, 'operator' | 'value'> => {
  const picked = operator === 'relative_to_today'
    ? spanFilter(spanOf(current.operator, current.value) ?? DEFAULT_SPAN)
    : { operator, value: valueFor(property, operator, current.value, emptyDay) };

  return { ...picked, operator: keepLead(current.operator, picked.operator) };
};

/** The chip's date editors for another rule editor (view settings), which owns the writes. */
export const dateRuleControls = (
  ctx: ViewSettingsContext,
  filter: Pick<FilterConfig, 'operator' | 'value'>,
  update: (patch: Partial<Pick<FilterConfig, 'operator' | 'value'>>) => void
): HTMLElement[] | undefined => new FilterChipPages(ctx, '', (patch) => update(patch.operator === undefined
  ? patch
  : { ...patch, operator: keepLead(filter.operator, patch.operator) })).dateRuleControls(filter.operator, filter.value);

/**
 * research/08:232 and shots-08/67-filter-number.png: the popover with a value
 * field is 220 wide. notion-motion.md Round 19 §2: Select, Multi-select, Person
 * and Date are 260, Checkbox 220 (r19-cb-new.raw). Relations are unmeasured.
 */
const VALUE_FIELD_FILTER_WIDTH = 220;
const LIST_FILTER_WIDTH = 260;
const LIST_FILTER_TYPES: readonly PropertyType[] = [
  'select', 'multiSelect', 'status', 'person', 'createdBy', 'lastEditedBy', 'relation', 'date', 'createdTime', 'lastEditedTime',
];

/** notion-motion.md Round 18 §2: the rule popover's top is the chip's bottom + 4, in the bar and on the settings Filters page. */
const CHIP_POPOVER_GAP = 4;
const CHIP_POPOVER_WINDOW_MARGIN = 8;

/**
 * Opens a filter chip's popover under the chip. With `host` it is a flyout
 * over that panel, which stays open under it (the settings Filters page).
 */
export const openFilterChip = (anchor: HTMLElement, ctx: ViewSettingsContext, filterId: string, onClose?: () => void, host?: DatabasePanel): DatabasePanel => {
  const filter = withEntryIds(ctx.view().filters).find((f) => f.id === filterId);
  const property = ctx.schema().find((p) => p.id === filter?.propertyId);
  // A rollup of the Name has a text field, as Notion's 220-wide popover shows (r13-filter-ops-rollup.png).
  const listed = property !== undefined && filter !== undefined && LIST_FILTER_TYPES.includes(property.type) && !isQuantifiedText(property, filter.operator);
  const pages = new FilterChipPages(ctx, filterId);
  const panel = new DatabasePanel({
    anchor,
    root: pages.root(),
    testId: 'database-filter-popover',
    width: listed ? LIST_FILTER_WIDTH : VALUE_FIELD_FILTER_WIDTH,
    backLabel: ctx.i18n.t('tools.database.settingsBack'),
    gap: CHIP_POPOVER_GAP,
    // notion-motion.md Round 23 §1 (r23-flipH-*.raw): at most half the window tall, 8 from its top and bottom. Below the
    // chip when it fits, else above, its bottom 4 over the chip, else it slides up over the chip.
    flip: true,
    verticalMargin: CHIP_POPOVER_WINDOW_MARGIN,
    halfWindow: true,
    onClose: (escape) => {
      pages.dispose(escape);
      release?.();
      onClose?.();
    },
  });
  const release = host?.hold();

  host?.own(panel);
  panel.open();
  // Notion opens on the value: the token field or the value input, not the header. Status has neither and
  // focuses its operator (notion-motion.md Round 20 §1, r20-st.raw).
  (panel.root.querySelector<HTMLElement>('[data-blok-database-select-search], [data-blok-database-panel-input], [data-blok-database-chip-date-input], [data-blok-database-chip-select]')
    ?? (property?.type === 'status' ? panel.root.querySelector<HTMLElement>('[data-blok-testid="database-filter-operator"]') : null))?.focus();

  return panel;
};

/** notion-motion.md Round 19 §1 (r19-adv-cb*.raw): Checkbox's value menu is 220 wide; options and people 260. */
const CHECKBOX_VALUE_WIDTH = 220;

/**
 * notion-motion.md Round 19 §1 (r19-adv-sel*.raw, r19-adv-cb*.raw, r19-adv-person*.raw): an advanced rule's value
 * that is not text opens under its button (left = button left, top = button bottom); the rule list stays.
 * The rule list redraws when it closes, so the button never moves under an open flyout.
 */
export const openRuleValueFlyout = (
  anchor: HTMLElement,
  host: DatabasePanel,
  ctx: ViewSettingsContext,
  rule: () => Filter | undefined,
  update: (patch: Partial<Pick<FilterConfig, 'operator' | 'value'>>) => void,
  width?: number,
  gap = 0,
  flip = false
): DatabasePanel => {
  const scoped: ViewSettingsContext = {
    ...ctx,
    view: () => {
      const current = rule();

      return { ...ctx.view(), filters: current === undefined ? [] : [current] };
    },
  };
  const property = ctx.schema().find((p) => p.id === rule()?.propertyId);
  const release = host.hold();
  const pages = new FilterChipPages(scoped, rule()?.id ?? '', (patch) => {
    update(patch);
    flyout.refresh();
  });
  const flyout: DatabasePanel = new DatabasePanel({
    anchor,
    root: pages.values(() => flyout.close()),
    testId: 'database-filter-value-picker',
    width: width ?? (property?.type === 'checkbox' ? CHECKBOX_VALUE_WIDTH : LIST_FILTER_WIDTH),
    backLabel: ctx.i18n.t('tools.database.settingsBack'),
    gap,
    flip,
    onClose: (escape) => {
      pages.dispose();
      release();
      host.refresh();
      if (escape) host.root.querySelector<HTMLElement>(`[data-blok-testid="${CSS.escape(anchor.getAttribute('data-blok-testid') ?? '')}"]`)?.focus();
    },
  });

  host.own(flyout);
  flyout.open();
  flyout.root.querySelector<HTMLElement>('[data-blok-database-select-search], [data-blok-database-panel-input], [data-blok-database-chip-date-input]')?.focus();

  return flyout;
};
