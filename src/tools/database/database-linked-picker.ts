import { IconDatabase, IconDotsHorizontal, IconPlus } from '../../components/icons';
import { DatabasePanel, panelCloseButton, panelInput, panelLabel, panelRow, panelSeparator } from './database-panel';
import type { PanelPage } from './database-panel';
import { VIEW_ICONS } from './database-tab-bar';
import type { DatabaseViewConfig } from './types';

/** A database the linked view can show. */
export interface LinkedPickerSource {
  id: string;
  title: string;
  /** The page it sits on: shown under its name. */
  parent: string;
  /** Set for a database in another document, listed by the host. */
  documentId?: string;
}

export interface LinkedPickerOptions {
  anchor: HTMLElement;
  t: (key: string, vars?: Record<string, string>) => string;
  sources: () => LinkedPickerSource[];
  /** Databases in other documents, listed after this document's. The host does the matching. */
  remoteSources?: (query: string) => Promise<LinkedPickerSource[]>;
  /** The source's views that a linked view may copy. */
  views: (source: LinkedPickerSource) => DatabaseViewConfig[];
  newEmpty: (title: string) => void;
  /** A source in another document loads first; the "New view" page waits for it. */
  pickSource: (source: LinkedPickerSource) => void | Promise<void>;
  newTableView: () => void;
  copyView: (view: DatabaseViewConfig) => void;
  onClose?: () => void;
}

/** A source row: its glyph draws at 20px (findings-creation N19). */
const sourceRow = (options: Parameters<typeof panelRow>[0]): HTMLButtonElement => {
  const row = panelRow(options);

  row.setAttribute('data-blok-database-source-row', '');

  return row;
};

/** Rows before "Show more" (research 20 §2a, 41-linked-picker.png). */
const FIRST_ROWS = 3;

/** The "New view" page: a fresh view first, then the views it can copy. */
const newViewPage = (
  t: LinkedPickerOptions['t'],
  source: LinkedPickerSource,
  fresh: { label: string; testId: string; onClick: () => void },
  views: DatabaseViewConfig[],
  copyView: (view: DatabaseViewConfig) => void
): PanelPage => ({
  title: t('tools.database.newView'),
  build: (panel) => [
    panelRow({
      label: fresh.label,
      testId: fresh.testId,
      icon: IconPlus,
      onClick: () => {
        panel.close();
        fresh.onClick();
      },
    }),
    panelLabel(t('tools.database.linkedViewsOn', { name: source.title === '' ? t('tools.database.relationUntitledDatabase') : source.title })),
    ...views.map((view) => panelRow({
      label: view.name,
      testId: `database-linked-view-${view.id}`,
      icon: VIEW_ICONS[view.type],
      onClick: () => {
        panel.close();
        copyView(view);
      },
    })),
  ],
});

/**
 * "Linked view of data source" (research 20 §2a): the "New database" page
 * picks a source, then the "New view" page picks the linked view's first
 * view. No row shows a preview on hover.
 */
