import type { I18n } from '../../../types';
import { IconCross, IconSearch } from '../../components/icons';
import { openModalDialog } from '../../components/utils/modal-dialog';
import type { ModalDialogHandle } from '../../components/utils/modal-dialog';

export interface PinnedGroupModalOptions {
  /** The group's pill, as the strip draws it. */
  pill: HTMLElement;
  /** The group's name, for the dialog's label. */
  label: string;
  /** The group's rows as a read-only table, narrowed by `search`. */
  table: (search: string) => HTMLElement;
  i18n: Pick<I18n, 't'>;
  directionSource: Element | null;
  /** Runs after the dialog is gone, whatever closed it. */
  onClose: () => void;
}

/**
 * notion-motion.md Round 25 §1 (r25-pinmodal.raw): a pinned group's rows in an 800×496 dialog. The header holds the
 * group pill, Search and a round Dismiss. Every close is instant (motion-r25-pinmodal-esc.json, -outside, -x).
 */
export const openPinnedGroupModal = (options: PinnedGroupModalOptions): { close: () => void } => {
  const { i18n } = options;
  const backdrop = document.createElement('div');
  const panel = document.createElement('div');
  const header = document.createElement('div');
  const title = document.createElement('span');
  const search = document.createElement('button');
  const input = document.createElement('input');
  const close = document.createElement('button');
  const body = document.createElement('div');
  const state: { handle: ModalDialogHandle | null } = { handle: null };
  const dismiss = (): void => state.handle?.close();

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
  close.type = 'button';
  close.setAttribute('data-blok-database-group-modal-close', '');
  close.setAttribute('aria-label', i18n.t('tools.database.close'));
  close.innerHTML = IconCross;
  body.setAttribute('data-blok-database-group-modal-body', '');
  body.append(options.table(''));

  search.addEventListener('click', () => {
    input.hidden = false;
    input.focus();
  });
  input.addEventListener('input', () => body.replaceChildren(options.table(input.value)));
  close.addEventListener('click', dismiss);
  // r25-modal-celledit.raw: the table is view-only, so a cell click does nothing; only OPEN acts.
  body.addEventListener('click', (event) => {
    if (event.target instanceof Element && event.target.closest('[data-blok-database-table-open]') === null) event.stopPropagation();
  }, true);

  header.append(title, search, input, close);
  panel.append(header, body);
  backdrop.appendChild(panel);
  state.handle = openModalDialog({
    content: backdrop,
    surface: panel,
    role: 'dialog',
    label: options.label,
    directionSource: options.directionSource,
    onDismiss: dismiss,
    onClose: options.onClose,
  });

  return { close: dismiss };
};
