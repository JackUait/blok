import type { I18n } from '../../../types';
import { IconPlus, IconRowGrip } from '../../components/icons';

/**
 * The + and ⋮⋮ left of a list row (research/12 §3) or a timeline panel row (notion-motion.md Round 114 §1 #7):
 * a 24 + and an 18×24 ⋮⋮ side by side. The ⋮⋮ drags the row; a click on it opens the row menu.
 * `kind` names the attributes: `data-blok-database-<kind>-gutter`, `-add` and `-handle`.
 */
export const createRowGutter = (i18n: Pick<I18n, 't'>, kind: 'list-row' | 'timeline-table-row', rowId: string): HTMLElement => {
  const gutter = document.createElement('div');
  const add = document.createElement('button');
  const handle = document.createElement('button');

  gutter.setAttribute(`data-blok-database-${kind}-gutter`, '');
  add.type = 'button';
  add.setAttribute(`data-blok-database-${kind}-add`, '');
  add.setAttribute('aria-label', i18n.t('tools.database.tableAddBelow'));
  add.tabIndex = -1;
  add.innerHTML = IconPlus;
  handle.type = 'button';
  handle.setAttribute(`data-blok-database-${kind}-handle`, '');
  handle.setAttribute('data-row-id', rowId);
  handle.setAttribute('aria-label', i18n.t('tools.database.tableDragHandle'));
  handle.tabIndex = -1;
  handle.innerHTML = IconRowGrip;
  gutter.append(add, handle);

  return gutter;
};
