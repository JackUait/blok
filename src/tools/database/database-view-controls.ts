import { IconSearch, IconSliders, IconLock, IconPlus } from '../../components/icons';
import type { I18n } from '../../../types';
import { DatabasePanel, panelRow } from './database-panel';
import { PersonalViewEdits } from './database-view-state';
import type { ViewStateFallback } from './database-view-state';
import { defaultFilterFor, filterPillLabel, filterValueText, sortDirectionLabelKey } from './database-filter-labels';
import { countFilterRules, withEntryIds } from './filter-tree';
import { openFilterPill, openViewSettings } from './database-view-settings-panel';
import type { ViewGroupEntry, ViewSettingsContext, ViewSettingsStart } from './database-view-settings-panel';
import { sortFromHeader } from './view-data';
import type { ViewChanges } from './database-model';
import type {
  DatabaseViewConfig,
  DatabaseViewStateStore,
  PersonalViewPatch,
  PropertyDefinition,
  SortConfig,
  ViewType,
} from './types';

/** Notion shows 🔍 once a database has at least three pages (research/05 §5). */
export const SEARCH_MIN_ROWS = 3;

/** What the controls ask of the database tool. */
export interface ViewControlsHost {
  i18n: Pick<I18n, 't'>;
  store?: DatabaseViewStateStore;
  fallback: ViewStateFallback;
  savedView: () => DatabaseViewConfig | undefined;
  /** Localized schema. */
  schema: () => PropertyDefinition[];
  rowCount: () => number;
  locked: () => boolean;
  readOnly: () => boolean;
  viewCount: () => number;
  layouts: readonly ViewType[];
  /** The current user's id, for a person filter's "Me" (the people lever). */
  me?: () => string | null;
  /** A shared write to the active view. The tool refuses it while locked. */
  updateView: (changes: ViewChanges) => void;
  setLayout: (type: ViewType) => void;
  setLocked: (locked: boolean) => void;
  duplicateView: () => void;
  deleteView: () => void;
  copyViewLink: () => void;
  groups: (sub: boolean) => ViewGroupEntry[];
  /** Redraws the active view after a personal edit or a search. */
  rerender: () => void;
}

const button = (testId: string, label: string, content: { icon?: string; text?: string }): HTMLButtonElement => {
  const el = document.createElement('button');

  el.type = 'button';
  el.setAttribute('data-blok-testid', testId);
  el.setAttribute('aria-label', label);
  if (content.icon !== undefined) el.innerHTML = content.icon;
  if (content.text !== undefined) el.append(content.text);

  return el;
};

/**
 * The database toolbar (Filter, Sort, search, settings) and the filter bar
 * of pills below it. Filter and sort edits are personal until "Save for
 * everyone" (D4); every other setting writes the shared view.
 */
export class DatabaseViewControls {
  readonly toolbar: HTMLElement;
  readonly filterBar: HTMLElement;
  private readonly host: ViewControlsHost;
  private readonly personal: PersonalViewEdits;
  private readonly filterButton: HTMLButtonElement;
  private readonly sortButton: HTMLButtonElement;
  private readonly searchButton: HTMLButtonElement;
  /** In the DOM only while the person searches: a hidden input still reads as a caret slot. */
  private readonly searchInput: HTMLInputElement;
  private readonly settingsButton: HTMLButtonElement;
  private readonly lockBadge: HTMLElement;
  private panel: DatabasePanel | null = null;
  private query = '';

