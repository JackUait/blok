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
  IconPlus,
} from '../../components/icons';
import { csvColumns, parseCsv, type CsvColumn, type CsvColumnTarget } from './database-csv';
import { propertyTypeMeta } from './database-property-types';
import { openMenu } from './database-table-menus';
import type { PropertyType } from './types';

export interface CsvImportDialogOptions {
  t: (key: string, vars?: Record<string, string | number>) => string;
  /** Offer Person: the host gave a people directory. */
  hasPeople: boolean;
  onImport: (file: { name: string; text: string }, targets: CsvColumnTarget[]) => void;
  onClose?: () => void;
  directionSource?: Element | null;
}

/** "Add new property" in Notion's order (research/27 §2). */
const NEW_TYPES: readonly PropertyType[] = [
  'text', 'number', 'select', 'multiSelect', 'status', 'date', 'checkbox', 'url', 'email', 'phone', 'person',
];

const counter = { next: 0 };

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, attr: string, text?: string): HTMLElementTagNameMap[K] => {
  const node = document.createElement(tag);

  node.setAttribute(attr, '');
  if (text !== undefined) node.textContent = text;

  return node;
};

const button = (testId: string, attr: string, label: string, icon?: string): HTMLButtonElement => {
  const node = el('button', attr);

  node.type = 'button';
  node.setAttribute('data-blok-testid', testId);
  if (icon !== undefined) {
    const glyph = el('span', 'data-blok-database-csv-icon');

    glyph.setAttribute('aria-hidden', 'true');
    glyph.innerHTML = icon;
    node.appendChild(glyph);
  }
  node.appendChild(el('span', 'data-blok-database-csv-label', label));

  return node;
};

/**
 * Notion's CSV import (research/26 §2, research/27 §2): a file step, then
 * "Setup CSV columns" with one type per column. One Escape closes it all.
 */
export const openCsvImportDialog = (options: CsvImportDialogOptions): { close: () => void } => {
  const { t } = options;
  const state: {
    file: { name: string; text: string } | null;
    columns: CsvColumn[];
    targets: CsvColumnTarget[];
    closed: boolean;
  } = { file: null, columns: [], targets: [], closed: false };
  const backdrop = el('div', 'data-blok-database-confirm');
  const panel = el('div', 'data-blok-database-csv-import');
  const title = el('div', 'data-blok-database-csv-title');
  const input = el('input', 'data-blok-database-csv-input');

  counter.next += 1;
  title.id = `blok-database-csv-title-${counter.next}`;
  // Mounted on body: the popover scope brings the editor font and preflight.
  backdrop.setAttribute('data-blok-popover', '');
  panel.setAttribute('data-blok-testid', 'database-csv-import-dialog');
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

  const typeLabel = (target: CsvColumnTarget): string => {
    if (target === 'skip') return t('tools.database.csvDontImport');
    if (target === 'title') return titleName();
    const type = t(propertyTypeMeta(target).labelKey);

    // A new date property shows the full date (date-format.ts defaults to 'full').
    return target === 'date' ? `${type} • ${t('tools.database.dateFormat.full')}` : type;
  };
  const typeIcon = (target: CsvColumnTarget): string => (target === 'skip' ? IconEyeClosed : propertyTypeMeta(target).icon);
  /** The title takes the name of the column that maps to it. */
  const titleName = (): string => state.columns[state.targets.indexOf('title')]?.name ?? t('tools.database.propertyTypeTitle');

  const retarget = (column: number, target: CsvColumnTarget): void => {
    const was = state.targets.indexOf('title');

    // One title: the column that had it falls back to its detected type.
    if (target === 'title' && was !== -1 && was !== column) {
      const detected = state.columns[was].detected;

      state.targets[was] = detected === 'title' ? 'text' : detected;
    }
    state.targets[column] = target;
    showSetupStep();
  };

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
          items: NEW_TYPES.filter((type) => options.hasPeople || type !== 'person').map((type) => ({
            type: PopoverItemType.Default,
            name: `database-csv-type-new-${type}`,
            title: t(propertyTypeMeta(type).labelKey),
            icon: propertyTypeMeta(type).icon,
            trailingIcon: current === type ? IconCheck : undefined,
            closeOnActivate: true,
            onActivate: () => retarget(column, type),
          })),
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

      state.columns = csvColumns(table, t('tools.database.csvUntitledColumn'));
      state.targets = state.columns.map((column) => column.detected);
      showSetupStep();
      back.focus();
    });
    panel.replaceChildren(
      close,
      title,
      el('p', 'data-blok-database-csv-text', t('tools.database.csvImportDescription')),
      el('div', 'data-blok-database-csv-caption', t('tools.database.csvUploadLabel')),
      slot,
      el('div', 'data-blok-database-csv-spacer'),
      map,
      input
    );
  }

  function showSetupStep(): void {
    const list = el('div', 'data-blok-database-csv-columns');
    const head = el('div', 'data-blok-database-csv-columns-head');
    const submit = button('database-csv-import', 'data-blok-database-csv-primary', t('tools.database.csvImport'));
    const cancel = button('database-csv-cancel', 'data-blok-database-csv-secondary', t('tools.database.layoutCancel'));
    const focused = document.activeElement;
    const focusedColumn = focused instanceof HTMLElement && panel.contains(focused) ? focused.getAttribute('data-column') : null;

    title.textContent = t('tools.database.csvSetupTitle');
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
      const pick = button('database-csv-type', 'data-blok-database-csv-type', typeLabel(target), typeIcon(target));
      const chevron = el('span', 'data-blok-database-csv-icon');

      chip.setAttribute('data-blok-testid', 'database-csv-column');
      arrow.setAttribute('aria-hidden', 'true');
      arrow.innerHTML = IconMoveRight;
      chevron.setAttribute('aria-hidden', 'true');
      chevron.innerHTML = IconChevronDown;
      pick.appendChild(chevron);
      pick.setAttribute('data-column', String(index));
      pick.setAttribute('aria-haspopup', 'menu');
      pick.setAttribute('aria-label', `${column.name}: ${typeLabel(target)}`);
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

      finish();
      options.onImport(file, targets);
    });
    cancel.addEventListener('click', () => finish());
    panel.replaceChildren(
      back,
      title,
      el('p', 'data-blok-database-csv-text', t('tools.database.csvSetupDescription')),
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
