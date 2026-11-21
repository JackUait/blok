import type { PopoverItemParams } from '@/types/utils/popover/popover-item';
import { nanoid } from 'nanoid';
import { IconSearch, IconSliders, IconLock, IconLockOpen, IconPencilLine, IconPlus, IconChevronDown, IconFilter, IconSort, IconPreview, IconBolt, IconWand, IconArrowUp, IconCross, IconChevronDoubleRight, IconPageLayout, IconExpandDiagonal } from '../../components/icons';
import { openDatabaseConfirm } from './database-confirm-dialog';
import { DATA_ATTR } from '../../components/constants/data-attributes';
import { propertyGlyph } from './database-property-types';
import type { I18n } from '../../../types';
import type { History, HistoryValue, HistoryValueChange } from '../../../types/api/history';
import { DatabasePanel, historyKeyStaysInPanel, panelRow } from './database-panel';
import { isHistoryKey } from './database-keyboard';
import { PersonalViewEdits } from './database-view-state';
import type { ViewStateFallback } from './database-view-state';
import { editorLocale } from './cells/date-format';
import { FILTERABLE_TYPES, defaultFilterFor, filterPillLabel, filterPillParts, sortDirectionLabelKey } from './database-filter-labels';
import { addFilterRule, countFilterRules, emptyFilterTree, withEntryIds } from './filter-tree';
import { openAdvancedFilter, openViewSettings } from './database-view-settings-panel';
import { chipPart, filterChip, openFilterChip } from './database-filter-chip';
import { SORTABLE_TYPES, propertyPicker, sortEditor } from './database-sort-panel';
import { clearSearchMatches, paintSearchMatches } from './database-search-highlight';
import { offHover, onHover } from '../../components/utils/tooltip';
import { openMenu } from './database-table-menus';
import type { PopoverDesktop } from '../../components/utils/popover';
import type { AutofillPanelSettings, DataSourceSettings, EditPropertiesSettings, PersonalWriteOptions, StarterRow, StructureSettings, ViewGroupEntry, ViewSettingsAction, ViewSettingsContext, ViewSettingsStart } from './database-view-settings-panel';
import { sortFromHeader } from './view-data';
import type { ViewChanges } from './database-model';
import { groupByChange } from './group-keys';
import type { AutomationSettings } from './database-automations-panel';
import type { NoDateControl } from './database-no-date';
import type {
  DatabaseViewConfig,
  DatabaseViewStateStore,
  PersonalViewPatch,
  PropertyDefinition,
  PropertyType,
  SortConfig,
  ViewType,
} from './types';

const SORT_PANEL_GAP = 4;
/** notion-motion.md Round 46 §C.5 and Round 47 §D: the filter and sort pickers open 4 under their toolbar button or the "+ Filter" chip. */
const TOOLBAR_PICKER_GAP = 4;

/** What the controls ask of the database tool. */
export interface ViewControlsHost {
  /** `getLocale` dates the filter chips in the editor's language. */
  i18n: Pick<I18n, 't'> & Partial<Pick<I18n, 'getLocale'>>;
  store?: DatabaseViewStateStore;
  fallback: ViewStateFallback;
  savedView: () => DatabaseViewConfig | undefined;
  /** Localized schema. */
  schema: () => PropertyDefinition[];
  /** A property's saved type: `schema` shows a formula or rollup as its result type. */
  storedType?: (propertyId: string) => PropertyType | undefined;
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
  /** On a row page, the name of the database whose pages share this view; else null. */
  rowPageDatabaseName?: () => string | null;
  /** A shared write to the active view. The tool refuses it while locked. */
  updateView: (changes: ViewChanges) => void;
  /** The editor's undo history; undefined while read-only. */
  history?: () => Pick<History, 'track'> | undefined;
  setLayout: (type: ViewType) => void;
  setLocked: (locked: boolean) => void;
  /** The "Locked" button's unlocks. Without it the button offers no menu. */
  lock?: LockLevers;
  /** A linked view: its lock reads "Lock views". */
  linked?: () => boolean;
  /** The block's "Show data source titles" (Layout page). */
  dataSourceTitles?: { shown: () => boolean; toggle: () => void };
  duplicateView: () => void;
  deleteView: () => void;
  copyViewLink: () => void;
  /** A calendar or timeline's "No date (N)", or a map's "No place (N)": undefined hides it. */
  noDate?: () => NoDateControl | undefined;
  /** "Manage in Calendar": only when the host gave `config.calendar`. */
  manageInCalendar?: { label: string; onClick: () => void };
  groups: (sub: boolean) => ViewGroupEntry[];
  /** Moves a group from View settings › Group, as a board column drop does. */
  moveGroup?: ViewSettingsContext['moveGroup'];
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
  /** View settings "Edit properties": each editor opens under `anchor`, the control that opened the panel. */
  editProperties?: Omit<EditPropertiesSettings, 'edit' | 'add'> & {
    edit: (propertyId: string, anchor: HTMLElement) => void;
    add: (anchor: HTMLElement) => void;
  };
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
  /** ⤢ "Open as full page": undefined hides it. */
  openFullPage?: () => (() => void) | undefined;
}

/** "Unlock for me" lifts the saved lock for this viewer only; it is never saved. */
export interface LockLevers {
  unlockedForMe: () => boolean;
  setUnlockedForMe: (on: boolean) => void;
  /** False: the button only says it is locked. */
  canUnlock: () => boolean;
}

/**
 * The sorts and filters each undo token stands for. Module-wide, so a token
 * still replays after the controls that wrote it were rebuilt.
 */
