import type { PopoverItemParams } from '@/types/utils/popover/popover-item';
import { nanoid } from 'nanoid';
import { IconSearch, IconSliders, IconLock, IconPlus, IconChevronDown, IconFilter, IconSort, IconPreview, IconBolt, IconWand, IconArrowUp, IconCross, IconTrash, IconChevronDoubleRight } from '../../components/icons';
import { propertyTypeMeta } from './database-property-types';
import type { I18n } from '../../../types';
import { DatabasePanel, panelInput, panelReorderList, panelRow } from './database-panel';
import type { PanelPage } from './database-panel';
import { PersonalViewEdits } from './database-view-state';
import type { ViewStateFallback } from './database-view-state';
import { FILTERABLE_TYPES, defaultFilterFor, filterPillLabel, filterValueText, sortDirectionLabelKey } from './database-filter-labels';
import { countFilterRules, withEntryIds } from './filter-tree';
import { openViewSettings } from './database-view-settings-panel';
import { openFilterChip } from './database-filter-chip';
import { clearSearchMatches, paintSearchMatches } from './database-search-highlight';
import type { AutofillPanelSettings, DataSourceSettings, StarterRow, StructureSettings, ViewGroupEntry, ViewSettingsAction, ViewSettingsContext, ViewSettingsStart } from './database-view-settings-panel';
import { sortFromHeader } from './view-data';
import type { ViewChanges } from './database-model';
import { GROUPABLE_TYPES, groupByChange } from './group-keys';
import type { AutomationSettings } from './database-automations-panel';
import type {
  DatabaseViewConfig,
  DatabaseViewStateStore,
  PersonalViewPatch,
  PropertyDefinition,
  PropertyType,
  SortConfig,
  ViewType,
} from './types';

/** Notion's sort list adds files and ID to the groupable types (findings V20, shot 19). */
const SORTABLE_TYPES: readonly PropertyType[] = [...GROUPABLE_TYPES, 'files', 'uniqueId'];

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
  /** People the host lists, for person filters. */
  people?: () => Array<{ id: string; name: string }>;
  /** Rows a relation can point at, for relation filters. */
  relatedRows?: (property: PropertyDefinition) => Array<{ id: string; title: string }>;
  /** The database whose row page shows this view, or null: a relation to it can name "This page". */
  thisPageDatabase?: () => string | null;
  /** A shared write to the active view. The tool refuses it while locked. */
  updateView: (changes: ViewChanges) => void;
  setLayout: (type: ViewType) => void;
  setLocked: (locked: boolean) => void;
  /** A linked view: its lock reads "Lock views". */
  linked?: () => boolean;
  duplicateView: () => void;
  deleteView: () => void;
  copyViewLink: () => void;
  /** A calendar or timeline's "No date (N)": undefined hides it. */
  noDate?: () => { count: number; label: string; open: (anchor: HTMLElement) => void } | undefined;
  /** "Manage in Calendar": only when the host gave `config.calendar`. */
  manageInCalendar?: { label: string; onClick: () => void };
  groups: (sub: boolean) => ViewGroupEntry[];
  /** Redraws the active view after a personal edit or a search. */
  rerender: () => void;
  /** The active gallery or calendar view's layout rows. */
  layoutItems?: () => PopoverItemParams[];
  /** One-shot actions for the settings root page. */
  actions?: () => ViewSettingsAction[];
  /** "Customize page layout" in More settings. */
  customizeLayout?: () => ViewSettingsAction | undefined;
  automations?: AutomationSettings;
  /** AI Autofill: only when the host gave `config.ai.autofill`. */
  autofill?: AutofillPanelSettings;
  starterRow?: () => StarterRow | undefined;
  /** View settings "Source". */
  dataSources?: DataSourceSettings;
  /** Database settings: sub-items and dependencies. */
  structure?: StructureSettings;
  /** "New": a row from the default template. */
  newRow?: () => void;
  /** The "New" chevron: templates and "+ New template". */
  openNewMenu?: (anchor: HTMLElement) => void;
  /** A form view's "Share form" (research/19 §3d). */
  shareForm?: (anchor: HTMLElement) => void;
  /** A form view's "Preview": the form as a respondent sees it (research/36 §13). */
  previewForm?: () => void;
}

