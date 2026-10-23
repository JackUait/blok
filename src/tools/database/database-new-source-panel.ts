import { IconArrowDiagonal, IconArrowDownLine, IconArrowUp, IconDatabase, IconDotsHorizontal, IconEmojiSparkles, IconPlus } from '../../components/icons';
import { DatabasePanel, panelCloseButton, panelInput, panelLabel, panelRow, panelSeparator } from './database-panel';
import type { LinkedPickerSource } from './database-linked-picker';

export interface NewSourcePanelOptions {
  anchor: HTMLElement;
  t: (key: string, vars?: Record<string, string>) => string;
  /** Databases the new view may show instead of its own empty source. */
  sources: () => LinkedPickerSource[];
  /**
   * This database's other sources, under "Suggested" (research/26 §2). Empty titles read "New data source".
   * A new database leaves it out: its link page shows Existing only, as measured.
   */
  suggested?: () => Array<{ id: string; title: string }>;
  /** Without it there is no Import CSV row. */
  importCsv?: () => void;
  /** `New “<query>” data source`: the new source takes the query as its title. Only the search variant has a query. */
  nameSource?: (title: string) => void;
  linkExisting: (id: string) => void;
  /** A new database (research/26 §2): the title is "New database" and there is no search. */
  newDatabase?: boolean;
  /**
   * A new database's AI prompt box in the top slot. `submit` resolves true
   * when the database was set up, which closes the panel.
   */
  prompt?: { submit: (text: string) => Promise<boolean> };
  /** A new database's "Suggested" templates (research/27 §1), under Import CSV. */
  starters?: { list: Array<{ id: string; label: string; icon: string; tint: string }>; pick: (id: string) => void; more?: () => void };
  onClose?: () => void;
}

/** The AI prompt box. Enter sends, Shift+Enter breaks the line: Notion's keys were not measured. */
const promptBox = (
  t: NewSourcePanelOptions['t'],
  text: { read: () => string; write: (value: string) => void },
  submit: (text: string) => Promise<boolean>,
  done: () => void
): HTMLElement => {
  const wrap = document.createElement('div');
  const icon = document.createElement('span');
  const field = document.createElement('textarea');
  const send = document.createElement('button');
  const label = t('tools.database.aiSetupPlaceholder');
  const flags = { busy: false };
  const sync = (): void => {
    const off = flags.busy || text.read().trim() === '';

    field.disabled = flags.busy;
    wrap.toggleAttribute('aria-busy', flags.busy);
    if (off) send.setAttribute('aria-disabled', 'true');
    else send.removeAttribute('aria-disabled');
  };
  const go = (): void => {
    const prompt = text.read().trim();

    if (flags.busy || prompt === '') return;
    flags.busy = true;
    sync();
    void submit(prompt).catch(() => false).then((made) => {
      flags.busy = false;
      if (made) {
        done();

        return;
      }
      sync();
      field.focus();
    });
  };

  wrap.setAttribute('data-blok-database-ai-prompt', '');
  icon.setAttribute('aria-hidden', 'true');
  icon.innerHTML = IconEmojiSparkles;
  field.rows = 1;
  field.value = text.read();
  field.placeholder = label;
  field.setAttribute('aria-label', label);
  field.setAttribute('data-blok-testid', 'database-new-database-ai-prompt');
  field.addEventListener('input', () => {
    text.write(field.value);
    sync();
  });
  field.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' || event.shiftKey || event.isComposing) return;
    event.preventDefault();
    go();
  });
  send.type = 'button';
  send.innerHTML = IconArrowUp;
  send.setAttribute('aria-label', t('assistant.send'));
  send.setAttribute('data-blok-testid', 'database-new-database-ai-submit');
  // aria-disabled, not disabled: the button keeps its place in the tab order, as Notion's does.
  send.addEventListener('click', go);
  wrap.append(icon, field, send);
  sync();

  return wrap;
};

/**
 * The panel "New data source" opens on its new tab (research/23 §10, shot 121).
 * The source already exists, so "New empty data source" only closes it.
 * With `newDatabase` it is the "New database" panel of a fresh insert instead.
 */