const sortSteps = new Map<string, { viewId: string; personal: PersonalViewPatch }>();

/** Names this block's sort tokens in the document. Per browser: a peer must not share the key. */
const SORT_UNDO_ID_KEY = 'sort-undo-id';

/**
 * notion-motion.md Round 67 §5: typed filter text saves once keys pause (Notion: ~165–255 ms),
 * so keys 160 ms apart save once.
 */
const TYPING_SAVE_IDLE_MS = 200;

/**
 * notion-motion.md Round 67 §5: one undo step takes every save less than ~700 ms after its
 * first save (675 ms joined, 700 and 725 ms did not). The step is not timed from the first key.
 */
const TYPING_STEP_WINDOW_MS = 700;

/** The controls now drawn for each key: a rebuilt tool replays steps the old one wrote. A block's widgets share its key. */
const liveSortControls = new Map<string, Set<DatabaseViewControls>>();

/** Personal state compared as the store keeps it: an absent key and an undefined one are the same. */
const samePersonal = (a: PersonalViewPatch, b: PersonalViewPatch): boolean =>
  JSON.stringify([a.sorts, a.filters, a.filterTree]) === JSON.stringify([b.sorts, b.filters, b.filterTree]);

const button = (testId: string, label: string, content: { icon?: string; text?: string }): HTMLButtonElement => {
  const el = document.createElement('button');

  el.type = 'button';
  el.setAttribute('data-blok-testid', testId);
  el.setAttribute('aria-label', label);
  if (content.icon !== undefined) el.innerHTML = content.icon;
  if (content.text !== undefined) el.append(content.text);

  return el;
};

/** Notion's controls fade back in over 200ms when « expands the toolbar; a little longer so the fade ends first. */
const EXPAND_FADE_MS = 250;

/** Longer than the 200ms shrink, so transitionend normally wins. */
const SEARCH_CLOSE_FALLBACK_MS = 250;

const hasTransition = (el: HTMLElement): boolean =>
  getComputedStyle(el).transitionDuration.split(',').some((part) => parseFloat(part) > 0);

/** notion-motion.md Round 86 §1 #7 (r86-n-tip-sort.raw): a toolbar hint sits above its button, 6 clear. */
const TOOLBAR_HINT = { placement: 'top', gap: 6 } as const;

