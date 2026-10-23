import { nanoid } from 'nanoid';
import { IconChevronDown, IconCross, IconDotsHorizontal, IconTrash } from '../../components/icons';
import { DatabasePanel, panelInput, panelRow, panelText } from './database-panel';
import type { PanelPage } from './database-panel';
import type { ViewSettingsContext } from './database-view-settings-panel';
import { ME_FILTER_VALUE, THIS_PAGE_FILTER_VALUE } from './database-query';
import { menuOperatorOf, operatorChoicesFor, operatorLabelKey, operatorNeedsValue, relativeValueLabelKey } from './database-filter-labels';
import { addFilterRule, emptyFilterTree, withEntryIds } from './filter-tree';
import { RELATIVE_DATE_UNITS, RELATIVE_DATE_VALUES, formatRelativeSpan, parseRelativeSpan, relativeWindow, toLocalDay } from './relative-dates';
import type { RelativeDateUnit, RelativeSpan } from './relative-dates';
import { optionColorOf, shownStatusOption } from './cells/option-colors';
import type { FilterConfig, PropertyDefinition, SelectOption } from './types';

type Filter = FilterConfig & { id: string };

const idList = (value: FilterConfig['value']): string[] => {
  if (Array.isArray(value)) return value.filter((id): id is string => typeof id === 'string');

  return typeof value === 'string' && value !== '' ? [value] : [];
};

const toggled = (ids: string[], id: string): string[] => (ids.includes(id) ? ids.filter((other) => other !== id) : [...ids, id]);

/** Keeps a value the new operator can still read; otherwise starts it empty. */
const valueFor = (property: PropertyDefinition, operator: string, value: FilterConfig['value']): FilterConfig['value'] => {
  if (!operatorNeedsValue(operator)) return null;
  // A single day is no range: a kept 'today' would filter while the chip read empty.
  if (operator === 'is_between') return typeof value === 'string' && /^[^/]+\/[^/]+$/.test(value) ? value : null;
  if (property.type === 'date' && parseRelativeSpan(value) !== undefined) return 'today';

  return value;
};

const DEFAULT_SPAN: RelativeSpan = { direction: 'this', count: 1, unit: 'week' };

