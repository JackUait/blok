import type { I18n } from '../../../types';
import { PopoverEvent } from '@/types/utils/popover/popover-event';
import { IconArrowDiagonal, IconArrowUp, IconCross, IconDatabase, IconDotsHorizontal, IconFilter, IconSearch, IconSort } from '../../components/icons';
import { PopoverDesktop } from '../../components/utils/popover';
import { PopoverItemType } from '../../components/utils/popover/components/popover-item';
import { DATABASE_HEADER_MENU_CLASS } from './database-table-menus';
import { chipPart, filterChip, openFilterChip } from './database-filter-chip';
import type { DatabasePanel } from './database-panel';
import { sortEditor } from './database-sort-panel';
import type { ViewSettingsContext } from './database-view-settings-panel';
import { filterPillLabel, filterPillParts, sortDirectionLabelKey } from './database-filter-labels';
import { propertyTypeMeta } from './database-property-types';
import { countFilterRules, withEntryIds } from './filter-tree';
import type { DatabaseViewConfig, PersonalViewPatch, PropertyDefinition } from './types';
import { openModalDialog } from '../../components/utils/modal-dialog';
import type { ModalDialogHandle } from '../../components/utils/modal-dialog';

export interface PinnedGroupModalOptions {
  /** The group's pill, as the strip draws it. */
  pill: HTMLElement;
  /** The group's name, for the dialog's label. */
  label: string;
  /** The view as the board shows it. The modal edits its own copy and never writes it back. */
  view: DatabaseViewConfig;
  /** Localized schema. */
  schema: PropertyDefinition[];
  /** Names for the filter chips and their editors. */
  names?: PinnedGroupChipNames;
  /** People and related rows the filter editors list. */
  people?: () => Array<{ id: string; name: string }>;
  relatedRows?: (property: PropertyDefinition) => Array<{ id: string; title: string }>;
  thisPageDatabase?: () => string | null;
  /** "Open <database>" in the ⋯ menu. Without it there is no ⋯: Blok has no "Save as view in…". */
  openDatabase?: { name: string; open: () => void };
  /** The group's rows as a read-only table, narrowed by `search` and queried with the modal's copy of the view. */
  table: (search: string, view: DatabaseViewConfig) => { root: HTMLElement; destroy: () => void };
  i18n: Pick<I18n, 't'> & Partial<Pick<I18n, 'getLocale'>>;
  directionSource: Element | null;
  /** Runs after the dialog is gone, whatever closed it. */
  onClose: () => void;
}

/** What a simple filter chip needs to name a person, a related row and a date, as the toolbar's chip does. */
export interface PinnedGroupChipNames {
  personName?: (id: string) => string | undefined;
  rowTitle?: (property: PropertyDefinition, id: string) => string | undefined;
  locale?: string;
}

/**
 * notion-motion.md Round 25 §1 (r25-modal-inherit.raw): the view's sort chip, then one "N rules" chip. The modal adds
 * the group's own rule to the view's advanced rules ("1 rule" with none). Round 27 §2 (r27-pm-filtered.raw): a simple
 * filter keeps its own chip after the count, and a divider parts the sort chip from the filter chips (r27-pm-open.png).
 * Round 26 §1: Tab reaches the chips. Round 38 §1: the sort and filter chips open their editors; the "N rules" chip
 * holds the group's own rule, which the modal does not edit, so it is aria-disabled.
 */