const part = (attribute: string, content: { icon?: string; text?: string }): HTMLElement => {
  const el = document.createElement('span');

  el.setAttribute(attribute, '');
  if (content.icon !== undefined) {
    el.setAttribute('aria-hidden', 'true');
    el.innerHTML = content.icon;
  }
  if (content.text !== undefined) el.textContent = content.text;

  return el;
};

/** Notion's chip: a glyph, the name in 500, the value in 400, then a down chevron. */
const chip = (testId: string, label: string, parts: { glyph: string; name: string; value?: string }): HTMLButtonElement => {
  const el = button(testId, label, {});

  el.setAttribute('data-blok-database-filter-pill', '');
  el.append(part('data-blok-database-chip-glyph', { icon: parts.glyph }));
  if (parts.value === undefined || parts.value === '') {
    el.append(part('data-blok-database-chip-name', { text: parts.name }));
  } else {
    el.append(part('data-blok-database-chip-name', { text: `${parts.name}:` }), ' ', part('data-blok-database-chip-value', { text: parts.value }));
  }
  el.append(part('data-blok-database-chip-chevron', { icon: IconChevronDown }));

  return el;
};

const button = (testId: string, label: string, content: { icon?: string; text?: string }): HTMLButtonElement => {
  const el = document.createElement('button');

  el.type = 'button';
  el.setAttribute('data-blok-testid', testId);
  el.setAttribute('aria-label', label);
  if (content.icon !== undefined) el.innerHTML = content.icon;
  if (content.text !== undefined) el.append(content.text);

  return el;
};