  constructor(host: ViewControlsHost) {
    this.host = host;
    this.personal = new PersonalViewEdits({
      ...(host.store !== undefined ? { store: host.store } : {}),
      fallback: host.fallback,
      onChange: () => {
        this.host.rerender();
        this.refresh();
      },
    });

    this.toolbar = document.createElement('div');
    this.toolbar.setAttribute('data-blok-database-view-toolbar', '');
    this.toolbar.setAttribute('role', 'toolbar');
    this.toolbar.setAttribute('aria-label', this.t('toolbarLabel'));

    this.lockBadge = document.createElement('span');
    this.lockBadge.setAttribute('data-blok-database-lock-badge', '');
    this.lockBadge.setAttribute('data-blok-testid', 'database-toolbar-locked');
    this.lockBadge.setAttribute('role', 'img');
    this.lockBadge.setAttribute('aria-label', this.t('lockedLabel'));
    this.lockBadge.innerHTML = IconLock;

    this.filterButton = button('database-toolbar-filter', this.t('settingsFilter'), { text: this.t('settingsFilter') });
    this.sortButton = button('database-toolbar-sort', this.t('settingsSort'), { text: this.t('settingsSort') });
    this.searchButton = button('database-toolbar-search', this.t('searchLabel'), { icon: IconSearch });
    this.settingsButton = button('database-toolbar-settings', this.t('settingsTitle'), { icon: IconSliders });
    this.searchInput = document.createElement('input');
    this.searchInput.type = 'search';
    this.searchInput.hidden = true;
    this.searchInput.placeholder = this.t('searchPlaceholder');
    this.searchInput.setAttribute('aria-label', this.t('searchLabel'));
    this.searchInput.setAttribute('data-blok-database-search-input', '');
    this.searchInput.setAttribute('data-blok-testid', 'database-search-input');

    this.filterButton.addEventListener('click', () => this.openFilterPicker(this.filterButton));
    this.sortButton.addEventListener('click', () => this.openSettings(this.sortButton, 'sort'));
    this.settingsButton.addEventListener('click', () => this.openSettings(this.settingsButton, 'root'));
    this.searchButton.addEventListener('click', () => this.showSearch());
    this.searchInput.addEventListener('input', () => this.setSearch(this.searchInput.value));
    this.searchInput.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      this.hideSearch();
    });
    this.searchInput.addEventListener('blur', () => {
      if (this.query === '') this.hideSearch();
    });
    this.toolbar.append(this.lockBadge, this.filterButton, this.sortButton, this.searchButton, this.settingsButton);

    this.filterBar = document.createElement('div');
    this.filterBar.setAttribute('data-blok-database-filter-bar', '');
    this.refresh();
  }

  /** Fetches personal edits from the host store; without one they are read on demand. */
  load(viewIds: string[]): void {
    void this.personal.load(viewIds);
  }

  get search(): string {
    return this.query;
  }

  /** The view as this person sees it. */
  effective(view: DatabaseViewConfig): DatabaseViewConfig {
    return this.personal.effective(view);
  }

  hasPersonalEdits(viewId: string): boolean {
    return this.personal.has(viewId);
  }

  /** Syncs the toolbar and filter bar to the active view, and the open panel. */
  refresh(): void {
    const saved = this.host.savedView();
    const hidden = this.host.readOnly() || saved === undefined;

    this.toolbar.hidden = hidden;
    this.filterBar.hidden = hidden;
    if (saved === undefined || hidden) {
      this.filterBar.replaceChildren();

      return;
    }
    const view = this.effective(saved);

    this.lockBadge.hidden = !this.host.locked();
    this.filterButton.toggleAttribute('data-active', view.filters.length + countFilterRules(view.filterTree) > 0);
    this.sortButton.toggleAttribute('data-active', view.sorts.length > 0);
    this.searchButton.hidden = this.host.rowCount() < SEARCH_MIN_ROWS && this.query === '';
    this.renderFilterBar(view);
    this.panel?.refresh();
  }

  destroy(): void {
    this.panel?.close();
    this.panel = null;
  }

  /** Filter from a column header: a new simple filter on that property, opened at once. */
  filterBy(propertyId: string, anchor: HTMLElement): void {
    const property = this.host.schema().find((p) => p.id === propertyId);
    const view = this.view();

    if (property === undefined || view === undefined) return;
    const filter = defaultFilterFor(property);

    this.updatePersonal({ filters: [...withEntryIds(view.filters), filter] });
    this.openPill(filter.id, this.filterBar.querySelector<HTMLElement>(`[data-filter-id="${CSS.escape(filter.id)}"]`) ?? anchor);
  }

  /** Sort from a column header: the choice replaces every sort (research/08). */
  sortBy(propertyId: string, anchor: HTMLElement): void {
    const property = this.host.schema().find((p) => p.id === propertyId);

    if (property === undefined) return;
    const pick = (direction: SortConfig['direction']): HTMLElement => panelRow({
      label: this.host.i18n.t(sortDirectionLabelKey(property.type, direction)),
      testId: `database-header-sort-${direction}`,
      onClick: () => {
        this.updatePersonal({ sorts: sortFromHeader(propertyId, direction) });
        this.panel?.close();
      },
    });

    this.showPanel(new DatabasePanel({
      anchor,
      root: { build: () => [pick('asc'), pick('desc')] },
      testId: 'database-header-sort',
      width: 220,
      backLabel: this.t('settingsBack'),
    }));
  }

  /** Group from a column header: groups by that property, then shows the group settings. */
  groupBy(propertyId: string, anchor: HTMLElement): void {
    this.host.updateView({ groupBy: propertyId });
    this.openSettings(anchor, 'group');
  }

  openSettings(anchor: HTMLElement, start: ViewSettingsStart): void {
    this.panel?.close();
    this.panel = openViewSettings(anchor, this.settingsContext(), start, () => this.panelClosed(anchor));
    anchor.setAttribute('data-popover-open', '');
  }

  private t(key: string, vars?: Record<string, string | number>): string {
    return this.host.i18n.t(`tools.database.${key}`, vars);
  }

  private view(): DatabaseViewConfig | undefined {
    const saved = this.host.savedView();

    return saved === undefined ? undefined : this.effective(saved);
  }

  private updatePersonal(patch: PersonalViewPatch): void {
    const view = this.host.savedView();

    if (view === undefined) return;
    this.personal.set(view.id, {
      ...patch,
      ...(patch.filters !== undefined ? { filters: withEntryIds(patch.filters) } : {}),
      ...(patch.sorts !== undefined ? { sorts: withEntryIds(patch.sorts) } : {}),
    });
    this.host.rerender();
    this.refresh();
  }

  private saveForEveryone(): void {
    const view = this.host.savedView();

    if (view === undefined || this.host.locked()) return;
    const patch = this.personal.get(view.id);

    this.personal.clear(view.id);
    this.host.updateView(patch);
    this.refresh();
  }

  private reset(): void {
    const view = this.host.savedView();

    if (view === undefined) return;
    this.personal.clear(view.id);
    this.host.rerender();
    this.refresh();
  }

  private settingsContext(): ViewSettingsContext {
    return {
      i18n: this.host.i18n,
      view: () => this.view() ?? this.emptyView(),
      schema: () => this.host.schema(),
      locked: () => this.host.locked(),
      layouts: this.host.layouts,
      canDeleteView: () => this.host.viewCount() > 1,
      updateView: (changes) => this.host.updateView(changes),
      updatePersonal: (patch) => this.updatePersonal(patch),
      setLayout: (type) => this.host.setLayout(type),
      setLocked: (locked) => {
        this.host.setLocked(locked);
        this.refresh();
      },
      duplicateView: () => this.host.duplicateView(),
      deleteView: () => this.host.deleteView(),
      copyViewLink: () => this.host.copyViewLink(),
      groups: (sub) => this.host.groups(sub),
    };
  }

  private emptyView(): DatabaseViewConfig {
    return { id: '', name: '', type: 'table', position: '', sorts: [], filters: [], visibleProperties: [] };
  }

  private showPanel(panel: DatabasePanel): void {
    this.panel?.close();
    this.panel = panel;
    panel.open();
  }

  private panelClosed(anchor: HTMLElement): void {
    anchor.removeAttribute('data-popover-open');
    this.panel = null;
  }

  private openPill(filterId: string, anchor: HTMLElement): void {
    this.panel?.close();
    this.panel = openFilterPill(anchor, this.settingsContext(), filterId, () => this.panelClosed(anchor));
    anchor.setAttribute('data-popover-open', '');
  }

  /** "+ Filter": pick a property, then edit the new filter's value. */
  private openFilterPicker(anchor: HTMLElement): void {
    const panel = new DatabasePanel({
      anchor,
      root: {
        title: this.t('filterAdd'),
        build: () => this.host.schema()
          .filter((p) => p.type !== 'richText')
          .map((property) => panelRow({
            label: property.name,
            testId: `database-pick-property-${property.id}`,
            onClick: () => {
              panel.close();
              this.filterBy(property.id, anchor);
            },
          })),
      },
      testId: 'database-filter-picker',
      width: 220,
      backLabel: this.t('settingsBack'),
      onClose: () => this.panelClosed(anchor),
    });

    anchor.setAttribute('data-popover-open', '');
    this.showPanel(panel);
  }

  private showSearch(): void {
    this.searchButton.hidden = true;
    this.searchInput.hidden = false;
    this.searchButton.after(this.searchInput);
    this.searchInput.focus();
  }

  private hideSearch(): void {
    this.searchInput.hidden = true;
    this.searchInput.remove();
    this.searchInput.value = '';
    this.setSearch('');
    this.searchButton.hidden = this.host.rowCount() < SEARCH_MIN_ROWS;
  }

  private setSearch(query: string): void {
    if (query === this.query) return;
    this.query = query;
    this.host.rerender();
  }

  private renderFilterBar(view: DatabaseViewConfig): void {
    const schema = this.host.schema();
    const t = (key: string, vars?: Record<string, string | number>): string => this.host.i18n.t(key, vars);
    const pills: HTMLElement[] = [];

    if (view.sorts.length > 0) {
      const first = schema.find((p) => p.id === view.sorts[0].propertyId);
      const label = view.sorts.length === 1 && first !== undefined
        ? `${view.sorts[0].direction === 'asc' ? '↑' : '↓'} ${first.name}`
        : this.t('sortCount', { count: view.sorts.length });
      const pill = button('database-sort-pill', label, { text: label });

      pill.setAttribute('data-blok-database-filter-pill', '');
      pill.setAttribute('data-active', '');
      pill.addEventListener('click', () => this.openSettings(pill, 'sort'));
      pills.push(pill);
    }
    for (const filter of withEntryIds(view.filters)) {
      const property = schema.find((p) => p.id === filter.propertyId);

      if (property === undefined) continue;
      const label = filterPillLabel(filter, property, t);
      const pill = button(`database-filter-pill-${filter.id}`, label, { text: label });

      pill.setAttribute('data-blok-database-filter-pill', '');
      pill.setAttribute('data-filter-id', filter.id);
      pill.toggleAttribute('data-active', filterValueText(filter, property, t) !== '');
      pill.addEventListener('click', () => this.openPill(filter.id, pill));
      pills.push(pill);
    }
    const rules = countFilterRules(view.filterTree);

    if (rules > 0) {
      const label = this.t('filterRuleCount', { count: rules });
      const pill = button('database-advanced-pill', label, { text: label });

      pill.setAttribute('data-blok-database-filter-pill', '');
      pill.setAttribute('data-active', '');
      pill.addEventListener('click', () => this.openSettings(pill, 'filter'));
      pills.push(pill);
    }

    const personal = this.personal.has(view.id);

    if (pills.length === 0 && !personal) {
      this.filterBar.replaceChildren();
      this.filterBar.hidden = true;

      return;
    }
    const add = button('database-filter-bar-add', this.t('filterAdd'), { icon: IconPlus, text: this.t('settingsFilter') });

    add.setAttribute('data-blok-database-filter-add', '');
    add.addEventListener('click', () => this.openFilterPicker(add));

    const scroller = document.createElement('div');

    scroller.setAttribute('data-blok-database-filter-pills', '');
    scroller.append(...pills, add);

    const children: HTMLElement[] = [scroller];

    if (personal) {
      const actions = document.createElement('div');
      const reset = button('database-view-reset', this.t('viewReset'), { text: this.t('viewReset') });

      actions.setAttribute('data-blok-database-filter-actions', '');
      reset.addEventListener('click', () => this.reset());
      actions.appendChild(reset);
      if (!this.host.locked()) {
        const save = button('database-view-save', this.t('viewSaveForEveryone'), { text: this.t('viewSaveForEveryone') });

        save.setAttribute('data-blok-database-filter-save', '');
        save.addEventListener('click', () => this.saveForEveryone());
        actions.appendChild(save);
      }
      children.push(actions);
    }
    this.filterBar.hidden = false;
    this.filterBar.replaceChildren(...children);
  }
}
