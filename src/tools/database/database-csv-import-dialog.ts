import type { PopoverItemParams } from '@/types/utils/popover/popover-item';
import { PopoverItemType } from '../../components/utils/popover/components/popover-item';
import { openModalDialog } from '../../components/utils/modal-dialog';
import {
  IconCheck,
  IconChevronDown,
  IconChevronLeft,
  IconCross,
  IconEyeClosed,
  IconFile,
  IconMoveRight,
  IconPage,
  IconPlus,
  IconTable,
} from '../../components/icons';
import { helpLink } from './database-help-link';
import { buildCsvImport, csvCellText, csvColumns, parseCsv, type CsvColumn, type CsvColumnTarget, type CsvImportSettings } from './database-csv';
import { propertyTypeMeta } from './database-property-types';
import { openMenu } from './database-table-menus';
import { resolveLocale } from './cells/date-format';
import { personIdsOf } from './property-values';
import type { DateFormat, PropertyDefinition, PropertyType, PropertyValue } from './types';

export interface CsvImportDialogOptions {
  t: (key: string, vars?: Record<string, string | number>) => string;
  /** Offer Person: the host gave a people directory. */
  hasPeople: boolean;
  onImport: (file: { name: string; text: string }, targets: CsvColumnTarget[], settings: CsvImportSettings) => void;
  onClose?: () => void;
  directionSource?: Element | null;
  /** "Learn about imports" under Map CSV headers (`config.helpLinks.imports`). Without it no link. */
  helpUrl?: string;
}

/** "Add new property" in Notion's order (research/27 §2). */
const NEW_TYPES: readonly PropertyType[] = [
  'text', 'number', 'select', 'multiSelect', 'status', 'date', 'checkbox', 'url', 'email', 'phone', 'person',
];

/** The formats a CSV date can be read in (research/30 §9b): no Relative. */
const CSV_DATE_FORMATS: readonly DateFormat[] = ['full', 'short', 'month_day_year', 'day_month_year', 'year_month_day'];

/** Enough rows to judge the mapping; a big file would only slow the step down. */
const PREVIEW_ROWS = 50;

const OPTION_TYPES: ReadonlySet<PropertyType> = new Set<PropertyType>(['select', 'multiSelect', 'status']);

const counter = { next: 0 };

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, attr: string, text?: string): HTMLElementTagNameMap[K] => {
  const node = document.createElement(tag);

  node.setAttribute(attr, '');
  if (text !== undefined) node.textContent = text;

  return node;
};

const icon = (svg: string): HTMLSpanElement => {
  const glyph = el('span', 'data-blok-database-csv-icon');

  glyph.setAttribute('aria-hidden', 'true');
  glyph.innerHTML = svg;

  return glyph;
};

const button = (testId: string, attr: string, label: string, glyph?: string): HTMLButtonElement => {
  const node = el('button', attr);

  node.type = 'button';
  node.setAttribute('data-blok-testid', testId);
  if (glyph !== undefined) node.appendChild(icon(glyph));
  node.appendChild(el('span', 'data-blok-database-csv-label', label));

  return node;
};

/** Notion's grey skeleton: a header bar and five row bars in three columns. */
const skeleton = (): HTMLElement => {
  const node = el('div', 'data-blok-database-csv-skeleton');

  for (const _ of [0, 1, 2, 3, 4, 5]) {
    const line = el('div', 'data-blok-database-csv-skeleton-row');

    line.append(el('span', 'data-blok-database-csv-skeleton-bar'), el('span', 'data-blok-database-csv-skeleton-bar'), el('span', 'data-blok-database-csv-skeleton-bar'));
    node.appendChild(line);
  }

  return node;
};