export const openLinkedPicker = (options: LinkedPickerOptions): DatabasePanel => {
  const { t } = options;
  const untitled = t('tools.database.relationUntitledDatabase');

  const viewPage = (source: LinkedPickerSource): PanelPage => newViewPage(
    t,
    source,
    { label: t('tools.database.linkedNewTableView'), testId: 'database-linked-new-table-view', onClick: options.newTableView },
    options.views(source),
    options.copyView
  );

  const state = { query: '', expanded: false, closed: false, remote: [] as LinkedPickerSource[], remoteQuery: '', asked: false };
  const list = document.createElement('div');

  const askHost = (panel: DatabasePanel): void => {
    const query = state.query.trim();

    if (options.remoteSources === undefined) return;
    state.asked = true;
    void options.remoteSources(query).catch((): LinkedPickerSource[] => []).then((found) => {
      // An answer to an older query, or to a closed panel, is dropped.
      if (state.closed || state.query.trim() !== query) return;
      state.remote = found;
      state.remoteQuery = query;
      fillList(panel);
    });
  };

  const fillList = (panel: DatabasePanel): void => {
    const query = state.query.trim();
    const remote = state.remoteQuery === query ? state.remote : [];
    const matches = [
      ...options.sources().filter((source) => (source.title === '' ? untitled : source.title).toLowerCase().includes(query.toLowerCase())),
      ...remote,
    ];
    const shown = state.expanded ? matches : matches.slice(0, FIRST_ROWS);
    const rows: HTMLElement[] = [];

    if (query === '') {
      const empty = panelRow({ label: t('tools.database.linkedNewEmpty'), testId: 'database-linked-new-empty', icon: IconPlus, onClick: () => {
        panel.close();
        options.newEmpty('');
      } });

      // research: Notion's row is 44px with the plus in a 30px gray tile (findings-creation N19).
      empty.setAttribute('data-blok-database-panel-tiled', '');
      rows.push(empty);
    }
    if (shown.length > 0) rows.push(panelLabel(t('tools.database.layoutExistingDataSources')));
    for (const source of shown) {
      rows.push(sourceRow({
        label: source.title === '' ? untitled : source.title,
        description: source.parent,
        testId: `database-linked-source-${source.id}`,
        icon: IconDatabase,
        onClick: () => {
          const picked = options.pickSource(source);

          if (picked === undefined) {
            panel.push(viewPage(source));

            return;
          }
          void picked.then(() => {
            if (!state.closed) panel.push(viewPage(source));
          });
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
    headerAction: (panel) => panelCloseButton(panel, t('tools.database.close')),
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
          askHost(panel);
        },
      });

      fillList(panel);
      // Back from "New view" rebuilds this page: the host's answer is kept.
      if (!state.asked) askHost(panel);

      return [search, panelSeparator(), list];
    },
  };

  const panel = new DatabasePanel({
    anchor: options.anchor,
    root: sourcePage,
    testId: 'database-linked-picker',
    width: 290,
    backLabel: t('tools.database.peekBack'),
    onClose: () => {
      state.closed = true;
      options.onClose?.();
    },
  });

  panel.root.setAttribute('data-blok-database-creation-panel', '');
  panel.open();
  // A fresh insert puts the caret in the block after the picker opened; the search takes it back.
  requestAnimationFrame(() => {
    const search = panel.root.querySelector<HTMLElement>('[data-blok-testid="database-linked-search"]');

    if (!state.closed && search !== null && !panel.root.contains(document.activeElement)) search.focus();
  });

  return panel;
};

export interface LinkedAddViewOptions {
  anchor: HTMLElement;
  t: (key: string, vars?: Record<string, string>) => string;
  /** The linked view's own source: the one "Suggested" row. */
  source: LinkedPickerSource;
  /** "New <layout> view": keeps the tab just added. */
  newViewLabel: string;
  /** The views the new tab may copy: the source's, then the block's own. */
  views: () => DatabaseViewConfig[];
  copyView: (view: DatabaseViewConfig) => void;
  onClose?: () => void;
}

/**
 * "+" add view on a linked view (research 20 §2b): the tab is added at once,
 * then "Link to existing data source" picks the source and "New view" picks
 * a fresh view or one to copy. A linked block holds one source, so only that
 * source is listed, under "Suggested".
 */
export const openLinkedAddView = (options: LinkedAddViewOptions): DatabasePanel => {
  const { t, source } = options;
  const name = source.title === '' ? t('tools.database.relationUntitledDatabase') : source.title;
  const state = { query: '' };
  const list = document.createElement('div');
  const fillList = (panel: DatabasePanel): void => {
    const shown = name.toLowerCase().includes(state.query.trim().toLowerCase());

    list.replaceChildren(...(shown
      ? [
        panelLabel(t('tools.database.linkedSuggested')),
        panelRow({
          label: name,
          description: source.parent,
          testId: `database-linked-source-${source.id}`,
          icon: IconDatabase,
          onClick: () => panel.push(newViewPage(
            t,
            source,
            { label: options.newViewLabel, testId: 'database-linked-new-view', onClick: () => undefined },
            options.views(),
            options.copyView
          )),
        }),
      ]
      : []));
  };
  const panel = new DatabasePanel({
    anchor: options.anchor,
    root: {
      title: t('tools.database.linkedLinkExisting'),
      build: (current) => {
        const search = panelInput({
          value: state.query,
          placeholder: t('tools.database.linkedLinkSearch'),
          label: t('tools.database.linkedLinkSearch'),
          testId: 'database-linked-add-view-search',
          onInput: (value) => {
            state.query = value;
            fillList(current);
          },
        });

        fillList(current);

        return [search, list];
      },
    },
    testId: 'database-linked-add-view',
    width: 290,
    backLabel: t('tools.database.peekBack'),
    ...(options.onClose !== undefined ? { onClose: options.onClose } : {}),
  });

  panel.open();

  return panel;
};
