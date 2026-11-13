import type { I18n } from '../../../types';
import { PopoverEvent } from '@/types/utils/popover/popover-event';
import { IconArrowDiagonal, IconArrowUp, IconCross, IconDatabase, IconDotsHorizontal, IconFilter, IconSearch, IconSort } from '../../components/icons';
import { PopoverDesktop } from '../../components/utils/popover';
import { PopoverItemType } from '../../components/utils/popover/components/popover-item';
import { DATABASE_HEADER_MENU_CLASS } from './database-table-menus';
import { filterChip } from './database-filter-chip';
import { sortDirectionLabelKey } from './database-filter-labels';
import { countFilterRules } from './filter-tree';
import type { DatabaseViewConfig, PropertyDefinition } from './types';
import { openModalDialog } from '../../components/utils/modal-dialog';
import type { ModalDialogHandle } from '../../components/utils/modal-dialog';

export interface PinnedGroupModalOptions {
  /** The group's pill, as the strip draws it. */
  pill: HTMLElement;
  /** The group's name, for the dialog's label. */
  label: string;
  /** The view's rules as read-only chips, from {@link pinnedGroupChips}. */
  chips: HTMLElement[];
  /** "Open <database>" in the ⋯ menu. Without it there is no ⋯: Blok has no "Save as view in…". */
  openDatabase?: { name: string; open: () => void };
  /** The group's rows as a read-only table, narrowed by `search`. */
  table: (search: string) => { root: HTMLElement; destroy: () => void };
  i18n: Pick<I18n, 't'>;
  directionSource: Element | null;
  /** Runs after the dialog is gone, whatever closed it. */
  onClose: () => void;
}

/**
 * notion-motion.md Round 25 §1 (r25-modal-inherit.raw): the view's sort chip, then one "N rules" chip. The modal adds
 * the group's own rule to the view's filters ("1 rule" with none). Round 26 §1: Tab reaches the chips, so they stay
 * buttons; the modal edits nothing, so they are aria-disabled.
 */
export const pinnedGroupChips = (view: DatabaseViewConfig, schema: PropertyDefinition[], i18n: Pick<I18n, 't'>): HTMLElement[] => {
  const chips: HTMLElement[] = [];

  if (view.sorts.length > 0) {
    const first = schema.find((p) => p.id === view.sorts[0].propertyId);
    const one = view.sorts.length === 1 && first !== undefined;
    const name = one ? first.name : i18n.t('tools.database.sortCount', { count: view.sorts.length });
    const label = one ? `${first.name}: ${i18n.t(sortDirectionLabelKey(first.type, view.sorts[0].direction))}` : name;
    const chip = filterChip('database-group-modal-sort-chip', label, { glyph: one ? IconArrowUp : IconSort, name });

    chip.setAttribute('data-direction', view.sorts[0].direction);
    chip.toggleAttribute('data-blok-database-sort-arrow', one);
    chips.push(chip);
  }
  const advanced = countFilterRules(view.filterTree) > 0 ? view.filterTree?.filterRules.length ?? 0 : 0;
  const rules = i18n.t('tools.database.filterRuleCount', { count: advanced + view.filters.length + 1 });

  chips.push(filterChip('database-group-modal-rules-chip', rules, { glyph: IconFilter, name: rules }));
  chips.forEach((chip) => {
    chip.setAttribute('data-active', '');
    chip.setAttribute('aria-disabled', 'true');
  });

  return chips;
};

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
  const state: { handle: ModalDialogHandle | null; table: { destroy: () => void } | null } = { handle: null, table: null };
  const dismiss = (): void => state.handle?.close();
  const draw = (): void => {
    const table = options.table(input.value);

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
  chipRow.append(...options.chips);
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
    // The ⋯ menu lives on body, so a press on it reads as outside. While it is open, an outside press closes only the menu.
    onDismiss: (reason) => {
      if (reason === 'outside' && more?.getAttribute('aria-expanded') === 'true') return;
      dismiss();
    },
    onClose: () => {
      state.table?.destroy();
      state.table = null;
      options.onClose();
    },
  });

  return { close: dismiss, handOff: (other) => state.handle?.handOff(other) ?? ((): void => undefined) };
};
