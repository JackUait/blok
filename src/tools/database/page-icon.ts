import { IconPageEmpty } from '../../components/icons';

import type { DatabaseRow, DatabaseViewConfig } from './types';

/** Whether a view shows row page icons. Notion shows them unless the view turns them off. */
export const showsPageIcon = (view: Pick<DatabaseViewConfig, 'showPageIcon'> | undefined): boolean =>
  view?.showPageIcon !== false;

/** The row's page icon before its title in a view, or null when it has none. */
export const pageIconElement = (row: Pick<DatabaseRow, 'icon'>): HTMLElement | null => {
  if (row.icon === undefined || row.icon === '') {
    return null;
  }
  const icon = document.createElement('span');

  icon.setAttribute('data-blok-database-page-icon', '');
  icon.setAttribute('aria-hidden', 'true');
  icon.textContent = row.icon;

  return icon;
};

/** The page glyph a table shows before a title with no icon (Notion's pageEmpty). */
export const pagePlaceholderIcon = (): HTMLElement => {
  const icon = document.createElement('span');

  icon.setAttribute('data-blok-database-page-icon-placeholder', '');
  icon.setAttribute('aria-hidden', 'true');
  icon.innerHTML = IconPageEmpty;

  return icon;
};

/** The page glyph before a file name in a table's files cell (notion-spec-2 §18.1: pageEmpty). */
export const fileChipIcon = (): HTMLElement => {
  const icon = document.createElement('span');

  icon.setAttribute('data-blok-database-file-chip-icon', '');
  icon.setAttribute('aria-hidden', 'true');
  icon.innerHTML = IconPageEmpty;

  return icon;
};