/** A 28px toolbar button that holds only an icon; its aria-label names it, and so does its hover hint. */
const iconButton = (testId: string, label: string, icon: string): HTMLButtonElement => {
  const el = button(testId, label, { icon });

  el.setAttribute('data-blok-database-toolbar-icon', '');
  onHover(el, label, TOOLBAR_HINT);

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
  private noDateAttributes: Readonly<Record<string, string>> = {};
  private readonly minimizeButton: HTMLButtonElement;
  /** « Expand: shown in place of » while the view's toolbar is minimized. */
  private readonly expandButton: HTMLButtonElement;
  /** The saved view keeps its toolbar minimized. */
  private minimized = false;
  private expandTimer: ReturnType<typeof setTimeout> | null = null;
  /** The filter bar shows a sort, so » can fold it. */
  private barMinimizable = false;
  private searchCloseTimer: ReturnType<typeof setTimeout> | null = null;
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
  /** Notion's ⤢ is a link (notion-motion.md Round 15 B), with no href: it opens in place. */
  private readonly fullPageLink: HTMLAnchorElement;
  /** notion-motion.md Round 68 §1: "Locked" with its unlock menu, or "Re-lock" once unlocked for this viewer. */
  private readonly lockBadge: HTMLButtonElement;
  private readonly lockText: HTMLElement;
  private lockMenu: PopoverDesktop | null = null;
  private readonly shareFormButton: HTMLButtonElement;
  private readonly previewFormButton: HTMLButtonElement;
  private newSplit: HTMLElement | null = null;
  private panel: DatabasePanel | null = null;
  private query = '';
  /** Repaints the match tint when the rows redraw after a search (lazy rows, remote edits). */
  private matchObserver: MutationObserver | null = null;
  private sortHistory: { key: string; value: HistoryValue<string> } | null = null;
  /** An undo or redo is writing the sorts: that write is not a new step. */
  private replayingSorts = false;
  private undoId: string | null = null;
  /**
   * Typed filter text not yet an undo step. `saved` is what the last idle save took;
   * `stepTimer` runs from the first save of the open step.
   */
  private typingRun: {
    viewId: string;
    before: PersonalViewPatch;
    saved: PersonalViewPatch;
    after: PersonalViewPatch;
    saveTimer: ReturnType<typeof setTimeout> | null;
    stepTimer: ReturnType<typeof setTimeout> | null;
  } | null = null;
  private destroyed = false;

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
    // The fold probes write here on every resize (database-view-bar-fold.ts); they are not edits.
    this.toolbar.setAttribute(DATA_ATTR.mutationFree, 'true');
    // A focused button's Enter is its click; Blok's Enter would insert a block instead.
    this.toolbar.setAttribute(DATA_ATTR.keyboardOwner, '');

    this.lockBadge = document.createElement('button');
    this.lockBadge.type = 'button';
    this.lockBadge.setAttribute('data-blok-database-lock-badge', '');
    this.lockBadge.setAttribute('data-blok-testid', 'database-toolbar-locked');
    this.lockText = document.createElement('span');
    this.lockBadge.addEventListener('click', () => this.lockClicked());

    this.filterButton = iconButton('database-toolbar-filter', this.t('settingsFilter'), IconFilter);
    this.noDateButton = button('database-toolbar-no-date', '', {});
    this.noDateButton.setAttribute('data-blok-database-no-date-button', '');
    this.noDateButton.removeAttribute('aria-label');
    this.noDateButton.addEventListener('click', () => this.host.noDate?.()?.open(this.noDateButton));
    this.minimizeButton = iconButton('database-toolbar-minimize', this.t('filterBarMinimize'), IconChevronDoubleRight);
    this.minimizeButton.setAttribute('data-blok-database-toolbar-minimize', '');
    this.sortButton = iconButton('database-toolbar-sort', this.t('settingsSort'), IconSort);
    this.automationsButton = iconButton('database-toolbar-automations', this.t('automationTitle'), IconBolt);
    this.autofillButton = iconButton('database-toolbar-autofill', this.t('aiAutofill'), IconWand);
    this.searchButton = iconButton('database-toolbar-search', this.t('searchLabel'), IconSearch);
    this.searchButton.setAttribute('data-blok-database-toolbar-search', '');
    this.settingsButton = iconButton('database-toolbar-settings', this.t('settingsTitle'), IconSliders);
    this.settingsButton.setAttribute('data-blok-database-toolbar-settings', '');
    this.fullPageLink = this.createFullPageLink();
    // A narrow view bar hides these together (notion-spec-2 §26.1, database-tab-bar.ts).
    for (const icon of [this.filterButton, this.sortButton, this.automationsButton, this.autofillButton, this.searchButton]) {
      icon.setAttribute('data-blok-database-toolbar-foldable', '');
    }
    for (const icon of [this.filterButton, this.sortButton, this.automationsButton]) {
      icon.setAttribute('data-blok-database-toolbar-selection-hides', '');
    }
    this.searchInput = document.createElement('input');
    this.searchInput.type = 'search';
    this.searchInput.hidden = true;
    this.searchInput.placeholder = this.t('searchPlaceholder');
    this.searchInput.setAttribute('aria-label', this.t('searchLabel'));
    this.searchInput.setAttribute('data-blok-database-search-input', '');
    this.searchInput.setAttribute('data-blok-testid', 'database-search-input');

    this.filterButton.addEventListener('click', () => this.toggleFilterBar());
    this.minimizeButton.addEventListener('pointerdown', (event) => {
      if (this.searchShown()) event.preventDefault();
    });
    this.minimizeButton.addEventListener('click', () => {
      if (this.searchShown()) this.hideSearch();
      this.barOpen = false;
      this.host.updateView({ toolbarMinimized: true });
      this.refresh();
      this.settingsButton.focus();
    });
    this.expandButton = iconButton('database-toolbar-expand', this.host.i18n.t('tools.toggle.ariaLabelExpand'), IconChevronDoubleRight);
    this.expandButton.setAttribute('data-blok-database-toolbar-expand', '');
    this.expandButton.hidden = true;
    this.expandButton.addEventListener('click', () => {
      // The controls fade in once; a later show of one of them stays instant.
      // Marked first: the host's redraw lays out, and the fade only starts if the mark is on then.
      this.toolbar.setAttribute('data-expanding', '');
      this.host.updateView({ toolbarMinimized: false });
      this.refresh();
      if (this.expandTimer !== null) clearTimeout(this.expandTimer);
      this.expandTimer = setTimeout(() => {
        this.expandTimer = null;
        this.toolbar.removeAttribute('data-expanding');
      }, EXPAND_FADE_MS);
      this.settingsButton.focus();
    });
    this.sortButton.addEventListener('click', () => this.openSort());
    this.automationsButton.addEventListener('click', () => this.openSettings(this.automationsButton, 'automations'));
    this.autofillButton.addEventListener('click', () => this.openSettings(this.autofillButton, 'autofill'));
    // notion-motion.md Round 95 §1 #6: the Settings button lands on Close, as tab menu › Edit view does.
    this.settingsButton.addEventListener('click', () => this.openSettings(this.settingsButton, 'edit'));
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
    const previewLabel = this.host.i18n.t('tools.file.preview');

    this.previewFormButton = button('database-toolbar-preview-form', previewLabel, { icon: IconPreview, text: previewLabel });
    this.previewFormButton.setAttribute('data-blok-database-toolbar-preview-form', '');
    this.previewFormButton.addEventListener('click', () => this.host.previewForm?.());
    // notion-motion.md Round 68 §1 (r68-n-unlockforme.raw): Minimize, then Re-lock, then Filter.
    this.toolbar.append(this.minimizeButton, this.noDateButton, this.lockBadge, this.filterButton, this.sortButton, this.automationsButton, this.autofillButton, this.searchButton, this.expandButton, this.fullPageLink, this.settingsButton, this.previewFormButton, this.shareFormButton);
    if (host.newRow !== undefined) {
      this.newSplit = this.newSplitButton(host.newRow, host.openNewMenu);
      this.toolbar.append(this.newSplit);
    }

    this.filterBar = document.createElement('div');
    this.filterBar.setAttribute('data-blok-database-filter-bar', '');
    this.filterBar.setAttribute(DATA_ATTR.keyboardOwner, '');
    this.refresh();
  }

  private createFullPageLink(): HTMLAnchorElement {
    const link = document.createElement('a');
    const label = this.host.i18n.t('tools.database.peekExpand');
    const open = (): void => this.host.openFullPage?.()?.();

    link.setAttribute('role', 'link');
    link.tabIndex = 0;
    link.setAttribute('data-blok-testid', 'database-toolbar-full-page');
    link.setAttribute('data-blok-database-toolbar-icon', '');
    link.setAttribute('data-blok-database-toolbar-full-page', '');
    link.setAttribute('aria-label', label);
    link.innerHTML = IconExpandDiagonal;
    onHover(link, label, TOOLBAR_HINT);
    link.addEventListener('click', (event) => {
      event.preventDefault();
      open();
    });
    link.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter') return;
      event.preventDefault();
      open();
    });

    return link;
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
    this.sortValue();
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
    this.writePersonal(view.id, view.sorts.length === 0 ? patch : { ...patch, sorts: [] });
    this.refresh();
  }

  private syncLock(): void {
    const relock = !this.host.locked() && this.host.lock?.unlockedForMe() === true;
    const unlocks = this.unlockItems();

    this.lockBadge.hidden = !this.host.locked() && !relock;
    this.lockBadge.toggleAttribute('data-blok-database-relock', relock);
    this.lockBadge.innerHTML = relock ? IconLockOpen : IconLock;
    this.lockText.textContent = this.t(relock ? 'relockButton' : 'lockedButton');
    this.lockBadge.append(this.lockText);
    if (relock || unlocks.length === 0) {
      this.lockBadge.removeAttribute('aria-haspopup');
    } else {
      this.lockBadge.setAttribute('aria-haspopup', 'menu');
    }
    // Notion's hint names who locked it; Blok keeps no lock owner, so it names no one. Re-lock's hint is unmeasured.
    if (relock) {
      offHover(this.lockBadge);
    } else {
      onHover(this.lockBadge, unlocks.length === 0 ? this.t('lockedLabel') : this.lockHint(), { placement: 'top', gap: 6 });
    }
  }

  /** Two lines in the tooltip's own ink: Notion's per-line inks are unmeasured. */
  private lockHint(): HTMLElement {
    const hint = document.createElement('div');

    for (const key of ['lockedHint', 'lockedHintAction']) {
      const line = document.createElement('div');

      line.textContent = this.t(key);
      hint.append(line);
    }

    return hint;
  }

  private unlockItems(): PopoverItemParams[] {
    const lock = this.host.lock;

    if (lock?.canUnlock() !== true) return [];

    return [{
      name: 'database-unlock-for-me',
      title: this.t('unlockForMe'),
      icon: IconPencilLine,
      closeOnActivate: true,
      onActivate: () => {
        lock.setUnlockedForMe(true);
        this.refresh();
      },
    }, {
      name: 'database-unlock-for-everyone',
      title: this.t('unlockForEveryone'),
      icon: IconLockOpen,
      closeOnActivate: true,
      onActivate: () => {
        this.host.setLocked(false);
        this.refresh();
      },
    }];
  }

  private lockClicked(): void {
    if (!this.host.locked()) {
      this.host.lock?.setUnlockedForMe(false);
      this.refresh();

      return;
    }
    const items = this.unlockItems();

    if (items.length === 0) return;
    if (this.lockMenu !== null) {
      this.lockMenu.hide();

      return;
    }
    // notion-motion.md Round 68 §1: 181.5 wide under the button, no gap; the first row is filled on open.
    const menu = openMenu(this.lockBadge, items, { kind: 'lock', offset: 0, minWidth: '0px', onClose: () => {
      this.lockMenu = null;
    } });

    this.lockMenu = menu;
    menu.focusItemByName('database-unlock-for-me');
    // notion-motion.md Round 70 §2: Notion moves focus into the menu.
    menu.getElement().querySelector<HTMLElement>('[role="menu"]')?.focus({ preventScroll: true });
  }

  /** Shows ⤢ only where it can open. Touches the toolbar alone: a filter bar redraw is a block change. */
  syncFullPage(): void {
    this.fullPageLink.hidden = this.host.openFullPage?.() === undefined;
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

    this.syncLock();
    this.syncFullPage();
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
    this.syncNoDateAttributes(noDate?.attributes ?? {});
    // notion-motion.md Round 52 §2: Notion's Map toolbar has no Sort.
    this.sortButton.hidden = titleOnly || saved.type === 'map';
    this.automationsButton.hidden = titleOnly || this.host.automations === undefined;
    this.automationsButton.disabled = this.host.automations?.writable() !== true;
    this.autofillButton.hidden = titleOnly || this.host.autofill === undefined;
    this.autofillButton.disabled = this.host.autofill?.writable() !== true;
    // notion-motion.md Round 41 Part B: 🔍 shows on a 0-row board; the help center's "three pages" is not the rule.
    this.searchButton.hidden = titleOnly && this.query === '';
    this.minimized = this.host.savedView()?.toolbarMinimized === true;
    this.toolbar.toggleAttribute('data-minimized', this.minimized);
    this.expandButton.hidden = !this.minimized;
    if (this.newSplit !== null) this.newSplit.hidden = false;
    if (saved.type === 'dashboard') {
      this.trimForDashboard();
      this.panel?.refresh();

      return;
    }
    if (saved.type === 'form') {
      this.trimForForm();
      this.panel?.refresh();

      return;
    }
    this.renderFilterBar(view);
    this.panel?.refresh();
  }

  /** Swaps the attributes the last control put on the "No date" button for this one's. */
  private syncNoDateAttributes(next: Readonly<Record<string, string>>): void {
    for (const name of Object.keys(this.noDateAttributes)) this.noDateButton.removeAttribute(name);
    for (const [name, value] of Object.entries(next)) this.noDateButton.setAttribute(name, value);
    this.noDateAttributes = next;
  }

  /** notion-motion Round 15 A: a dashboard's toolbar is only ⤢ and ⚙. Its widgets filter themselves. */
  private trimForDashboard(): void {
    const rowControls = [this.filterButton, this.sortButton, this.automationsButton, this.autofillButton, this.searchButton,
      this.noDateButton, this.minimizeButton, this.expandButton, this.newSplit];

    for (const control of rowControls) {
      if (control !== null) control.hidden = true;
    }
    this.toolbar.removeAttribute('data-minimized');
    this.filterBar.hidden = true;
    this.filterBar.replaceChildren();
  }

  /** notion-motion.md Round 31 §1, Round 32 §4: a form takes answers, so it has no Filter, Sort, Search or New. */
  private trimForForm(): void {
    for (const control of [this.filterButton, this.sortButton, this.searchButton, this.newSplit]) {
      if (control !== null) control.hidden = true;
    }
    this.filterBar.hidden = true;
    this.filterBar.replaceChildren();
    // notion-motion.md Round 41 Part B: a form has no filter bar, so » has nothing to fold.
    this.barMinimizable = false;
    this.syncMinimize();
  }

  destroy(): void {
    this.endTypingRun();
    this.destroyed = true;
    if (this.sortHistory !== null) liveSortControls.get(this.sortHistory.key)?.delete(this);
    this.endSearchClose();
    if (this.expandTimer !== null) clearTimeout(this.expandTimer);
    this.expandTimer = null;
    this.panel?.close();
    this.panel = null;
    this.lockMenu?.hide();
    this.lockMenu = null;
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

  /** Group from a column header: only groups, no settings page (notion-motion.md Round 93 §1 #1). */
  groupBy(propertyId: string): void {
    const property = this.host.schema().find((p) => p.id === propertyId);

    this.host.updateView(property === undefined ? { groupBy: propertyId } : groupByChange(this.host.savedView(), property));
  }

  /** A row menu's Layout or Property visibility: that page, under the settings button while it is on screen. */
  openSettingsPage(start: ViewSettingsStart, fallback: HTMLElement): void {
    this.openSettings(this.settingsButton.isConnected ? this.settingsButton : fallback, start);
  }

  openSettings(anchor: HTMLElement, start: ViewSettingsStart): void {
    this.panel?.close();
    this.panel = openViewSettings(anchor, this.settingsContext(anchor), start, (escape) => this.panelClosed(anchor, escape));
    anchor.setAttribute('data-popover-open', '');
  }

  private t(key: string, vars?: Record<string, string | number>): string {
    return this.host.i18n.t(`tools.database.${key}`, vars);
  }

  private view(): DatabaseViewConfig | undefined {
    const saved = this.host.savedView();

    return saved === undefined ? undefined : this.effective(saved);
  }

  private updatePersonal(patch: PersonalViewPatch, options: PersonalWriteOptions = {}): void {
    const view = this.host.savedView();

    if (view === undefined) return;
    this.writePersonal(view.id, {
      ...this.personal.get(view.id),
      ...patch,
      ...(patch.filters !== undefined ? { filters: withEntryIds(patch.filters) } : {}),
      ...(patch.sorts !== undefined ? { sorts: withEntryIds(patch.sorts) } : {}),
    }, options);
    this.host.rerender();
    this.refresh();
  }

  /** Every personal write goes here, so a sort or filter change is always an undo step. */
  private writePersonal(viewId: string, next: PersonalViewPatch, options: PersonalWriteOptions = {}): void {
    const before = this.personal.get(viewId);

    this.personal.replace(viewId, next);
    if (this.replayingSorts) return;
    const run = this.typingRun;

    if (options.typing === true && run?.viewId === viewId) {
      run.after = next;
      this.scheduleTypingSave();

      return;
    }
    this.endTypingRun();
    if (samePersonal(before, next)) return;
    if (options.typing !== true) {
      this.recordSorts(viewId, before, next);

      return;
    }
    this.typingRun = { viewId, before, saved: before, after: next, saveTimer: null, stepTimer: null };
    this.scheduleTypingSave();
    window.addEventListener('keydown', this.endTypingRunOnHistoryKey, true);
  }

  private scheduleTypingSave(): void {
    const run = this.typingRun;

    if (run === null) return;
    if (run.saveTimer !== null) clearTimeout(run.saveTimer);
    run.saveTimer = setTimeout(() => {
      run.saveTimer = null;
      run.saved = run.after;
      run.stepTimer ??= setTimeout(() => this.closeTypingStep(), TYPING_STEP_WINDOW_MS);
    }, TYPING_SAVE_IDLE_MS);
  }

  /** The open step's window ends: its saves become one step, and a save still waiting starts the next. */
  private closeTypingStep(): void {
    const run = this.typingRun;

    if (run === null) return;
    run.stepTimer = null;
    if (run.saveTimer === null) {
      this.endTypingRun();

      return;
    }
    if (!samePersonal(run.before, run.saved)) this.recordSorts(run.viewId, run.before, run.saved);
    run.before = run.saved;
  }

  get typingRunOpen(): boolean {
    return this.typingRun !== null;
  }

  /** The open typing run becomes its step. An undo or redo calls it first, so the walk takes the typed text. */
  endTypingRun(): void {
    const run = this.typingRun;

    if (run === null) return;
    this.typingRun = null;
    if (run.saveTimer !== null) clearTimeout(run.saveTimer);
    if (run.stepTimer !== null) clearTimeout(run.stepTimer);
    window.removeEventListener('keydown', this.endTypingRunOnHistoryKey, true);
    if (!samePersonal(run.before, run.after)) this.recordSorts(run.viewId, run.before, run.after);
  }

  /**
   * Window capture: before the editor's own undo key handler on the document.
   * A key the open popover ignores keeps the run (notion-motion.md Round 66 §3).
   */
  private readonly endTypingRunOnHistoryKey = (event: KeyboardEvent): void => {
    if (isHistoryKey(event) && !historyKeyStaysInPanel(event.target)) this.endTypingRun();
  };

  /**
   * notion-motion.md Round 63 §1: a sort change is one undo step; Round 64 §2: a filter's
   * add and its value are one step each. Both are personal (D4), so the document holds
   * only a token and this browser keeps what it stands for.
   */
  private recordSorts(viewId: string, before: PersonalViewPatch, after: PersonalViewPatch): void {
    const value = this.sortValue();

    if (value === undefined) return;
    const current = value.get();
    const known = current === undefined ? undefined : sortSteps.get(current);

    // Undo needs a token for the state before this step. A host store load changes it without one.
    if (known === undefined || known.viewId !== viewId || !samePersonal(known.personal, before)) {
      const base = nanoid();

      sortSteps.set(base, { viewId, personal: before });
      value.set(base, { record: false });
    }
    const token = nanoid();

    sortSteps.set(token, { viewId, personal: after });
    value.set(token);
  }

  /** One key per block: each token names its view. */
  private sortValue(): HistoryValue<string> | undefined {
    if (this.sortHistory !== null) return this.sortHistory.value;
    const history = this.host.history?.();

    if (history === undefined) return undefined;
    const key = `database-sorts:${this.sortUndoId()}`;
    const value = history.track<string>(key, (token, change) => liveSortControls.get(key)?.forEach((controls) => controls.replaySorts(token, change)));
    const live = liveSortControls.get(key) ?? new Set<DatabaseViewControls>();

    live.add(this);
    liveSortControls.set(key, live);
    this.sortHistory = { key, value };

    return value;
  }

  private sortUndoId(): string {
    if (this.undoId !== null) return this.undoId;
    const stored = this.readFallback(SORT_UNDO_ID_KEY);

    if (typeof stored === 'string') {
      this.undoId = stored;

      return stored;
    }
    const id = nanoid();

    this.undoId = id;

    try {
      this.host.fallback.set(SORT_UNDO_ID_KEY, id);
    } catch {
      // Blocked storage: this session still has one id.
    }

    return id;
  }

  private readFallback(key: string): unknown {
    try {
      return this.host.fallback.get(key);
    } catch {
      return undefined;
    }
  }

  private replaySorts(token: string | undefined, change: HistoryValueChange): void {
    const step = token === undefined ? undefined : sortSteps.get(token);

    if (this.destroyed || change.source === 'remote' || step === undefined) return;
    this.replayingSorts = true;
    try {
      this.personal.replace(step.viewId, step.personal);
    } finally {
      this.replayingSorts = false;
    }
    this.host.rerender();
    this.refresh();
  }

  private saveForEveryone(): void {
    const view = this.host.savedView();

    if (view === undefined || this.host.locked() || this.host.readOnly()) return;
    const name = this.host.rowPageDatabaseName?.() ?? null;

    if (name === null) {
      this.writeDraft(view.id);

      return;
    }
    // research/11 §4 (35-filter-saved.png): every page of the database shares this view, so ask first.
    void openDatabaseConfirm({
      art: [IconPageLayout],
      title: this.t('saveForAllTitle'),
      description: this.t('saveForAllDescription', { name }),
      emphasis: name,
      confirmLabel: this.t('saveForAllConfirm'),
      cancelLabel: this.t('layoutCancel'),
      primary: true,
      borderedCancel: true,
      focusConfirm: true,
      directionSource: this.toolbar,
    }).then((save) => {
      // A peer may have saved, reset or locked it while the dialog was open.
      if (!save || this.host.savedView()?.id !== view.id || this.host.locked() || this.host.readOnly() || !this.hasPersonalEdits(view.id)) return;
      this.writeDraft(view.id);
    });
  }

  private writeDraft(viewId: string): void {
    const patch = this.personal.get(viewId);

    this.writePersonal(viewId, {});
    this.host.updateView(patch);
    this.refresh();
  }

  private reset(): void {
    const view = this.host.savedView();

    if (view === undefined) return;
    this.writePersonal(view.id, {});
    this.host.rerender();
    this.refresh();
  }

  /** `anchor`: the control that opened view settings; editors the panel hands off to open under it. */
  private settingsContext(anchor?: HTMLElement): ViewSettingsContext {
    const editProperties = this.host.editProperties;

    return {
      i18n: this.host.i18n,
      view: () => this.view() ?? this.emptyView(),
      schema: () => this.host.schema(),
      ...(this.host.storedType === undefined ? {} : { storedType: this.host.storedType }),
      locked: () => this.host.locked(),
      layouts: this.host.layouts,
      canDeleteView: () => this.host.viewCount() > 1,
      updateView: (changes) => this.host.updateView(changes),
      updatePersonal: (patch, options) => this.updatePersonal(patch, options),
      setLayout: (type) => this.host.setLayout(type),
      setLocked: (locked) => {
        this.host.setLocked(locked);
        this.refresh();
      },
      ...(this.host.linked !== undefined ? { linked: this.host.linked } : {}),
      ...(this.host.dataSourceTitles !== undefined ? { dataSourceTitles: this.host.dataSourceTitles } : {}),
      duplicateView: () => this.host.duplicateView(),
      deleteView: () => this.host.deleteView(),
      copyViewLink: () => this.host.copyViewLink(),
      ...(this.host.manageInCalendar !== undefined ? { manageInCalendar: this.host.manageInCalendar } : {}),
      groups: (sub) => this.host.groups(sub),
      ...(this.host.moveGroup !== undefined ? { moveGroup: this.host.moveGroup } : {}),
      people: () => this.host.people?.() ?? [],
      ...(this.host.relatedRows !== undefined ? { relatedRows: this.host.relatedRows } : {}),
      ...(this.host.thisPageDatabase !== undefined ? { thisPageDatabase: this.host.thisPageDatabase } : {}),
      ...(this.host.layoutItems !== undefined ? { layoutItems: this.host.layoutItems } : {}),
      ...(this.host.actions !== undefined ? { actions: this.host.actions } : {}),
      ...(this.host.customizeLayout !== undefined ? { customizeLayout: this.host.customizeLayout } : {}),
      ...(this.host.automations !== undefined ? { automations: this.host.automations } : {}),
      ...(this.host.autofill !== undefined ? { autofill: this.host.autofill } : {}),
      ...(editProperties !== undefined && anchor !== undefined ? {
        editProperties: {
          properties: editProperties.properties,
          writable: editProperties.writable,
          edit: (propertyId: string) => editProperties.edit(propertyId, anchor),
          add: () => editProperties.add(anchor),
        },
      } : {}),
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
    // A closed popover takes no more typing: its text becomes a step before any later edit.
    this.endTypingRun();
    anchor.removeAttribute('data-popover-open');
    this.panel = null;
    if (escape && opener.isConnected) opener.focus();
  }

  private openPill(filterId: string, anchor: HTMLElement): void {
    this.panel?.close();
    // notion-motion.md Round 86 §1 #12: after "Add to advanced filter" the advanced panel stays open at its chip.
    this.panel = openFilterChip(anchor, this.settingsContext(), filterId, () => this.panelClosed(anchor), undefined, () => this.openAdvanced(anchor));
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
    this.openPropertyPicker(anchor, 'database-filter-picker', FILTERABLE_TYPES, (property) => this.filterBy(property.id, anchor), {
      placeholder: this.t('filterByPlaceholder'),
      kind: 'filter',
      // notion-motion.md Round 89 §1 #9: it stops 8 from the window bottom. The sort picker's is unread.
      verticalMargin: 8,
      // notion-motion.md Round 10 "Add filter picker": a property already filtered is left out.
      used: this.view()?.filters.map((filter) => filter.propertyId) ?? [],
      footer: (close) => panelRow({
        label: this.t('filterAddAdvanced'),
        testId: 'database-filter-picker-advanced',
        icon: IconPlus,
        muted: true,
        onClick: () => {
          close();
          this.openAdvanced(anchor);
        },
      }),
    });
  }

  /**
   * notion-motion.md Round 18 §2 (r18-adv-open.raw, r18-adv-bar.raw): "Add advanced filter" writes a first
   * rule on the Name ("Where Name Contains"), so the "1 rule" chip shows at once and the popover opens under it.
   */
  private openAdvanced(fallback: HTMLElement): void {
    const view = this.view();
    const title = this.host.schema().find((p) => p.type === 'title');

    if (view !== undefined && title !== undefined && countFilterRules(view.filterTree) === 0) {
      const tree = view.filterTree ?? emptyFilterTree();
      const { id, propertyId, operator, value } = defaultFilterFor(title);

      this.barOpen = true;
      this.updatePersonal({ filterTree: addFilterRule(tree, tree.id, { id, propertyId, operator, value }) });
    }
    const chip = this.filterBar.querySelector<HTMLElement>('[data-blok-testid="database-advanced-pill"]');
    const anchor = chip !== null && !this.filterBar.hidden ? chip : fallback;

    this.panel?.close();
    const ctx: ViewSettingsContext = {
      ...this.settingsContext(),
      updatePersonal: (patch, options) => {
        this.barOpen = true;
        this.updatePersonal(patch, options);
      },
    };

    // notion-motion.md Round 83 §5 (r83-n-af-one.raw): from the toolbar, focus stays on its Filter button.
    const focusHost = fallback === this.filterButton ? this.filterButton : undefined;

    this.panel = openAdvancedFilter(anchor, ctx, (escape) => this.panelClosed(anchor, escape), undefined, focusHost);
    anchor.setAttribute('data-popover-open', '');
  }

  /** The property list (see {@link propertyPicker}). */
  private openPropertyPicker(
    anchor: HTMLElement,
    testId: string,
    types: readonly PropertyType[],
    onPick: (property: PropertyDefinition) => void,
    options: {
      placeholder: string;
      footer?: (close: () => void) => HTMLElement;
      used?: string[];
      kind?: 'filter' | 'sort';
      verticalMargin?: number;
    }
  ): DatabasePanel {
    const panel = propertyPicker({
      anchor,
      testId,
      types,
      schema: () => this.host.schema(),
      storedType: this.host.storedType,
      i18n: this.host.i18n,
      onPick,
      ...options,
      gap: TOOLBAR_PICKER_GAP,
      onClose: (escape) => this.panelClosed(anchor, escape),
    });

    anchor.setAttribute('data-popover-open', '');
    this.showPanel(panel);

    return panel;
  }

  /**
   * Sort: with no rule, the property picker. With one, notion-motion.md Round 17 §5:
   * a shown bar hides; a hidden one shows and the sort panel opens under its chip.
   */
  private openSort(): void {
    const view = this.view();

    if (view === undefined) return;
    if (view.sorts.length === 0) {
      this.openPropertyPicker(this.sortButton, 'database-sort-picker', SORTABLE_TYPES, (property) => {
        this.barOpen = true;
        this.updatePersonal({ sorts: [{ id: nanoid(), propertyId: property.id, direction: 'asc' }] });
        // notion-motion.md Round 47 §D: the new sort's panel opens under its chip.
        const chip = this.filterBar.querySelector<HTMLElement>('[data-blok-testid="database-sort-pill"]');

        if (chip !== null && !this.filterBar.hidden) this.openSortPanel(chip, this.sortButton);
      }, { placeholder: this.t('sortByPlaceholder'), kind: 'sort' });

      return;
    }
    if (this.barShown) {
      this.barOpen = false;
      this.refresh();

      return;
    }
    this.barOpen = true;
    this.refresh();
    const chip = this.filterBar.querySelector<HTMLElement>('[data-blok-testid="database-sort-pill"]');

    this.openSortPanel(chip !== null && chip.isConnected && !this.filterBar.hidden ? chip : this.sortButton, this.sortButton);
  }

  private openSortPanel(anchor: HTMLElement, opener: HTMLElement = anchor): void {
    const panel = sortEditor({
      anchor,
      i18n: this.host.i18n,
      schema: () => this.host.schema(),
      storedType: this.host.storedType,
      sorts: () => this.view()?.sorts ?? [],
      write: (next) => this.updatePersonal({ sorts: next }),
      // notion-motion.md Round 17 §5: chip bottom 301, panel top 305.
      ...(anchor === this.sortButton ? {} : { gap: SORT_PANEL_GAP }),
      onClose: (escape) => this.panelClosed(anchor, escape, opener),
    });

    anchor.setAttribute('data-popover-open', '');
    this.showPanel(panel);
  }

  private showSearch(): void {
    this.endSearchClose();
    if (this.searchInput.isConnected) {
      this.searchInput.removeAttribute('data-closing');
      this.searchInput.after(this.searchClear);
      this.searchInput.focus();
      this.syncMinimize();

      return;
    }
    this.searchInput.hidden = false;
    this.searchButton.after(this.searchInput, this.searchClear);
    this.searchInput.focus();
    this.syncMinimize();
  }

  /** Open and not on its way out. */
  private searchShown(): boolean {
    return this.searchInput.isConnected && !this.searchInput.hasAttribute('data-closing');
  }

  private hideSearch(): void {
    const input = this.searchInput;

    this.searchClear.remove();
    input.value = '';
    this.setSearch('');
    this.searchButton.hidden = this.host.schema().length <= 1;
    if (input.isConnected && !input.hasAttribute('data-closing') && hasTransition(input)) {
      // The field shrinks to nothing first; it leaves when that ends.
      input.setAttribute('data-closing', '');
      input.addEventListener('transitionend', this.finishSearchClose);
      this.searchCloseTimer = setTimeout(this.finishSearchClose, SEARCH_CLOSE_FALLBACK_MS);
    } else if (!input.hasAttribute('data-closing')) {
      this.finishSearchClose();
    }
    this.syncMinimize();
  }

  private readonly finishSearchClose = (): void => {
    this.endSearchClose();
    this.searchInput.removeAttribute('data-closing');
    this.searchInput.hidden = true;
    this.searchInput.remove();
  };

  private endSearchClose(): void {
    this.searchInput.removeEventListener('transitionend', this.finishSearchClose);
    if (this.searchCloseTimer !== null) clearTimeout(this.searchCloseTimer);
    this.searchCloseTimer = null;
  }

  /** » shows for an open search or a filter bar with a sort. */
  private syncMinimize(): void {
    this.minimizeButton.hidden = this.minimized || (!this.searchShown() && !this.barMinimizable);
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
      const pill = filterChip('database-sort-pill', label, { glyph: view.sorts.length === 1 ? IconArrowUp : IconSort, name });

      pill.setAttribute('data-direction', view.sorts[0].direction);
      pill.toggleAttribute('data-blok-database-sort-arrow', view.sorts.length === 1);
      pill.setAttribute('data-active', '');
      pill.addEventListener('click', () => this.openSortPanel(pill));
      pills.push(pill, chipPart('data-blok-database-chip-divider', {}));
    }
    // notion-motion.md Round 18 §2 (r18-adv-bar.raw): the advanced chip goes before the simple ones.
    // Round 19 §1 (r19-adv-group2-bar.raw): the chip counts top-level items; a group counts once.
    if (countFilterRules(view.filterTree) > 0) {
      const label = this.t('filterRuleCount', { count: view.filterTree?.filterRules.length ?? 0 });
      const pill = filterChip('database-advanced-pill', label, { glyph: IconFilter, name: label });

      pill.setAttribute('data-active', '');
      pill.addEventListener('click', () => this.openAdvanced(pill));
      pills.push(pill);
    }
    const locale = editorLocale(this.host.i18n);

    for (const filter of withEntryIds(view.filters)) {
      const property = schema.find((p) => p.id === filter.propertyId);

      if (property === undefined) continue;
      const personName = (id: string): string | undefined => this.host.people?.().find((person) => person.id === id)?.name;
      const rowTitle = (id: string): string | undefined => this.host.relatedRows?.(property).find((row) => row.id === id)?.title;
      const label = filterPillLabel(filter, property, t, personName, rowTitle, locale);
      const { name, colon, value } = filterPillParts(filter, property, t, personName, rowTitle, locale);
      const pill = filterChip(`database-filter-pill-${filter.id}`, label, { glyph: propertyGlyph(property, this.host.storedType), name, colon, value });

      pill.setAttribute('data-filter-id', filter.id);
      pill.toggleAttribute('data-active', value !== '');
      pill.addEventListener('click', () => this.openPill(filter.id, pill));
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
    this.barMinimizable = this.barShown && view.sorts.length > 0;
    this.syncMinimize();
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