export const pinnedGroupChips = (
  view: DatabaseViewConfig,
  schema: PropertyDefinition[],
  i18n: Pick<I18n, 't'>,
  names: PinnedGroupChipNames = {}
): HTMLElement[] => {
  const chips: HTMLElement[] = [];

  if (view.sorts.length > 0) {
    const first = schema.find((p) => p.id === view.sorts[0].propertyId);
    const one = view.sorts.length === 1 && first !== undefined;
    const name = one ? first.name : i18n.t('tools.database.sortCount', { count: view.sorts.length });
    const label = one ? `${first.name}: ${i18n.t(sortDirectionLabelKey(first.type, view.sorts[0].direction))}` : name;
    const chip = filterChip('database-group-modal-sort-chip', label, { glyph: one ? IconArrowUp : IconSort, name });

    chip.setAttribute('data-direction', view.sorts[0].direction);
    chip.toggleAttribute('data-blok-database-sort-arrow', one);
    chip.setAttribute('data-active', '');
    chips.push(chip);
  }
  const advanced = countFilterRules(view.filterTree) > 0 ? view.filterTree?.filterRules.length ?? 0 : 0;
  const rules = i18n.t('tools.database.filterRuleCount', { count: advanced + 1 });
  const rulesChip = filterChip('database-group-modal-rules-chip', rules, { glyph: IconFilter, name: rules });

  rulesChip.setAttribute('data-active', '');
  rulesChip.setAttribute('aria-disabled', 'true');
  chips.push(rulesChip);
  const t = (key: string, vars?: Record<string, string | number>): string => i18n.t(key, vars);

  for (const filter of withEntryIds(view.filters)) {
    const property = schema.find((p) => p.id === filter.propertyId);

    if (property === undefined) continue;
    const rowTitle = (id: string): string | undefined => names.rowTitle?.(property, id);
    const label = filterPillLabel(filter, property, t, names.personName, rowTitle, names.locale);
    const parts = filterPillParts(filter, property, t, names.personName, rowTitle, names.locale);
    const chip = filterChip(`database-group-modal-filter-chip-${filter.id}`, label, { glyph: propertyTypeMeta(property.type).icon, ...parts });

    chip.setAttribute('data-filter-id', filter.id);
    chip.toggleAttribute('data-active', parts.value !== '');
    chips.push(chip);
  }
  if (view.sorts.length > 0) chips.splice(1, 0, chipPart('data-blok-database-chip-divider', {}));

  return chips;
};

/** notion-motion.md Round 38 §1 (r38-pm-chips.raw): a chip's editor opens 4 under the chip. */
const EDITOR_GAP = 4;

/** notion-motion.md Round 26 §1 (r26-pm-more-menu.raw): the ⋯ menu is 201.1 wide, centred under its button, top on its bottom. */
const MORE_MENU_WIDTH = 201.1;

const openMoreMenu = (anchor: HTMLElement, i18n: Pick<I18n, 't'>, target: { name: string; open: () => void }): void => {
  const at = anchor.getBoundingClientRect();
  const left = at.left + at.width / 2 - MORE_MENU_WIDTH / 2;
  // "Open", the database icon, then its name (r26-pm-more-menu.raw).
  const title = document.createElement('span');
  const icon = document.createElement('span');

  title.setAttribute('data-blok-database-group-modal-open-title', '');
  icon.setAttribute('aria-hidden', 'true');
  icon.innerHTML = IconDatabase;
  title.append(i18n.t('tools.database.tableOpen'), icon, target.name);
  const menu = new PopoverDesktop({
    // The column menu's rows: 28 tall, the 20px icon at +8, the text at +36 (Notion's, r26-pm-more-menu.raw).
    class: `${DATABASE_HEADER_MENU_CLASS} blok-database-column-menu`,
    animateClose: true,
    trigger: anchor,
    width: 'auto',
    // The container adds 4px of padding on each side.
    minWidth: `${MORE_MENU_WIDTH - 8}px`,
    offset: 0,
    autoFocusFirstItem: false,
    position: new DOMRect(left, at.top, MORE_MENU_WIDTH, at.height),
    positionContext: anchor,
    items: [{
      type: PopoverItemType.Default,
      name: 'group-modal-open-database',
      title: i18n.t('tools.database.tableOpen'),
      titleEl: title,
      icon: IconArrowDiagonal,
      closeOnActivate: true,
      onActivate: () => target.open(),
    }],
  });

  const state = { closed: false };

  anchor.setAttribute('aria-expanded', 'true');
  // destroy() emits Closed again; the flag stops that from looping.
  menu.on(PopoverEvent.Closed, () => {
    if (state.closed) return;
    state.closed = true;
    anchor.setAttribute('aria-expanded', 'false');
    queueMicrotask(() => menu.destroy());
  });
  menu.show();
};

export interface PinnedGroupModalHandle {
  close: () => void;
  /** Hands the page to a peek opened over the modal; the returned resume gives it back (see ModalDialogHandle). */
  handOff: (other: HTMLElement) => () => void;
}

/**
 * notion-motion.md Round 25 §1 (r25-pinmodal.raw): a pinned group's rows in an 800×496 dialog. The header holds the
 * group pill, Search and a round Dismiss. Every close is instant (motion-r25-pinmodal-esc.json, -outside, -x).
 */