/** A window operator as Notion's relative editor reads it: `past_month` is Past 1 month. */
const spanOf = (operator: string, value: FilterConfig['value']): RelativeSpan | undefined => {
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

  constructor(ctx: ViewSettingsContext, filterId: string) {
    this.ctx = ctx;
    this.filterId = filterId;
  }

  root(): PanelPage {
    return {
      build: (panel) => {
        const filter = this.current();
        const property = this.ctx.schema().find((p) => p.id === filter?.propertyId);

        if (filter === undefined || property === undefined) return [panelText(this.t('filterGone'))];

        return [this.header(panel, filter, property), ...this.valueControls(filter, property)];
      },
    };
  }

  private t(key: string, vars?: Record<string, string | number>): string {
    return this.ctx.i18n.t(`tools.database.${key}`, vars);
  }

  private current(): Filter | undefined {
    return withEntryIds(this.ctx.view().filters).find((f) => f.id === this.filterId);
  }

  private write(next: (filters: Filter[]) => FilterConfig[]): void {
    this.ctx.updatePersonal({ filters: next(withEntryIds(this.ctx.view().filters)) });
  }

  private update(patch: Partial<Pick<FilterConfig, 'operator' | 'value'>>): void {
    this.write((filters) => filters.map((f) => (f.id === this.filterId ? { ...f, ...patch } : f)));
  }

  private header(panel: DatabasePanel, filter: Filter, property: PropertyDefinition): HTMLElement {
    const header = document.createElement('div');
    const operator = document.createElement('button');
    const name = document.createElement('span');
    const opText = document.createElement('span');
    const chevron = document.createElement('span');
    const more = document.createElement('button');
    const opKey = operatorLabelKey(property.type, filter.operator);

    header.setAttribute('data-blok-database-chip-header', '');
    operator.type = 'button';
    operator.setAttribute('data-blok-database-chip-operator', '');
    operator.setAttribute('data-blok-testid', 'database-filter-operator');
    name.textContent = property.name;
    opText.setAttribute('data-blok-database-chip-operator-label', '');
    opText.textContent = (opKey === undefined ? filter.operator : this.ctx.i18n.t(opKey)).toLocaleLowerCase();
    chevron.setAttribute('aria-hidden', 'true');
    chevron.innerHTML = IconChevronDown;
    operator.append(name, ' ', opText, chevron);
    operator.addEventListener('click', () => panel.push(this.operators(property)));

    more.type = 'button';
    more.setAttribute('data-blok-database-chip-more', '');
    more.setAttribute('data-blok-testid', 'database-filter-more');
    more.setAttribute('aria-label', this.t('tableMoreActions'));
    more.innerHTML = IconDotsHorizontal;
    more.addEventListener('click', () => panel.push(this.moreMenu()));
    header.append(operator, more);

    return header;
  }

  private operators(property: PropertyDefinition): PanelPage {
    return {
      title: property.name,
      build: (panel) => {
        const current = this.current()?.operator ?? '';

        return operatorChoicesFor(property).map((choice) => panelRow({
          label: this.ctx.i18n.t(choice.labelKey),
          testId: `database-filter-op-${choice.operator}`,
          checked: menuOperatorOf(current) === choice.operator,
          onClick: () => {
            const value = this.current()?.value ?? null;

            const span = choice.operator === 'relative_to_today' ? spanOf(this.current()?.operator ?? '', value) : undefined;

            this.update(choice.operator === 'relative_to_today' ? spanFilter(span ?? DEFAULT_SPAN) : { operator: choice.operator, value: valueFor(property, choice.operator, value) });
            panel.back();
          },
        }));
      },
    };
  }

  private moreMenu(): PanelPage {
    return {
      build: (panel) => [
        panelRow({
          label: this.t('filterDelete'),
          testId: 'database-filter-delete',
          icon: IconTrash,
          onClick: () => {
            this.write((filters) => filters.filter((f) => f.id !== this.filterId));
            panel.close();
          },
        }),
        panelRow({
          label: this.t('filterAddToAdvanced'),
          testId: 'database-filter-to-advanced',
          onClick: () => {
            const filter = this.current();

            if (filter === undefined) return;
            const tree = this.ctx.view().filterTree ?? emptyFilterTree();

            this.ctx.updatePersonal({
              filters: withEntryIds(this.ctx.view().filters).filter((f) => f.id !== this.filterId),
              filterTree: addFilterRule(tree, tree.id, { id: nanoid(), propertyId: filter.propertyId, operator: filter.operator, value: filter.value }),
            });
            panel.close();
          },
        }),
      ],
    };
  }

  private valueControls(filter: Filter, property: PropertyDefinition): HTMLElement[] {
    const { operator, value } = filter;

    const isDate = property.type === 'date' || property.type === 'createdTime' || property.type === 'lastEditedTime';

    if (isDate && spanOf(operator, value) !== undefined) return this.relativeEditor(spanOf(operator, value) ?? DEFAULT_SPAN);
    if (!operatorNeedsValue(operator)) return [];

    switch (property.type) {
      case 'select':
      case 'multiSelect':
      case 'status':
        return this.optionControls(property, idList(value));
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

    return [
      ...RELATIVE_DATE_VALUES.map((relative) => panelRow({
        label: this.ctx.i18n.t(relativeValueLabelKey(relative)),
        testId: `database-filter-date-${relative}`,
        checked: value === relative,
        onClick: () => this.update({ value: relative }),
      })),
      panelInput({
        value: typeof value === 'string' && DAY.test(value) ? value : '',
        placeholder: 'YYYY-MM-DD',
        label: this.t('filterExactDate'),
        testId: 'database-filter-value',
        onInput: (text) => {
          if (DAY.test(text)) this.update({ value: text });
        },
      }),
    ];
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
      (['this', 'past', 'next'] as const).map((direction) => [direction, this.t(`filterDirection${capital(direction)}`)]),
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

    const note = panelText(this.t('filterUpdatesWithDate'));

    note.setAttribute('data-blok-database-chip-note', '');

    return [row, this.windowCalendar(span), note];
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

/** Opens a filter chip's popover under the chip: 260 wide (findings V17). */
export const openFilterChip = (anchor: HTMLElement, ctx: ViewSettingsContext, filterId: string, onClose?: () => void): DatabasePanel => {
  const panel = new DatabasePanel({
    anchor,
    root: new FilterChipPages(ctx, filterId).root(),
    testId: 'database-filter-popover',
    width: 260,
    backLabel: ctx.i18n.t('tools.database.settingsBack'),
    ...(onClose !== undefined ? { onClose } : {}),
  });

  panel.open();
  // Notion opens on the value: the token field or the value input, not the header.
  panel.root.querySelector<HTMLElement>('[data-blok-database-select-search], [data-blok-database-panel-input], [data-blok-database-chip-select]')?.focus();

  return panel;
};