export const openNewSourcePanel = (options: NewSourcePanelOptions): DatabasePanel => {
  const { t } = options;
  const untitled = t('tools.database.relationUntitledDatabase');
  const state = { query: '', linkQuery: '', prompt: '' };
  const list = document.createElement('div');
  const linkList = document.createElement('div');
  const matches = (label: string, query: string): boolean => label.toLowerCase().includes(query.trim().toLowerCase());

  const fillLink = (panel: DatabasePanel): void => {
    const shown = options.sources().filter((source) => matches(source.title === '' ? untitled : source.title, state.linkQuery));
    const sourceName = (title: string): string => (title.trim() === '' ? t('tools.database.newDataSource') : title);
    const suggested = (options.suggested?.() ?? []).filter((source) => matches(sourceName(source.title), state.linkQuery));

    linkList.replaceChildren(...(suggested.length === 0 ? [] : [panelLabel(t('tools.database.linkedSuggested'))]), ...suggested.map((source) => panelRow({
      label: sourceName(source.title),
      testId: `database-new-source-suggested-${source.id}`,
      icon: IconDatabase,
      onClick: () => {
        panel.close();
        options.linkExisting(source.id);
      },
    })), ...(shown.length === 0 ? [] : [panelLabel(t('tools.database.layoutExistingDataSources'))]), ...shown.map((source) => panelRow({
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

  // research/26 §1b: the same round × as View settings, on every page of this panel.
  const closeButton = (panel: DatabasePanel): HTMLElement => panelCloseButton(panel, t('tools.database.close'));

  const linkPage = {
    title: t('tools.database.linkedLinkExisting'),
    headerAction: closeButton,
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
    const query = state.query.trim();
    const nameSource = options.nameSource;

    // research/26 §2: a query replaces the first row and never hides Import CSV.
    if (query === '') {
      const row = panelRow({ label: empty, testId: 'database-new-source-empty', icon: IconPlus, onClick: () => panel.close() });

      // A new database's row is 44px with the plus in a 30px gray tile (findings-creation N03).
      if (options.newDatabase === true) row.setAttribute('data-blok-database-panel-tiled', '');
      rows.push(row);
    } else if (nameSource !== undefined) {
      rows.push(panelRow({
        label: t('tools.database.newDataSourceNamed', { query }),
        testId: 'database-new-source-named',
        icon: IconPlus,
        onClick: () => {
          panel.close();
          nameSource(query);
        },
      }));
    }
    if (options.importCsv !== undefined) {
      const importCsv = options.importCsv;

      const row = panelRow({
        label: csv,
        testId: 'database-new-source-csv',
        icon: IconArrowDownLine,
        onClick: () => {
          panel.close();
          importCsv();
        },
      });

      if (options.newDatabase === true) row.setAttribute('data-blok-database-panel-tiled', 'bare');
      rows.push(row);
    }
    const starters = options.starters;

    if (starters !== undefined && starters.list.length > 0 && query === '') {
      rows.push(panelLabel(t('tools.database.linkedSuggested')), ...starters.list.map((starter) => {
        const row = panelRow({
          label: starter.label,
          testId: `database-new-database-starter-${starter.id}`,
          icon: starter.icon,
          onClick: () => {
            panel.close();
            starters.pick(starter.id);
          },
        });

        row.setAttribute('data-blok-database-panel-tiled', '');
        row.querySelector('[data-blok-database-panel-icon]')?.setAttribute('data-blok-database-starter-tile', starter.tint);

        return row;
      }));
    }
    const more = starters?.more;

    // research/26 §2: an ellipsis row in secondary ink, after Suggested; it stays when every template is used.
    if (more !== undefined && query === '') {
      rows.push(panelRow({
        label: t('tools.database.starterMoreTemplates'),
        testId: 'database-new-database-more-templates',
        icon: IconDotsHorizontal,
        muted: true,
        onClick: () => {
          panel.close();
          more();
        },
      }));
    }
    if (matches(link, state.query)) {
      if (rows.length > 0) rows.push(panelSeparator());
      rows.push(panelRow({ label: link, testId: 'database-new-source-link', icon: IconArrowDiagonal, onClick: () => panel.push(linkPage) }));
    }
    list.replaceChildren(...rows);
  };

  const prompt = options.prompt;
  const newDatabase = options.newDatabase === true;
  const panel = new DatabasePanel({
    anchor: options.anchor,
    root: {
      title: t(newDatabase ? 'tools.database.linkedPanelTitle' : 'tools.database.newDataSource'),
      headerAction: closeButton,
      build: (current) => {
        fill(current);
        if (newDatabase) {
          return prompt === undefined
            ? [list]
            : [promptBox(t, { read: () => state.prompt, write: (value) => { state.prompt = value; } }, prompt.submit, () => current.close()), list];
        }

        return [
          panelInput({
            value: state.query,
            placeholder: t('tools.database.newDataSourceSearch'),
            label: t('tools.database.newDataSourceSearch'),
            testId: 'database-new-source-search',
            // Only the list redraws, so the field keeps its caret.
            onInput: (value) => {
              state.query = value;
              fill(current);
            },
          }),
          list,
        ];
      },
    },
    testId: newDatabase ? 'database-new-database-panel' : 'database-new-source-panel',
    width: 290,
    backLabel: t('tools.database.peekBack'),
    ...(options.onClose !== undefined ? { onClose: options.onClose } : {}),
  });

  panel.root.setAttribute('data-blok-database-creation-panel', '');
  panel.open();

  return panel;
};
