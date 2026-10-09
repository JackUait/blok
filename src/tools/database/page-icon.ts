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
