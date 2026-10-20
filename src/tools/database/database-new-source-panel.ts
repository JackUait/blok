import { IconArrowDiagonal, IconDatabase, IconPlus, IconUpload } from '../../components/icons';
import { DatabasePanel, panelInput, panelLabel, panelRow, panelSeparator } from './database-panel';
import type { LinkedPickerSource } from './database-linked-picker';

export interface NewSourcePanelOptions {
  anchor: HTMLElement;
  t: (key: string, vars?: Record<string, string>) => string;
  /** Databases the new view may show instead of its own empty source. */
  sources: () => LinkedPickerSource[];
  importCsv: () => void;
  linkExisting: (id: string) => void;
  onClose?: () => void;
}

/**
 * The panel "New data source" opens on its new tab (research/23 §10, shot 121).
 * The source already exists, so "New empty data source" only closes it.
 * Not built: "Suggested" templates (Blok has no database templates) and the
 * AI prompt (no host lever sets up a database).
 */
export const openNewSourcePanel = (options: NewSourcePanelOptions): DatabasePanel => {
  const { t } = options;
  const untitled = t('tools.database.relationUntitledDatabase');
  const state = { query: '', linkQuery: '' };
  const list = document.createElement('div');
  const linkList = document.createElement('div');
  const matches = (label: string, query: string): boolean => label.toLowerCase().includes(query.trim().toLowerCase());

  const fillLink = (panel: DatabasePanel): void => {
    const shown = options.sources().filter((source) => matches(source.title === '' ? untitled : source.title, state.linkQuery));

    linkList.replaceChildren(...(shown.length === 0 ? [] : [panelLabel(t('tools.database.layoutExistingDataSources'))]), ...shown.map((source) => panelRow({
      label: source.title === '' ? untitled : source.title,
      description: source.parent,
      testId: `database-new-source-existing-${source.id}`,
      icon: IconDatabase,
      onClick: () => {
        panel.close();
        options.linkExisting(source.id);
      },
    })));
  };

  const linkPage = {
    title: t('tools.database.linkedLinkExisting'),
    build: (panel: DatabasePanel): HTMLElement[] => {
      const search = panelInput({
        value: state.linkQuery,
        placeholder: t('tools.database.linkedLinkSearch'),
        label: t('tools.database.linkedLinkSearch'),
        testId: 'database-new-source-link-search',
        onInput: (value) => {
          state.linkQuery = value;
          fillLink(panel);
        },
      });

      fillLink(panel);

      return [search, linkList];
    },
  };

  const fill = (panel: DatabasePanel): void => {
    const empty = t('tools.database.linkedNewEmpty');
    const csv = t('tools.database.csvImport');
    const link = t('tools.database.linkedLinkExisting');
    const rows: HTMLElement[] = [];

    if (matches(empty, state.query)) {
      rows.push(panelRow({ label: empty, testId: 'database-new-source-empty', icon: IconPlus, onClick: () => panel.close() }));
    }
    if (matches(csv, state.query)) {
      rows.push(panelRow({
        label: csv,
        testId: 'database-new-source-csv',
        icon: IconUpload,
        onClick: () => {
          panel.close();
          options.importCsv();
        },
      }));
    }
    if (matches(link, state.query)) {
      if (rows.length > 0) rows.push(panelSeparator());
      rows.push(panelRow({ label: link, testId: 'database-new-source-link', icon: IconArrowDiagonal, onClick: () => panel.push(linkPage) }));
    }
    list.replaceChildren(...rows);
  };

  const panel = new DatabasePanel({
    anchor: options.anchor,
    root: {
      title: t('tools.database.newDataSource'),
      build: (current) => {
        const search = panelInput({
          value: state.query,
          placeholder: t('tools.database.newDataSourceSearch'),
          label: t('tools.database.newDataSourceSearch'),
          testId: 'database-new-source-search',
          // Only the list redraws, so the field keeps its caret.
          onInput: (value) => {
            state.query = value;
            fill(current);
          },
        });

        fill(current);

        return [search, list];
      },
    },
    testId: 'database-new-source-panel',
    width: 290,
    backLabel: t('tools.database.peekBack'),
    ...(options.onClose !== undefined ? { onClose: options.onClose } : {}),
  });

  panel.open();

  return panel;
};
