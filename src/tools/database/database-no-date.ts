import type { I18n } from '../../../types';
import { DatabasePanel, panelInput, panelText } from './database-panel';
import { pageIconElement, pagePlaceholderIcon } from './page-icon';
import type { DatabaseRow } from './types';

/** What the database toolbar's "No date (N)" button needs from a calendar or timeline view. */
export interface NoDateControl {
  count: number;
  label: string;
  open: (anchor: HTMLElement) => void;
}

export interface NoDatePanelOptions {
  anchor: HTMLElement;
  i18n: Pick<I18n, 't'>;
  rows: DatabaseRow[];
  titlePropertyId: string;
  hint: string;
  /** A row was clicked: give it a date. */
  pick: (rowId: string) => void;
  open: (rowId: string) => void;
  /** A press on a row that may become a drag onto the view. */
  press?: (rowId: string, event: PointerEvent) => void;
}

/** Notion's "No date" popover (findings C03/C04): 320 wide, a search, a hint, then each undated page with "Open". */
export const openNoDatePanel = (options: NoDatePanelOptions): DatabasePanel => {
  const t = (key: string): string => options.i18n.t(key);
  const state = { query: '' };
  const list = document.createElement('div');
  const titleOf = (row: DatabaseRow): string => {
    const title = row.properties[options.titlePropertyId];

    return typeof title === 'string' ? title : '';
  };
  const fill = (panel: DatabasePanel): void => {
    const query = state.query.trim().toLowerCase();

    list.replaceChildren(...options.rows.filter((row) => titleOf(row).toLowerCase().includes(query)).map((row) => {
      const item = document.createElement('div');
      const title = document.createElement('span');
      const open = document.createElement('button');

      item.setAttribute('data-blok-database-no-date-row', '');
      item.setAttribute('data-row-id', row.id);
      item.setAttribute('role', 'button');
      item.tabIndex = 0;
      title.setAttribute('data-blok-database-no-date-title', '');
      title.textContent = titleOf(row);
      if (title.textContent === '') {
        title.setAttribute('data-placeholder', t('tools.database.cardTitlePlaceholder'));
      }
      open.type = 'button';
      open.setAttribute('data-blok-database-no-date-open', '');
      open.textContent = t('tools.database.tableOpen');
      open.addEventListener('click', (event) => {
        event.stopPropagation();
        panel.close();
        options.open(row.id);
      });
      item.append(pageIconElement(row) ?? pagePlaceholderIcon(), title, open);
      item.addEventListener('click', () => {
        panel.close();
        options.pick(row.id);
      });
      item.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' && event.target === item) {
          event.preventDefault();
          item.click();
        }
      });
      item.addEventListener('pointerdown', (event) => {
        if (event.button === 0 && !(event.target instanceof Element && event.target.closest('[data-blok-database-no-date-open]') !== null)) {
          options.press?.(row.id, event);
        }
      });

      return item;
    }));
  };

  list.setAttribute('data-blok-database-no-date-list', '');
  const panel = new DatabasePanel({
    anchor: options.anchor,
    testId: 'database-no-date',
    width: 320,
    backLabel: t('tools.database.peekBack'),
    root: {
      build: (current) => {
        const search = panelInput({
          value: state.query,
          placeholder: t('tools.database.noDateSearch'),
          label: t('tools.database.noDateSearch'),
          testId: 'database-no-date-search',
          onInput: (value) => {
            state.query = value;
            fill(current);
          },
        });

        fill(current);

        return [search, panelText(options.hint), list];
      },
    },
  });

  panel.open();

  return panel;
};
