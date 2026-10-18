import { IconDatabase, IconDotsHorizontal, IconPlus } from '../../components/icons';
import { DatabasePanel, panelInput, panelLabel, panelRow } from './database-panel';
import type { PanelPage } from './database-panel';
import { VIEW_ICONS } from './database-tab-bar';
import type { DatabaseViewConfig } from './types';

/** A database the linked view can show. */
export interface LinkedPickerSource {
  id: string;
  title: string;
  /** The page it sits on: shown under its name. */
  parent: string;
}

export interface LinkedPickerOptions {
  anchor: HTMLElement;
  t: (key: string, vars?: Record<string, string>) => string;
  sources: () => LinkedPickerSource[];
  /** The source's views that a linked view may copy. */
  views: (sourceId: string) => DatabaseViewConfig[];
  newEmpty: (title: string) => void;
  pickSource: (id: string) => void;
  newTableView: () => void;
  copyView: (view: DatabaseViewConfig) => void;
  onClose?: () => void;
}

/** Rows before "Show more" (research 20 §2a, 41-linked-picker.png). */
const FIRST_ROWS = 3;

/**
 * "Linked view of data source" (research 20 §2a): the "New database" page
 * picks a source, then the "New view" page picks the linked view's first
 * view. No row shows a preview on hover.
 */
export const openLinkedPicker = (options: LinkedPickerOptions): DatabasePanel => {
  const { t } = options;
  const untitled = t('tools.database.relationUntitledDatabase');

  const viewPage = (source: LinkedPickerSource): PanelPage => ({
    title: t('tools.database.newView'),
    build: (panel) => [
      panelRow({
        label: t('tools.database.linkedNewTableView'),
        testId: 'database-linked-new-table-view',
        icon: IconPlus,
        onClick: () => {
          panel.close();
          options.newTableView();
        },
      }),
      panelLabel(t('tools.database.linkedViewsOn', { name: source.title === '' ? untitled : source.title })),
      ...options.views(source.id).map((view) => panelRow({
        label: view.name,
        testId: `database-linked-view-${view.id}`,
        icon: VIEW_ICONS[view.type],
        onClick: () => {
          panel.close();
          options.copyView(view);
        },
      })),
    ],
  });

  const state = { query: '', expanded: false };
  const list = document.createElement('div');

  const fillList = (panel: DatabasePanel): void => {
    const query = state.query.trim();
    const matches = options.sources().filter((source) => (source.title === '' ? untitled : source.title).toLowerCase().includes(query.toLowerCase()));
    const shown = state.expanded ? matches : matches.slice(0, FIRST_ROWS);
    const rows: HTMLElement[] = [];

    if (query === '') {
      rows.push(panelRow({ label: t('tools.database.linkedNewEmpty'), testId: 'database-linked-new-empty', icon: IconPlus, onClick: () => {
        panel.close();
        options.newEmpty('');
      } }));
    }
    if (shown.length > 0) rows.push(panelLabel(t('tools.database.layoutExistingDataSources')));
    for (const source of shown) {
      rows.push(panelRow({
        label: source.title === '' ? untitled : source.title,
        description: source.parent,
        testId: `database-linked-source-${source.id}`,
        icon: IconDatabase,
        onClick: () => {
          options.pickSource(source.id);
          panel.push(viewPage(source));
        },
      }));
    }
    if (shown.length < matches.length) {
      rows.push(panelRow({ label: t('tools.database.linkedShowMore'), testId: 'database-linked-show-more', icon: IconDotsHorizontal, onClick: () => {
        state.expanded = true;
        fillList(panel);
      } }));
    }
    if (query !== '') {
      rows.push(panelRow({ label: t('tools.database.linkedNewNamed', { name: query }), testId: 'database-linked-new-named', icon: IconPlus, onClick: () => {
        panel.close();
        options.newEmpty(query);
      } }));
    }
    list.replaceChildren(...rows);
  };

  const sourcePage: PanelPage = {
    title: t('tools.database.linkedPanelTitle'),
    build: (panel) => {
      const search = panelInput({
        value: state.query,
        placeholder: t('tools.database.linkedSearch'),
        label: t('tools.database.linkedSearch'),
        testId: 'database-linked-search',
        // Only the list redraws, so the field keeps its caret.
        onInput: (value) => {
          state.query = value;
          fillList(panel);
        },
      });

      fillList(panel);

      return [search, list];
    },
  };

  const panel = new DatabasePanel({
    anchor: options.anchor,
    root: sourcePage,
    testId: 'database-linked-picker',
    width: 290,
    backLabel: t('tools.database.peekBack'),
    ...(options.onClose !== undefined ? { onClose: options.onClose } : {}),
  });

  panel.open();

  return panel;
};