/** A cell as the preview draws it: option values as pills, the rest as the view's text. */
const previewCell = (property: PropertyDefinition, value: PropertyValue | undefined, locale: string): HTMLTableCellElement => {
  const cell = el('td', 'data-blok-database-csv-preview-cell');

  if (property.type === 'title') cell.appendChild(icon(IconPage));
  if (OPTION_TYPES.has(property.type)) {
    const options = property.config?.options ?? [];
    const labels = personIdsOf(value ?? null).flatMap((id) => options.filter((option) => option.id === id).map((option) => option.label));

    cell.append(...labels.map((label) => el('span', 'data-blok-database-csv-pill', label)));

    return cell;
  }
  cell.appendChild(el('span', 'data-blok-database-csv-label', csvCellText(property, value, { locale })));

  return cell;
};

/**
 * Notion's CSV import (research/26 §2, research/27 §2): a file step, then
 * "Setup CSV columns" with one type per column. One Escape closes it all.
 * The right-hand preview shows the table the import will make.
 */
export const openCsvImportDialog = (options: CsvImportDialogOptions): { close: () => void } => {
  const { t } = options;
  const state: {
    file: { name: string; text: string } | null;
    columns: CsvColumn[];
    targets: CsvColumnTarget[];
    headers: boolean;
    dateFormats: Array<DateFormat | undefined>;
    closed: boolean;
  } = { file: null, columns: [], targets: [], headers: true, dateFormats: [], closed: false };
  const backdrop = el('div', 'data-blok-database-confirm');
  const panel = el('div', 'data-blok-database-csv-import');
  const side = el('div', 'data-blok-database-csv-side');
  const preview = el('div', 'data-blok-database-csv-preview');
  const title = el('div', 'data-blok-database-csv-title');
  const input = el('input', 'data-blok-database-csv-input');

  counter.next += 1;
  title.id = `blok-database-csv-title-${counter.next}`;
  // Mounted on body: the popover scope brings the editor font and preflight.
  backdrop.setAttribute('data-blok-popover', '');
  panel.setAttribute('data-blok-testid', 'database-csv-import-dialog');
  // A picture of the result: the column list on the left carries the same facts.
  preview.setAttribute('aria-hidden', 'true');
  preview.setAttribute('data-blok-testid', 'database-csv-preview');
  panel.append(side, preview);
  input.type = 'file';
  input.accept = '.csv,.tsv,text/csv,text/tab-separated-values';
  input.hidden = true;
  input.addEventListener('change', () => {
    const file = input.files?.[0];

    input.value = '';
    if (file !== undefined) void file.text().then((text) => {
      if (state.closed) return;
      state.file = { name: file.name, text };
      showFileStep();
    });
  });

  const typeLabel = (target: CsvColumnTarget, column: number): string => {
    if (target === 'skip') return t('tools.database.csvDontImport');
    if (target === 'title') return titleName();
    const type = t(propertyTypeMeta(target).labelKey);

    if (target !== 'date') return type;

    return `${type} • ${t(`tools.database.dateFormat.${state.dateFormats[column] ?? 'full'}`)}`;
  };
  const typeIcon = (target: CsvColumnTarget): string => (target === 'skip' ? IconEyeClosed : propertyTypeMeta(target).icon);
  /** The title takes the name of the column that maps to it; without a header line it keeps its own (research/30 §9c). */
  const titleName = (): string => (state.headers ? state.columns[state.targets.indexOf('title')]?.name : undefined) ?? t('tools.database.propertyTypeTitle');
  const settings = (): CsvImportSettings => ({ headers: state.headers, dateFormats: [...state.dateFormats] });

  const retarget = (column: number, target: CsvColumnTarget, dateFormat?: DateFormat): void => {
    const was = state.targets.indexOf('title');

    // One title: the column that had it falls back to its detected type.
    if (target === 'title' && was !== -1 && was !== column) {
      const detected = state.columns[was].detected;

      state.targets[was] = detected === 'title' ? 'text' : detected;
    }
    state.targets[column] = target;
    state.dateFormats[column] = target === 'date' ? dateFormat : undefined;
    showSetupStep();
  };

  /**
   * research/30 §9b: the format says how the CSV text is read. Notion opens
   * this submenu only with ArrowRight; here a hover opens it too.
   * No row is checked, as measured.
   */
  const dateFormatItems = (column: number): PopoverItemParams[] => CSV_DATE_FORMATS.map((format) => ({
    type: PopoverItemType.Default,
    name: `database-csv-date-${format}`,
    title: t(`tools.database.dateFormat.${format}`),
    closeOnActivate: true,
    onActivate: () => retarget(column, 'date', format),
  }));

  const pickerItems = (column: number): PopoverItemParams[] => {
    const current = state.targets[column];
    const heading = el('div', 'data-blok-database-csv-menu-heading', t('tools.database.csvExistingProperty'));

    heading.setAttribute('role', 'presentation');

    return [
      { type: PopoverItemType.Html, element: heading },
      {
        type: PopoverItemType.Default,
        name: 'database-csv-type-skip',
        title: t('tools.database.csvDontImport'),
        icon: IconEyeClosed,
        trailingIcon: current === 'skip' ? IconCheck : undefined,
        closeOnActivate: true,
        onActivate: () => retarget(column, 'skip'),
      },
      {
        type: PopoverItemType.Default,
        name: 'database-csv-type-title',
        title: titleName(),
        icon: propertyTypeMeta('title').icon,
        secondaryLabel: t('tools.database.propertyTypeTitle'),
        trailingIcon: current === 'title' ? IconCheck : undefined,
        closeOnActivate: true,
        onActivate: () => retarget(column, 'title'),
      },
      { type: PopoverItemType.Separator },
      {
        type: PopoverItemType.Default,
        name: 'database-csv-type-new',
        title: t('tools.database.csvAddProperty'),
        icon: IconPlus,
        children: {
          items: NEW_TYPES.filter((type) => options.hasPeople || type !== 'person').map((type): PopoverItemParams => {
            const look = { title: t(propertyTypeMeta(type).labelKey), icon: propertyTypeMeta(type).icon, trailingIcon: current === type ? IconCheck : undefined };

            // research/30 §9b: a click or Enter picks Date with Full date; hover and ArrowRight open the formats.
            return type === 'date'
              ? {
                type: PopoverItemType.Default,
                name: 'database-csv-type-new-date',
                ...look,
                closeOnActivate: true,
                onActivate: () => retarget(column, 'date', 'full'),
                children: { items: dateFormatItems(column) },
              }
              : { type: PopoverItemType.Default, name: `database-csv-type-new-${type}`, ...look, closeOnActivate: true, onActivate: () => retarget(column, type) };
          }),
        },
      },
    ];
  };

  const close = button('database-csv-close', 'data-blok-database-csv-corner', '', IconCross);

  close.setAttribute('aria-label', t('tools.database.close'));
  close.addEventListener('click', () => finish());
  const back = button('database-csv-back', 'data-blok-database-csv-corner', '', IconChevronLeft);

  back.setAttribute('aria-label', t('tools.database.peekBack'));
  back.addEventListener('click', () => showFileStep());

  const fileTitle = (): string => (state.file === null ? t('tools.database.csvNewTable') : state.file.name.replace(/\.[^.]+$/, ''));

  /** Before the mapping, a skeleton; on it, the table the import makes from the current choices. */
  function showPreview(table: string[][] | null): void {
    const head = el('div', 'data-blok-database-csv-preview-head');

    head.append(icon(IconTable), el('span', 'data-blok-database-csv-preview-title', fileTitle()));
    preview.toggleAttribute('data-filled', table !== null);
    if (table === null) {
      preview.replaceChildren(head, skeleton());

      return;
    }
    const ids = { next: 0 };
    const made = buildCsvImport(table.slice(0, PREVIEW_ROWS + 1), {
      newId: () => `preview-${ids.next++}`,
      untitled: t('tools.database.csvUntitledColumn'),
      titleName: t('tools.database.propertyTypeTitle'),
      targets: state.targets,
      ...settings(),
    });
    const tab = el('span', 'data-blok-database-csv-preview-tab');
    const grid = el('table', 'data-blok-database-csv-preview-table');
    const headRow = el('tr', 'data-blok-database-csv-preview-row');
    const body = el('tbody', 'data-blok-database-csv-preview-body');
    const locale = resolveLocale(undefined);

    tab.append(icon(IconTable), el('span', 'data-blok-database-csv-label', t('tools.database.viewTypeTable')));
    headRow.append(...made.schema.map((property) => {
      const cell = el('th', 'data-blok-database-csv-preview-cell');

      cell.append(icon(propertyTypeMeta(property.type).icon), el('span', 'data-blok-database-csv-label', property.name));

      return cell;
    }));
    body.append(...made.rows.slice(0, PREVIEW_ROWS).map((row) => {
      const line = el('tr', 'data-blok-database-csv-preview-row');

      line.append(...made.schema.map((property) => previewCell(property, row[property.id], locale)));

      return line;
    }));
    grid.append(el('thead', 'data-blok-database-csv-preview-thead'), body);
    grid.firstElementChild?.appendChild(headRow);
    preview.replaceChildren(head, tab, grid);
  }

  function showFileStep(): void {
    const chosen = state.file;
    const map = button('database-csv-map', 'data-blok-database-csv-primary', t('tools.database.csvMapHeaders'));
    const slot = chosen === null
      ? button('database-csv-choose-file', 'data-blok-database-csv-choose', t('tools.database.csvChooseFile'), IconFile)
      : el('div', 'data-blok-database-csv-file');

    title.textContent = t('tools.database.csvImport');
    if (chosen === null) {
      slot.addEventListener('click', () => input.click());
    } else {
      const clear = button('database-csv-clear-file', 'data-blok-database-csv-clear', '', IconCross);

      slot.setAttribute('data-blok-testid', 'database-csv-file');
      clear.setAttribute('aria-label', t('tools.database.csvClearFile'));
      clear.addEventListener('click', () => {
        state.file = null;
        showFileStep();
        panel.querySelector<HTMLElement>('[data-blok-testid="database-csv-choose-file"]')?.focus();
      });
      slot.append(el('span', 'data-blok-database-csv-icon'), el('span', 'data-blok-database-csv-label', chosen.name), clear);
      slot.firstElementChild?.setAttribute('aria-hidden', 'true');
      if (slot.firstElementChild !== null) slot.firstElementChild.innerHTML = IconFile;
    }
    // aria-disabled, not disabled: the button stays focusable, as Notion's does.
    map.setAttribute('aria-disabled', String(chosen === null));
    map.addEventListener('click', () => {
      if (state.file === null) return;
      const table = parseCsv(state.file.text);

      state.columns = csvColumns(table, t('tools.database.csvUntitledColumn'), state.headers);
      state.targets = state.columns.map((column) => column.detected);
      state.dateFormats = state.columns.map(() => undefined);
      showSetupStep();
      back.focus();
    });
    showPreview(null);
    side.replaceChildren(
      close,
      title,
      el('p', 'data-blok-database-csv-text', t('tools.database.csvImportDescription')),
      el('div', 'data-blok-database-csv-caption', t('tools.database.csvUploadLabel')),
      slot,
      el('div', 'data-blok-database-csv-spacer'),
      map,
      ...[helpLink(options.helpUrl, t('tools.database.csvImportsHelp'), 'data-blok-database-csv-help')].filter((link) => link !== null),
      input
    );
  }

  function showSetupStep(): void {
    const list = el('div', 'data-blok-database-csv-columns');
    const head = el('div', 'data-blok-database-csv-columns-head');
    const submit = button('database-csv-import', 'data-blok-database-csv-primary', t('tools.database.csvImport'));
    const cancel = button('database-csv-cancel', 'data-blok-database-csv-secondary', t('tools.database.layoutCancel'));
    const headers = el('button', 'data-blok-database-csv-switch');
    const track = el('span', 'data-blok-database-switch-track');

    headers.type = 'button';
    headers.setAttribute('role', 'switch');
    headers.setAttribute('aria-checked', String(state.headers));
    headers.setAttribute('data-blok-testid', 'database-csv-headers');
    track.appendChild(document.createElement('span'));
    const focused = document.activeElement;
    const focusedColumn = focused instanceof HTMLElement && panel.contains(focused) ? focused.getAttribute('data-column') : null;

    title.textContent = t('tools.database.csvSetupTitle');
    // The track is a direct child: the shared switch CSS reads `[aria-checked="true"] > track`.
    headers.append(track, el('span', 'data-blok-database-csv-label', t('tools.database.csvFirstRowHeaders')));
    headers.addEventListener('click', () => {
      const file = state.file;

      if (file === null) return;
      // research/30 §9c: only the names and the first row change; the chosen types stay.
      state.headers = !state.headers;
      state.columns = csvColumns(parseCsv(file.text), t('tools.database.csvUntitledColumn'), state.headers);
      showSetupStep();
      panel.querySelector<HTMLElement>('[data-blok-testid="database-csv-headers"]')?.focus();
    });
    head.append(
      el('span', 'data-blok-database-csv-caption', t('tools.database.csvFileColumns')),
      el('span', 'data-blok-database-csv-caption', t('tools.database.propertyTypeHeading'))
    );
    list.setAttribute('data-blok-testid', 'database-csv-setup');
    list.append(head, ...state.columns.map((column, index) => {
      const row = el('div', 'data-blok-database-csv-row');
      const chip = el('span', 'data-blok-database-csv-column', column.name);
      const arrow = el('span', 'data-blok-database-csv-arrow');
      const target = state.targets[index];
      const pick = button('database-csv-type', 'data-blok-database-csv-type', typeLabel(target, index), typeIcon(target));
      const chevron = el('span', 'data-blok-database-csv-icon');

      chip.setAttribute('data-blok-testid', 'database-csv-column');
      arrow.setAttribute('aria-hidden', 'true');
      arrow.innerHTML = IconMoveRight;
      chevron.setAttribute('aria-hidden', 'true');
      chevron.innerHTML = IconChevronDown;
      pick.appendChild(chevron);
      pick.setAttribute('data-column', String(index));
      pick.setAttribute('aria-haspopup', 'menu');
      pick.setAttribute('aria-label', `${column.name}: ${typeLabel(target, index)}`);
      pick.addEventListener('click', () => {
        openMenu(pick, pickerItems(index), {
          searchable: true,
          searchPlaceholder: t('tools.database.csvSearchTypes'),
          onClose: () => {
            if (!panel.contains(document.activeElement)) panel.querySelector<HTMLElement>(`[data-column="${index}"]`)?.focus({ preventScroll: true });
          },
        });
      });
      row.append(chip, arrow, pick);

      return row;
    }));
    submit.addEventListener('click', () => {
      const file = state.file;

      if (file === null) return;
      const targets = [...state.targets];

      const chosen = settings();

      finish();
      options.onImport(file, targets, chosen);
    });
    cancel.addEventListener('click', () => finish());
    showPreview(state.file === null ? null : parseCsv(state.file.text));
    side.replaceChildren(
      back,
      title,
      el('p', 'data-blok-database-csv-text', t('tools.database.csvSetupDescription')),
      headers,
      list,
      submit,
      cancel,
      input
    );
    if (focusedColumn !== null) panel.querySelector<HTMLElement>(`[data-column="${focusedColumn}"]`)?.focus({ preventScroll: true });
  }

  showFileStep();
  backdrop.appendChild(panel);

  const handle = openModalDialog({
    content: backdrop,
    surface: panel,
    role: 'dialog',
    labelledBy: title.id,
    initialFocus: () => close,
    directionSource: options.directionSource ?? null,
    // The type picker is not a dismiss layer: a press on it is not "outside".
    outside: false,
    onDismiss: () => finish(),
  });

  function finish(): void {
    if (state.closed) return;
    state.closed = true;
    handle.close();
    options.onClose?.();
  }

  return { close: finish };
};