/** A 28px toolbar button that holds only an icon; its aria-label names it. */
const iconButton = (testId: string, label: string, icon: string): HTMLButtonElement => {
  const el = button(testId, label, { icon });

  el.setAttribute('data-blok-database-toolbar-icon', '');

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
  private readonly noDateButton: HTMLButtonElement;
  private readonly minimizeButton: HTMLButtonElement;
  /** The person's choice for the chip bar: shown, hidden, or `null` to follow its chips. Reset per view. */
  private barOpen: boolean | null = null;
  private barViewId: string | null = null;
  private barShown = false;
  private readonly sortButton: HTMLButtonElement;
  private readonly automationsButton: HTMLButtonElement;
  private readonly autofillButton: HTMLButtonElement;
  private readonly searchButton: HTMLButtonElement;
  /** In the DOM only while the person searches: a hidden input still reads as a caret slot. */
  private readonly searchInput: HTMLInputElement;
  /** Notion's clear ×: shown only while there is a query. */
  private readonly searchClear: HTMLButtonElement;
  private readonly settingsButton: HTMLButtonElement;
  private readonly lockBadge: HTMLElement;
  private readonly shareFormButton: HTMLButtonElement;
  private readonly previewFormButton: HTMLButtonElement;
  private panel: DatabasePanel | null = null;
  private query = '';
  /** Repaints the match tint when the rows redraw after a search (lazy rows, remote edits). */
  private matchObserver: MutationObserver | null = null;

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

    this.filterButton = iconButton('database-toolbar-filter', this.t('settingsFilter'), IconFilter);
    this.noDateButton = button('database-toolbar-no-date', '', {});
    this.noDateButton.setAttribute('data-blok-database-no-date-button', '');
    this.noDateButton.removeAttribute('aria-label');
    this.noDateButton.addEventListener('click', () => this.host.noDate?.()?.open(this.noDateButton));
    this.minimizeButton = iconButton('database-toolbar-minimize', this.t('filterBarMinimize'), IconChevronDoubleRight);
    this.sortButton = iconButton('database-toolbar-sort', this.t('settingsSort'), IconSort);
    this.automationsButton = iconButton('database-toolbar-automations', this.t('automationTitle'), IconBolt);
    this.autofillButton = iconButton('database-toolbar-autofill', this.t('aiAutofill'), IconWand);
    this.searchButton = iconButton('database-toolbar-search', this.t('searchLabel'), IconSearch);
    this.settingsButton = iconButton('database-toolbar-settings', this.t('settingsTitle'), IconSliders);
    this.searchInput = document.createElement('input');
    this.searchInput.type = 'search';
    this.searchInput.hidden = true;
    this.searchInput.placeholder = this.t('searchPlaceholder');
    this.searchInput.setAttribute('aria-label', this.t('searchLabel'));
    this.searchInput.setAttribute('data-blok-database-search-input', '');
    this.searchInput.setAttribute('data-blok-testid', 'database-search-input');

    this.filterButton.addEventListener('click', () => this.toggleFilterBar());
    this.minimizeButton.addEventListener('click', () => {
      this.barOpen = false;
      this.refresh();
    });
    this.sortButton.addEventListener('click', () => this.openSort());
    this.automationsButton.addEventListener('click', () => this.openSettings(this.automationsButton, 'automations'));
    this.autofillButton.addEventListener('click', () => this.openSettings(this.autofillButton, 'autofill'));
    this.settingsButton.addEventListener('click', () => this.openSettings(this.settingsButton, 'root'));
    this.searchButton.addEventListener('click', () => this.showSearch());
    this.searchClear = button('database-search-clear', this.t('searchClear'), { icon: IconCross });
    this.searchClear.setAttribute('data-blok-database-search-clear', '');
    this.searchClear.hidden = true;
    // Keeps the focus in the field: a blur on an empty query would close it.
    this.searchClear.addEventListener('pointerdown', (event) => event.preventDefault());
    this.searchClear.addEventListener('click', () => {
      this.searchInput.value = '';
      this.setSearch('');
      this.searchInput.focus();
    });
    this.searchInput.addEventListener('input', () => this.setSearch(this.searchInput.value));
    this.searchInput.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      this.hideSearch();
      if (!this.searchButton.hidden) this.searchButton.focus();
    });
    this.searchInput.addEventListener('blur', () => {
      if (this.query === '') this.hideSearch();
    });
    this.shareFormButton = button('database-toolbar-share-form', this.t('formShare'), { text: this.t('formShare') });
    this.shareFormButton.setAttribute('data-blok-database-toolbar-share-form', '');
    this.shareFormButton.addEventListener('click', () => this.host.shareForm?.(this.shareFormButton));
    // "Preview" reuses the file tool's word: the same in every locale.
    this.previewFormButton = iconButton('database-toolbar-preview-form', this.host.i18n.t('tools.file.preview'), IconPreview);
    this.previewFormButton.addEventListener('click', () => this.host.previewForm?.());
    this.toolbar.append(this.lockBadge, this.minimizeButton, this.noDateButton, this.filterButton, this.sortButton, this.automationsButton, this.autofillButton, this.searchButton, this.settingsButton, this.previewFormButton, this.shareFormButton);
    if (host.newRow !== undefined) {
      this.toolbar.append(this.newSplitButton(host.newRow, host.openNewMenu));
    }

    this.filterBar = document.createElement('div');
    this.filterBar.setAttribute('data-blok-database-filter-bar', '');
    this.refresh();
  }

  /** Notion's "New" split button (research/08): the main part adds a row, the chevron lists templates. */
  private newSplitButton(newRow: () => void, openMenu: ((anchor: HTMLElement) => void) | undefined): HTMLElement {
    const wrap = document.createElement('span');
    const main = button('database-toolbar-new', this.t('toolbarNew'), { text: this.t('toolbarNew') });
    const chevron = button('database-toolbar-new-menu', this.t('templateMenuLabel'), { icon: IconChevronDown });

    wrap.setAttribute('data-blok-database-new', '');
    main.addEventListener('click', () => newRow());
    chevron.addEventListener('click', () => openMenu?.(chevron));
    wrap.append(main, chevron);

    return wrap;
  }

  /** Fetches personal edits from the host store; without one they are read on demand. */
  load(viewIds: string[]): void {
    void this.personal.load(viewIds);
  }

  get search(): string {
    return this.query;
  }

  /** "Clear search" in an empty result: empties the query and keeps the search box open. */
  clearSearch(): void {
    this.searchInput.value = '';
    this.setSearch('');
    if (this.searchInput.isConnected) this.searchInput.focus();
  }

  /** The view as this person sees it. */
  effective(view: DatabaseViewConfig): DatabaseViewConfig {
    return this.personal.effective(view);
  }

  hasPersonalEdits(viewId: string): boolean {
    return this.personal.has(viewId);
  }

  hasPersonalSorts(viewId: string): boolean {
    return this.personal.get(viewId).sorts !== undefined;
  }

  /** Clears the sorts this person sees, leaving the saved view alone. */
  dropPersonalSorts(view: DatabaseViewConfig): void {
    const patch = { ...this.personal.get(view.id) };

    delete patch.sorts;
    this.personal.replace(view.id, view.sorts.length === 0 ? patch : { ...patch, sorts: [] });
    this.refresh();
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
    this.shareFormButton.hidden = this.host.shareForm === undefined || saved.type !== 'form' || this.host.locked();
    this.previewFormButton.hidden = this.host.previewForm === undefined || this.shareFormButton.hidden;
    this.filterButton.toggleAttribute('data-active', view.filters.length + countFilterRules(view.filterTree) > 0);
    this.sortButton.toggleAttribute('data-active', view.sorts.length > 0);
    // Notion keeps these back until a database has a property besides its title.
    const titleOnly = this.host.schema().length <= 1;

    this.filterButton.hidden = titleOnly;
    const noDate = this.host.noDate?.();

    this.noDateButton.hidden = noDate === undefined;
    this.noDateButton.textContent = noDate?.label ?? '';
    this.sortButton.hidden = titleOnly;
    this.automationsButton.hidden = titleOnly || this.host.automations === undefined;
    this.automationsButton.disabled = this.host.automations?.writable() !== true;
    this.autofillButton.hidden = titleOnly || this.host.autofill === undefined;
    this.autofillButton.disabled = this.host.autofill?.writable() !== true;
    this.searchButton.hidden = (titleOnly || this.host.rowCount() < SEARCH_MIN_ROWS) && this.query === '';
    this.renderFilterBar(view);
    this.panel?.refresh();
  }

  destroy(): void {
    this.panel?.close();
    this.panel = null;
    this.matchObserver?.disconnect();
    this.matchObserver = null;
    clearSearchMatches(this);
  }

  /** Filter from a column header: a new simple filter on that property, opened at once. */
  filterBy(propertyId: string, anchor: HTMLElement): void {
    const property = this.host.schema().find((p) => p.id === propertyId);
    const view = this.view();

    if (property === undefined || view === undefined) return;
    const filter = defaultFilterFor(property);

    this.barOpen = true;
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
        this.barOpen = true;
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
    const property = this.host.schema().find((p) => p.id === propertyId);

    this.host.updateView(property === undefined ? { groupBy: propertyId } : groupByChange(this.host.savedView(), property));
    this.openSettings(anchor, 'group');
  }

  /** A row menu's Layout or Property visibility: that page, under the settings button while it is on screen. */
  openSettingsPage(start: ViewSettingsStart, fallback: HTMLElement): void {
    this.openSettings(this.settingsButton.isConnected ? this.settingsButton : fallback, start);
  }

  openSettings(anchor: HTMLElement, start: ViewSettingsStart): void {
    this.panel?.close();
    this.panel = openViewSettings(anchor, this.settingsContext(), start, (escape) => this.panelClosed(anchor, escape));
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

    if (view === undefined || this.host.locked() || this.host.readOnly()) return;
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
      ...(this.host.linked !== undefined ? { linked: this.host.linked } : {}),
      duplicateView: () => this.host.duplicateView(),
      deleteView: () => this.host.deleteView(),
      copyViewLink: () => this.host.copyViewLink(),
      ...(this.host.manageInCalendar !== undefined ? { manageInCalendar: this.host.manageInCalendar } : {}),
      groups: (sub) => this.host.groups(sub),
      people: () => this.host.people?.() ?? [],
      ...(this.host.relatedRows !== undefined ? { relatedRows: this.host.relatedRows } : {}),
      ...(this.host.thisPageDatabase !== undefined ? { thisPageDatabase: this.host.thisPageDatabase } : {}),
      ...(this.host.layoutItems !== undefined ? { layoutItems: this.host.layoutItems } : {}),
      ...(this.host.actions !== undefined ? { actions: this.host.actions } : {}),
      ...(this.host.customizeLayout !== undefined ? { customizeLayout: this.host.customizeLayout } : {}),
      ...(this.host.automations !== undefined ? { automations: this.host.automations } : {}),
      ...(this.host.autofill !== undefined ? { autofill: this.host.autofill } : {}),
      ...(this.host.starterRow !== undefined ? { starterRow: this.host.starterRow } : {}),
      ...(this.host.dataSources !== undefined ? { dataSources: this.host.dataSources } : {}),
      ...(this.host.structure !== undefined ? { structure: this.host.structure } : {}),
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

  /** Escape hands focus back to the button that opened the panel (findings K03), as Add view does. */
  private panelClosed(anchor: HTMLElement, escape = false, opener: HTMLElement = anchor): void {
    anchor.removeAttribute('data-popover-open');
    this.panel = null;
    if (escape && opener.isConnected) opener.focus();
  }

  private openPill(filterId: string, anchor: HTMLElement): void {
    this.panel?.close();
    this.panel = openFilterChip(anchor, this.settingsContext(), filterId, () => this.panelClosed(anchor));
    anchor.setAttribute('data-popover-open', '');
  }

  /** Filter: hides a shown bar, shows a hidden one with chips, or with nothing to show picks a property. */
  private toggleFilterBar(): void {
    const view = this.view();

    if (view === undefined) return;
    if (this.barShown) {
      this.barOpen = false;
    } else if (view.sorts.length + view.filters.length + countFilterRules(view.filterTree) > 0 || this.personal.has(view.id)) {
      this.barOpen = true;
    } else {
      this.openFilterPicker(this.filterButton);

      return;
    }
    this.refresh();
  }

  /** "+ Filter": pick a property, then edit the new filter's value (research/21 §1c). */
  private openFilterPicker(anchor: HTMLElement): void {
    this.openPropertyPicker(anchor, 'database-filter-picker', FILTERABLE_TYPES, (property) => this.filterBy(property.id, anchor));
  }

  /**
   * Notion's property list: 290 wide, a search on top, the first option
   * highlighted, Name first and then A→Z, each with its type glyph.
   */
  private openPropertyPicker(anchor: HTMLElement, testId: string, types: readonly PropertyType[], onPick: (property: PropertyDefinition) => void): void {
    const state = { query: '', active: 0 };
    const list = document.createElement('div');
    const matches = (): PropertyDefinition[] => {
      const needle = state.query.trim().toLowerCase();
      const shown = this.host.schema()
        .filter((p) => types.includes(p.type))
        .filter((p) => needle === '' || p.name.toLowerCase().includes(needle));

      return [
        ...shown.filter((p) => p.type === 'title'),
        ...shown.filter((p) => p.type !== 'title').sort((a, b) => a.name.localeCompare(b.name)),
      ];
    };
    const pick = (property: PropertyDefinition): void => {
      panel.close();
      onPick(property);
    };
    const fill = (): void => {
      list.replaceChildren(...matches().map((property, index) => {
        const row = panelRow({
          label: property.name,
          icon: propertyTypeMeta(property.type).icon,
          testId: `database-pick-property-${property.id}`,
          onClick: () => pick(property),
        });

        row.toggleAttribute('data-active', index === state.active);

        return row;
      }));
    };
    const panel = new DatabasePanel({
      anchor,
      root: {
        build: () => {
          const search = panelInput({
            value: state.query,
            placeholder: this.t('layoutSearchProperties'),
            label: this.t('layoutSearchProperties'),
            testId: `${testId}-search`,
            // Only the list redraws, so the field keeps its caret.
            onInput: (value) => {
              state.query = value;
              state.active = 0;
              fill();
            },
          });

          search.addEventListener('keydown', (event) => {
            const shown = matches();

            if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
              event.preventDefault();
              if (shown.length === 0) return;
              state.active = (state.active + (event.key === 'ArrowDown' ? 1 : -1) + shown.length) % shown.length;
              fill();
            } else if (event.key === 'Enter' && !event.isComposing) {
              event.preventDefault();
              const property = shown[state.active];

              if (property !== undefined) pick(property);
            }
          });
          fill();

          return [search, list];
        },
      },
      testId,
      width: 290,
      backLabel: this.t('settingsBack'),
      onClose: (escape) => this.panelClosed(anchor, escape),
    });

    anchor.setAttribute('data-popover-open', '');
    this.showPanel(panel);
  }

  /** Sort: with no rule, the property picker; otherwise the sort panel under the chip. */
  private openSort(): void {
    const view = this.view();

    if (view === undefined) return;
    if (view.sorts.length === 0) {
      this.openPropertyPicker(this.sortButton, 'database-sort-picker', SORTABLE_TYPES, (property) => {
        this.barOpen = true;
        this.updatePersonal({ sorts: [{ id: nanoid(), propertyId: property.id, direction: 'asc' }] });
      });

      return;
    }
    const chip = this.filterBar.querySelector<HTMLElement>('[data-blok-testid="database-sort-pill"]');

    this.openSortPanel(chip !== null && chip.isConnected && !this.filterBar.hidden ? chip : this.sortButton, this.sortButton);
  }

  /**
   * Notion's sort panel (findings V19): no title, sized to its words. Each rule
   * has a drag handle, a property button and a direction button that open
   * lists, and a ×. Then "+ Add sort" and "Delete sort".
   */
  private openSortPanel(anchor: HTMLElement, opener: HTMLElement = anchor): void {
    const sorts = (): Array<SortConfig & { id: string }> => withEntryIds(this.view()?.sorts ?? []);
    const write = (next: SortConfig[]): void => this.updatePersonal({ sorts: next });
    const chevron = (row: HTMLElement): HTMLElement => {
      row.append(part('data-blok-database-chip-chevron', { icon: IconChevronDown }));

      return row;
    };
    const propertyPage = (title: string, onPick: (property: PropertyDefinition) => void): PanelPage => ({
      title,
      build: () => {
        const shown = this.host.schema().filter((p) => SORTABLE_TYPES.includes(p.type));

        return [...shown.filter((p) => p.type === 'title'), ...shown.filter((p) => p.type !== 'title').sort((a, b) => a.name.localeCompare(b.name))]
          .map((property) => panelRow({
            label: property.name,
            icon: propertyTypeMeta(property.type).icon,
            testId: `database-pick-property-${property.id}`,
            onClick: () => onPick(property),
          }));
      },
    });
    const directionPage = (sort: SortConfig & { id: string }, property: PropertyDefinition): PanelPage => ({
      title: property.name,
      build: (panel) => (['asc', 'desc'] as const).map((direction) => panelRow({
        label: this.host.i18n.t(sortDirectionLabelKey(property.type, direction)),
        testId: `database-sort-direction-${direction}`,
        checked: sort.direction === direction,
        onClick: () => {
          write(sorts().map((s) => (s.id === sort.id ? { ...s, direction } : s)));
          panel.back();
        },
      })),
    });
    const panel = new DatabasePanel({
      anchor,
      root: {
        build: (current) => {
          const schema = this.host.schema();
          const all = sorts();
          const items = all.flatMap((sort) => {
            const property = schema.find((p) => p.id === sort.propertyId);

            if (property === undefined) return [];
            const line = document.createElement('div');
            const remove = panelRow({
              label: this.t('sortRemove'),
              testId: `database-sort-remove-${sort.id}`,
              icon: IconCross,
              onClick: () => write(all.filter((s) => s.id !== sort.id)),
            });

            remove.querySelector('[data-blok-database-panel-label]')?.remove();
            remove.setAttribute('aria-label', this.t('sortRemove'));
            remove.setAttribute('data-blok-database-sort-remove', '');
            line.setAttribute('data-blok-database-sort-row', '');
            line.setAttribute('data-blok-testid', `database-sort-row-${sort.id}`);
            line.append(
              chevron(panelRow({
                label: property.name,
                testId: `database-sort-property-${sort.id}`,
                icon: propertyTypeMeta(property.type).icon,
                onClick: () => current.push(propertyPage(this.t('settingsSort'), (picked) => {
                  write(sorts().map((s) => (s.id === sort.id ? { ...s, propertyId: picked.id } : s)));
                  current.back();
                })),
              })),
              chevron(panelRow({
                label: this.host.i18n.t(sortDirectionLabelKey(property.type, sort.direction)),
                testId: `database-sort-direction-${sort.id}`,
                onClick: () => current.push(directionPage(sort, property)),
              })),
              remove
            );

            return [{ id: sort.id, element: line }];
          });

          return [
            panelReorderList({
              testId: 'database-sorts-list',
              handleLabel: this.t('settingsDragToReorder'),
              items,
              onMove: (id, beforeId) => {
                const moving = all.find((s) => s.id === id);
                const rest = all.filter((s) => s.id !== id);
                const at = beforeId === null ? rest.length : rest.findIndex((s) => s.id === beforeId);

                if (moving !== undefined) write([...rest.slice(0, at), moving, ...rest.slice(at)]);
              },
            }),
            panelRow({
              label: this.t('sortAdd'),
              testId: 'database-sort-add',
              muted: true,
              icon: IconPlus,
              onClick: () => current.push(propertyPage(this.t('sortAdd'), (property) => {
                write([...sorts(), { id: nanoid(), propertyId: property.id, direction: 'asc' }]);
                current.back();
              })),
            }),
            panelRow({
              label: this.t('sortDeleteAll'),
              testId: 'database-sort-delete-all',
              muted: true,
              icon: IconTrash,
              onClick: () => {
                write([]);
                current.close();
              },
            }),
          ];
        },
      },
      testId: 'database-sort-panel',
      width: 290,
      backLabel: this.t('settingsBack'),
      onClose: (escape) => this.panelClosed(anchor, escape, opener),
    });

    // Notion's panel sizes to its words, so no label is cut.
    panel.root.style.width = 'max-content';
    anchor.setAttribute('data-popover-open', '');
    this.showPanel(panel);
  }

  private showSearch(): void {
    if (this.searchInput.isConnected) {
      this.searchInput.focus();

      return;
    }
    this.searchInput.hidden = false;
    this.searchButton.after(this.searchInput, this.searchClear);
    this.searchInput.focus();
  }

  private hideSearch(): void {
    this.searchInput.hidden = true;
    this.searchInput.remove();
    this.searchClear.remove();
    this.searchInput.value = '';
    this.setSearch('');
    this.searchButton.hidden = this.host.rowCount() < SEARCH_MIN_ROWS;
  }

  private setSearch(query: string): void {
    this.searchClear.hidden = query === '';
    if (query === this.query) return;
    this.query = query;
    this.host.rerender();
    this.paintMatches();
  }

  /** The database's own wrapper: the rows sit beside the chip bar. */
  private viewRoot(): HTMLElement | null {
    return this.filterBar.parentElement;
  }

  private paintMatches(): void {
    const root = this.viewRoot();

    this.matchObserver?.disconnect();
    this.matchObserver = null;
    if (this.query.trim() === '' || root === null) {
      clearSearchMatches(this);

      return;
    }
    paintSearchMatches(this, root, this.query);
    if (typeof MutationObserver === 'undefined') return;
    this.matchObserver = new MutationObserver(() => paintSearchMatches(this, root, this.query));
    this.matchObserver.observe(root, { childList: true, subtree: true, characterData: true });
  }

  private renderFilterBar(view: DatabaseViewConfig): void {
    const schema = this.host.schema();
    const t = (key: string, vars?: Record<string, string | number>): string => this.host.i18n.t(key, vars);
    const pills: HTMLElement[] = [];

    if (view.sorts.length > 0) {
      const first = schema.find((p) => p.id === view.sorts[0].propertyId);
      const name = view.sorts.length === 1 && first !== undefined ? first.name : this.t('sortCount', { count: view.sorts.length });
      const label = view.sorts.length === 1 && first !== undefined
        ? `${first.name}: ${t(sortDirectionLabelKey(first.type, view.sorts[0].direction))}`
        : name;
      const pill = chip('database-sort-pill', label, { glyph: view.sorts.length === 1 ? IconArrowUp : IconSort, name });

      pill.setAttribute('data-direction', view.sorts[0].direction);
      pill.setAttribute('data-active', '');
      pill.addEventListener('click', () => this.openSortPanel(pill));
      pills.push(pill, part('data-blok-database-chip-divider', {}));
    }
    for (const filter of withEntryIds(view.filters)) {
      const property = schema.find((p) => p.id === filter.propertyId);

      if (property === undefined) continue;
      const personName = (id: string): string | undefined => this.host.people?.().find((person) => person.id === id)?.name;
      const rowTitle = (id: string): string | undefined => this.host.relatedRows?.(property).find((row) => row.id === id)?.title;
      const label = filterPillLabel(filter, property, t, personName, rowTitle);
      const value = filterValueText(filter, property, t, personName, rowTitle);
      const pill = chip(`database-filter-pill-${filter.id}`, label, { glyph: propertyTypeMeta(property.type).icon, name: property.name, value });

      pill.setAttribute('data-filter-id', filter.id);
      pill.toggleAttribute('data-active', value !== '');
      pill.addEventListener('click', () => this.openPill(filter.id, pill));
      pills.push(pill);
    }
    const rules = countFilterRules(view.filterTree);

    if (rules > 0) {
      const label = this.t('filterRuleCount', { count: rules });
      const pill = chip('database-advanced-pill', label, { glyph: IconFilter, name: label });

      pill.setAttribute('data-active', '');
      pill.addEventListener('click', () => this.openSettings(pill, 'filter'));
      pills.push(pill);
    }

    const personal = this.personal.has(view.id);

    if (this.barViewId !== view.id) {
      this.barViewId = view.id;
      this.barOpen = null;
      this.barShown = false;
    }
    // Notion keeps the bar, with only "+ Filter", after its last chip goes.
    if (pills.length === 0 && !personal && this.barShown && this.barOpen === null) this.barOpen = true;
    this.barShown = this.barOpen ?? (pills.length > 0 || personal);
    // Inferred from shots: Notion shows » with a sort (20, 22, 23), not with filters alone (15, 17) or no rule (41).
    this.minimizeButton.hidden = !this.barShown || view.sorts.length === 0;
    if (!this.barShown) {
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