export const openPinnedGroupModal = (options: PinnedGroupModalOptions): PinnedGroupModalHandle => {
  const { i18n } = options;
  const backdrop = document.createElement('div');
  const panel = document.createElement('div');
  const header = document.createElement('div');
  const title = document.createElement('span');
  const search = document.createElement('button');
  const input = document.createElement('input');
  const close = document.createElement('button');
  const chipRow = document.createElement('div');
  const body = document.createElement('div');
  const state: {
    handle: ModalDialogHandle | null;
    table: { destroy: () => void } | null;
    /** Round 38 §1: the modal's own sorts and filters, dropped with it. Ids are fixed once, so chips and editors agree. */
    view: DatabaseViewConfig;
    editor: { panel: DatabasePanel; chip: string } | null;
  } = {
    handle: null,
    table: null,
    view: { ...options.view, sorts: withEntryIds(options.view.sorts), filters: withEntryIds(options.view.filters) },
    editor: null,
  };
  const dismiss = (): void => state.handle?.close();
  const chipById = (testId: string): HTMLElement | null => chipRow.querySelector<HTMLElement>(`[data-blok-testid="${CSS.escape(testId)}"]`);
  const update = (patch: PersonalViewPatch): void => {
    state.view = {
      ...state.view,
      ...patch,
      ...(patch.sorts !== undefined ? { sorts: withEntryIds(patch.sorts) } : {}),
      ...(patch.filters !== undefined ? { filters: withEntryIds(patch.filters) } : {}),
    };
    drawChips();
    draw();
    state.editor?.panel.refresh();
  };
  const editorClosed = (chip: string, escape: boolean): void => {
    if (state.editor?.chip === chip) state.editor = null;
    const current = chipById(chip);

    current?.removeAttribute('data-popover-open');
    // A write redraws the chips, so focus goes back to the chip by its test id.
    if (escape) current?.focus();
  };
  const showEditor = (chip: HTMLElement, open: (testId: string) => DatabasePanel): void => {
    const testId = chip.getAttribute('data-blok-testid') ?? '';

    state.editor?.panel.close();
    chip.setAttribute('data-popover-open', '');
    state.editor = { panel: open(testId), chip: testId };
  };
  const openSort = (chip: HTMLElement): void => showEditor(chip, (testId) => {
    const panel = sortEditor({
      anchor: chip,
      i18n,
      schema: () => options.schema,
      sorts: () => state.view.sorts,
      write: (sorts) => update({ sorts }),
      // notion-motion.md Round 38 §1 (r38-pm-chips.raw): 290×107 at the chip's left, its bottom + 4.
      gap: EDITOR_GAP,
      onClose: (escape) => editorClosed(testId, escape),
    });

    panel.open();

    return panel;
  });
  const filterContext = (): ViewSettingsContext => ({
    i18n,
    view: () => state.view,
    schema: () => options.schema,
    updatePersonal: update,
    ...(options.people === undefined ? {} : { people: options.people }),
    ...(options.relatedRows === undefined ? {} : { relatedRows: options.relatedRows }),
    ...(options.thisPageDatabase === undefined ? {} : { thisPageDatabase: options.thisPageDatabase }),
    // The filter editors read and write only the rules; nothing else here acts on the view.
    locked: () => false,
    layouts: [],
    canDeleteView: () => false,
    updateView: () => undefined,
    setLayout: () => undefined,
    setLocked: () => undefined,
    duplicateView: () => undefined,
    deleteView: () => undefined,
    copyViewLink: () => undefined,
    groups: () => [],
  });
  // Round 38 §1 (r38-pm-filter-edit.png): the Status rule editor, 260×244 at the chip's left, its bottom + 4.
  const openFilter = (chip: HTMLElement, filterId: string): void => showEditor(chip, (testId) =>
    openFilterChip(chip, filterContext(), filterId, (escape) => editorClosed(testId, escape)));
  const drawChips = (): void => {
    const chips = pinnedGroupChips(state.view, options.schema, i18n, options.names);

    for (const chip of chips) {
      const filterId = chip.getAttribute('data-filter-id');
      const testId = chip.getAttribute('data-blok-testid');

      if (testId !== null && testId === state.editor?.chip) chip.setAttribute('data-popover-open', '');
      if (testId === 'database-group-modal-sort-chip') chip.addEventListener('click', () => openSort(chip));
      if (filterId !== null) chip.addEventListener('click', () => openFilter(chip, filterId));
    }
    chipRow.replaceChildren(...chips);
  };
  const draw = (): void => {
    const table = options.table(input.value, state.view);

    state.table?.destroy();
    state.table = table;
    // Its Edit filters / Clear search need the view's write handlers, which this view-only table has not.
    table.root.querySelector('[data-blok-database-table-empty]')?.remove();
    // Round 26 §1 (r26-pm-key-*.raw): no cell takes focus, so a click leaves no ring, arrows move nothing and Tab skips the table.
    // Again after the grid's own first paint, which it queues as a microtask once the table is in the page.
    const unfocusable = (): void => table.root.querySelectorAll('[role="grid"], [role="gridcell"], [role="columnheader"]')
      .forEach((el) => el.removeAttribute('tabindex'));

    unfocusable();
    queueMicrotask(unfocusable);
    body.replaceChildren(table.root);
  };

  // data-blok-popover gives the body-mounted dialog the database tokens and theme.
  backdrop.setAttribute('data-blok-popover', '');
  backdrop.setAttribute('data-blok-database-group-modal', '');
  // Without it the editor's keydown takes Tab (block indent), and focus never leaves Search.
  backdrop.setAttribute('data-blok-keyboard-owner', '');
  panel.setAttribute('data-blok-database-group-modal-panel', '');
  header.setAttribute('data-blok-database-group-modal-header', '');
  title.setAttribute('data-blok-database-group-modal-title', '');
  title.append(options.pill);
  search.type = 'button';
  search.setAttribute('data-blok-database-group-modal-search', '');
  search.setAttribute('aria-label', i18n.t('tools.database.searchLabel'));
  search.innerHTML = IconSearch;
  input.type = 'search';
  input.hidden = true;
  input.placeholder = i18n.t('tools.database.searchPlaceholder');
  input.setAttribute('aria-label', i18n.t('tools.database.searchLabel'));
  input.setAttribute('data-blok-database-group-modal-search-input', '');
  const more = options.openDatabase === undefined ? null : document.createElement('button');
  const target = options.openDatabase;

  if (more !== null && target !== undefined) {
    more.type = 'button';
    more.setAttribute('data-blok-database-group-modal-more', '');
    more.setAttribute('aria-label', i18n.t('tools.database.tableMoreActions'));
    more.setAttribute('aria-haspopup', 'menu');
    more.setAttribute('aria-expanded', 'false');
    more.innerHTML = IconDotsHorizontal;
    more.addEventListener('click', () => openMoreMenu(more, i18n, { name: target.name, open: () => {
      dismiss();
      target.open();
    } }));
  }
  close.type = 'button';
  close.setAttribute('data-blok-database-group-modal-close', '');
  close.setAttribute('aria-label', i18n.t('tools.database.close'));
  close.innerHTML = IconCross;
  chipRow.setAttribute('data-blok-database-group-modal-chips', '');
  drawChips();
  body.setAttribute('data-blok-database-group-modal-body', '');
  draw();

  search.addEventListener('click', () => {
    input.hidden = false;
    input.focus();
  });
  input.addEventListener('input', draw);
  close.addEventListener('click', dismiss);
  // r25-modal-celledit.raw: the table is view-only, so a cell click does nothing; only OPEN and Load more act.
  const acts = (target: EventTarget | null): boolean =>
    target instanceof Element && target.closest('[data-blok-database-table-open], [data-blok-database-table-load-more]') !== null;

  // The grid's own presses select a cell and give it a tabindex again, so they never reach it.
  for (const type of ['pointerdown', 'click'] as const) {
    body.addEventListener(type, (event) => {
      if (!acts(event.target)) event.stopPropagation();
    }, true);
  }
  // The table counts the extra rows in its state but redraws only through a write handler, so the modal redraws.
  body.addEventListener('click', (event) => {
    if (event.target instanceof Element && event.target.closest('[data-blok-database-table-load-more]') !== null) draw();
  });

  header.append(...[title, search, input, more, close].filter((el): el is HTMLElement => el !== null));
  panel.append(header, chipRow, body);
  backdrop.appendChild(panel);
  state.handle = openModalDialog({
    content: backdrop,
    surface: panel,
    role: 'dialog',
    label: options.label,
    directionSource: options.directionSource,
    // A chip editor's lists open from the editor, not from the dialog.
    ownsFocus: (target) => state.editor !== null && target instanceof Element && target.closest('[data-blok-database-panel]') !== null,
    // The ⋯ menu and the chip editors live on body, so a press on them reads as outside. While one is open, an outside
    // press closes only it.
    onDismiss: (reason) => {
      if (reason === 'outside' && (more?.getAttribute('aria-expanded') === 'true' || state.editor !== null)) return;
      dismiss();
    },
    onClose: () => {
      state.editor?.panel.close();
      state.editor = null;
      state.table?.destroy();
      state.table = null;
      options.onClose();
    },
  });

  return {
    close: dismiss,
    handOff: (other) => {
      const resume = state.handle?.handOff(other);

      // The rows may have changed in the peek; the table only redraws on search and Load more.
      return () => {
        if (resume === undefined || !panel.isConnected) return;
        resume();
        draw();
      };
    },
  };
};
