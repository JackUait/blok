import { IconBolt, IconCalendar, IconCheck, IconChevronDown, IconChevronRight, IconChevronUpDown, IconCopy, IconCross, IconDatabase, IconDotsHorizontal, IconEyeSlash, IconFilter, IconGallery, IconLink, IconListBulleted, IconLock, IconPaintRoller, IconPlus, IconPreview, IconReplace, IconSort, IconTable, IconTrash, IconWand } from '../../components/icons';
import type { I18n } from '../../../types';
import { onHover } from '../../components/utils/tooltip';
import {
  DatabasePanel,
  panelCloseButton,
  panelInput,
  panelLabel,
  panelReorderList,
  panelRow,
  panelSeparator,
  panelSwitch,
  panelText,
} from './database-panel';
import type { PanelPage } from './database-panel';
import { editorLocale } from './cells/date-format';
import { propertyTypeMeta } from './database-property-types';
import {
  FILTERABLE_TYPES,
  WITHIN_OPERATORS,
  defaultFilterFor,
  filterPillLabel,
  filterPillParts,
  filterValueText,
  longDay,
  isQuantifiedText,
  joinOperator,
  keepLead,
  menuOperatorOf,
  colorRuleOperatorChoices,
  operatorChoicesFor,
  operatorLabelKey,
  operatorNeedsValue,
  quantifierChoices,
  relativeValueLabelKey,
  splitOperator,
  sortDirectionLabelKey,
  withinLabelKey,
} from './database-filter-labels';
import {
  MAX_FILTER_DEPTH,
  addFilterGroup,
  addFilterRule,
  canGroupFilterNode,
  countFilterRules,
  duplicateFilterNode,
  emptyFilterTree,
  filterGroupDepth,
  groupFilterNode,
  isFilterGroup,
  removeFilterNode,
  setFilterConjunction,
  unwrapFilterGroup,
  updateFilterRule,
  withEntryIds,
} from './filter-tree';
import { DEFAULT_RANGE, GROUPABLE_TYPES, defaultGroupSort, groupByChange, rangeOf, subGroupByChange } from './group-keys';
import { RELATIVE_DATE_UNITS, RELATIVE_DATE_VALUES, formatRelativeSpan, parseRelativeSpan } from './relative-dates';
import { ME_FILTER_VALUE, THIS_PAGE_FILTER_VALUE } from './database-query';
import { COLOR_RULE_LAYOUTS, COLOR_RULE_TYPES, MATCH_OPTION_COLOR, MATCH_OPTION_TYPES, isGroupHidden, withGroupFlags } from './view-data';
import {
  LOAD_LIMITS,
  resolveCardLayout,
  resolveLoadLimit,
  defaultOpenPagesIn,
  resolveOpenPagesIn,
  resolveShowVerticalLines,
  resolveViewProperties,
  resolveWrapCells,
  withPropertyOrder,
  withPropertySetting,
} from './view-settings';
import type { ViewChanges } from './database-model';
import type {
  ColorRule,
  DatabaseViewConfig,
  DependencySettings,
  FilterConfig,
  FilterGroup,
  FilterRule,
  GroupSettings,
  GroupSort,
  OpenPagesIn,
  PersonalViewPatch,
  PropertyDefinition,
  PropertyType,
  SortConfig,
  SubItemsDisplay,
  SubItemsFilter,
  ViewPropertySetting,
  ViewType,
} from './types';
import { nanoid } from 'nanoid';
import { CARD_LAYOUTS, resolveSubItemsDisplay, resolveSubItemsFilter } from './sub-items';
import type { PopoverItemParams } from '@/types/utils/popover/popover-item';
import { automationListPage } from './database-automations-panel';
import { PROPERTY_FLYOUT_WIDTH, openFlyout, openSortDirectionFlyout, openSortPropertyFlyout, sortChevron } from './database-sort-flyouts';
import { OPERATOR_FLYOUT_WIDTH, dateRuleControls, filterChip, openFilterChip, openRuleValueFlyout, operatorPick } from './database-filter-chip';
import { VIEW_ICONS } from './database-tab-bar';
import type { AutomationSettings } from './database-automations-panel';
import { offersAutofill } from './property-values';
import { createOptionPill } from './cells/display';
import { MAP_HEIGHTS, resolveMapBy, resolveMapHeight } from './database-map-view';

export interface ViewGroupEntry {
  key: string;
  label: string;
  count: number;
  /** The group's option pill, as its column header draws it. Absent: the plain name. */
  pill?: () => HTMLElement;
}

/** What the panels ask of the database tool. */
export interface ViewSettingsContext {
  /** `getLocale` dates the filter chips in the editor's language. */
  i18n: Pick<I18n, 't'> & Partial<Pick<I18n, 'getLocale'>>;
  /** The view as this person sees it: the saved view plus their unsaved filters and sorts. */
  view: () => DatabaseViewConfig;
  /** Localized schema. */
  schema: () => PropertyDefinition[];
  locked: () => boolean;
  /** Layouts Blok renders. */
  layouts: readonly ViewType[];
  canDeleteView: () => boolean;
  /** A shared, undoable write to the saved view. Ignored while locked. */
  updateView: (changes: ViewChanges) => void;
  /** A personal, unsaved filter or sort edit (D4). */
  updatePersonal: (patch: PersonalViewPatch) => void;
  setLayout: (type: ViewType) => void;
  setLocked: (locked: boolean) => void;
  /** A linked view: its lock reads "Lock views" (research 20 §2b). */
  linked?: () => boolean;
  duplicateView: () => void;
  deleteView: () => void;
  copyViewLink: () => void;
  /** The host's "Manage in Calendar" (`config.calendar`). Without it there is no such row. */
  manageInCalendar?: { label: string; onClick: () => void };
  /** The groups of the view's grouping (`sub` for the board's sub-grouping). */
  groups: (sub: boolean) => ViewGroupEntry[];
  /** People the host lists, for person filters. */
  people?: () => Array<{ id: string; name: string }>;
  /** Rows a relation can point at, for relation filters. */
  relatedRows?: (property: PropertyDefinition) => Array<{ id: string; title: string }>;
  /** The database whose row page shows this view, or null: a relation to it can name "This page". */
  thisPageDatabase?: () => string | null;
  /**
   * The active layout's own rows (gallery, calendar), as menu items. A row
   * with children becomes a page of choices; one without becomes a switch.
   * Each item needs a `name`: it is the row's test id.
   */
  layoutItems?: () => PopoverItemParams[];
  /** Database settings: sub-items and dependencies. Without it, neither row shows. */
  structure?: StructureSettings;
  /** One-shot tool actions on the root page (CSV export and import, saving a chart). */
  actions?: () => ViewSettingsAction[];
  /** "Customize page layout": the last row of More settings (research/09 §1). */
  customizeLayout?: () => ViewSettingsAction | undefined;
  automations?: AutomationSettings;
  /** The host gave `config.ai.autofill`. Without it there is no AI Autofill row. */
  autofill?: AutofillPanelSettings;
  /** "Edit properties" (research/26 §1a). Without it there is no such row. */
  editProperties?: EditPropertiesSettings;
  /** "Undo … database" on a Tasks or Skills database, "Turn into" on any other (research/33 §3.10). */
  starterRow?: () => StarterRow | undefined;
  /** The database's data sources. With only one, the Source row is greyed (research/09 §1). */
  dataSources?: DataSourceSettings;
}

export type StarterRow =
  | { kind: 'undo'; label: string; onClick: () => void }
  | { kind: 'turnInto'; label: string; choices: Array<{ label: string; testId: string }> };

export interface DataSourceChoice {
  id: string;
  /** Empty when untitled. */
  title: string;
  /** False when a second source cannot draw this view's layout (a dashboard). */
  fits: boolean;
  /** Another database: the page it sits on. */
  parent?: string;
}

/** View settings "Source" (research/23 §10, 125-source-menu.png). */
export interface DataSourceSettings {
  /** The database's own data first, then its second sources. */
  list: () => DataSourceChoice[];
  /** The id of the source the view shows. */
  current: () => string;
  pick: (id: string) => void;
  /** Other databases of the document, under "Existing data sources". They do not make Source active. */
  existing?: () => DataSourceChoice[];
}

export interface AutofillPanelSettings {
  /** The saved schema, localized: a formula's value type must not make it look autofillable. */
  properties: () => PropertyDefinition[];
  writable: () => boolean;
  /** Opens the property's AI Autofill setup. The panel is closed first. */
  open: (propertyId: string) => void;
}

export interface EditPropertiesSettings {
  /** The saved schema, localized, in its order. */
  properties: () => PropertyDefinition[];
  writable: () => boolean;
  /** Opens the property's Edit property panel. The panel is closed first. */
  edit: (propertyId: string) => void;
  /** Opens the new property's name and type picker. The panel is closed first. */
  add: () => void;
}

/** Database-level sub-item and dependency settings (research/05 §11). */
export interface StructureSettings {
  subItems: () => boolean;
  setSubItems: (on: boolean) => void;
  /** The "Blocked by" settings, or undefined while dependencies are off. */
  dependencies: () => DependencySettings | undefined;
  setDependencies: (on: boolean) => void;
  updateDependency: (patch: Partial<DependencySettings>) => void;
}

export interface ViewSettingsAction {
  testId: string;
  label: string;
  icon: string;
  disabled?: boolean;
  onClick?: () => void;
  /** Opens a page instead of acting, and keeps the panel open. */
  page?: () => PanelPage;
  /** Listed under More settings instead of the root (CSV export, import, merge). */
  moreSettings?: boolean;
}

interface LayoutItem {
  name: string;
  title: string;
  active: boolean;
  activate?: () => void;
  children?: LayoutItem[];
}

/** Reads the parts of a menu item the panel draws. Separators and unnamed items are skipped. */
const readLayoutItems = (items: PopoverItemParams[]): LayoutItem[] => items.flatMap((item): LayoutItem[] => {
  const record = item as {
    name?: string;
    title?: string;
    isActive?: boolean | (() => boolean);
    onActivate?: (self: PopoverItemParams) => void;
    children?: { items?: PopoverItemParams[] };
  };

  if (typeof record.name !== 'string' || typeof record.title !== 'string') {
    return [];
  }
  const onActivate = record.onActivate;

  return [{
    name: record.name,
    title: record.title,
    active: typeof record.isActive === 'function' ? record.isActive() : record.isActive === true,
    ...(onActivate !== undefined ? { activate: () => onActivate(item) } : {}),
    ...(record.children?.items !== undefined ? { children: readLayoutItems(record.children.items) } : {}),
  }];
});

/** 11-notion-layout.png: the Layout page's tile order. Layouts it does not show go last. */
const LAYOUT_TILE_ORDER: readonly ViewType[] = ['table', 'board', 'timeline', 'calendar', 'list', 'gallery', 'chart', 'feed', 'map'];

/** "Shown in <layout>" (research/35:197; "Shown in table", 12-notion-propvis.png). Other layouts read "Properties". */
const SHOWN_IN_KEYS: Partial<Record<ViewType, string>> = {
  table: 'settingsShownInTable',
  board: 'settingsShownInBoard',
  list: 'settingsShownInList',
  gallery: 'settingsShownInGallery',
  calendar: 'settingsShownInCalendar',
  timeline: 'settingsShownInTimeline',
  feed: 'settingsShownInFeed',
};

const DATE_LIKE_TYPES: readonly PropertyType[] = ['date', 'createdTime', 'lastEditedTime'];

/** A picker's search text, kept across page redraws. */
interface QueryState {
  get: () => string;
  set: (value: string) => void;
}

const queryState = (): QueryState => {
  const box = { value: '' };

  return {
    get: () => box.value,
    set: (value) => {
      box.value = value;
    },
  };
};

/** The option colors Notion offers (research/08). */
const COLORS = ['default', 'gray', 'brown', 'orange', 'yellow', 'green', 'blue', 'purple', 'pink', 'red'] as const;


/** findings V12: Notion shows no value on an empty Filter, Sort, Group or Conditional color. */
const countValue = (count: number): { value?: string } => (count === 0 ? {} : { value: String(count) });
const nameValue = (property: PropertyDefinition | undefined): { value?: string } => (property === undefined ? {} : { value: property.name });
/** notion-motion.md Round 17 §5: one sort reads as its property's name. Two or more keep the count (Notion's is unread). */
const sortValue = (sorts: SortConfig[], schema: PropertyDefinition[]): { value?: string } => {
  const property = sorts.length === 1 ? schema.find((p) => p.id === sorts[0]?.propertyId) : undefined;

  return property === undefined ? countValue(sorts.length) : nameValue(property);
};

/**
 * notion-motion.md Round 18 §2: one filter reads as its property's name; two or more give the count.
 * Round 19 §1 (r19-settings.raw): an advanced filter counts once, however many rules it holds.
 */
const filterValue = (view: DatabaseViewConfig, schema: PropertyDefinition[]): { value?: string } => {
  const advanced = countFilterRules(view.filterTree) > 0 ? 1 : 0;
  const property = view.filters.length === 1 && advanced === 0 ? schema.find((p) => p.id === view.filters[0]?.propertyId) : undefined;

  return property === undefined ? countValue(view.filters.length + advanced) : nameValue(property);
};

const capital = (word: string): string => `${word.charAt(0).toUpperCase()}${word.slice(1)}`;

/** Builds the pages. One instance per open panel; every page reads `ctx` afresh on refresh. */
export class ViewSettingsPages {
  private readonly ctx: ViewSettingsContext;

  constructor(ctx: ViewSettingsContext) {
    this.ctx = ctx;
  }

  private t(key: string, vars?: Record<string, string | number>): string {
    return this.ctx.i18n.t(`tools.database.${key}`, vars);
  }

  private personName(id: string): string | undefined {
    return this.ctx.people?.().find((person) => person.id === id)?.name;
  }

  private property(id: string | undefined): PropertyDefinition | undefined {
    return this.ctx.schema().find((p) => p.id === id);
  }

  private get shared(): boolean {
    return !this.ctx.locked();
  }

  // ─── Root ───

  root(): PanelPage {
    return {
      title: this.t('settingsTitle'),
      name: 'root',
      headerAction: (panel) => panelCloseButton(panel, this.t('close')),
      titleIsLabel: true,
      build: (panel) => {
        const view = this.ctx.view();
        const group = this.property(view.groupBy);
        const isMap = view.type === 'map';
        const nameRow = this.viewNameRow();
        const layoutRow = panelRow({
          label: this.t('settingsLayout'),
          testId: 'database-settings-layout',
            icon: VIEW_ICONS[view.type] ?? IconTable,
          value: this.t(`viewType${capital(view.type)}`),
          opensPage: true,
          onClick: () => panel.push(this.layout()),
        });
        const filterRow = panelRow({
          label: this.t('settingsFilter'),
          testId: 'database-settings-filter',
            icon: IconFilter,
          ...filterValue(view, this.ctx.schema()),
          opensPage: true,
          onClick: () => panel.push(this.filters()),
        });
        const isDashboard = view.type === 'dashboard';
        // A map has no Sort, Group or Property visibility (research/20 §1f).
        // A dashboard has none of the row settings (notion-motion Round 15 A): its widgets carry them.
        const mapRows = (): HTMLElement[] => [
          nameRow,
          layoutRow,
          panelLabel(this.t('settingsStyle')),
          panelRow({
            label: this.t('chartHeight'),
            testId: 'database-settings-map-height',
            icon: IconChevronUpDown,
            value: this.t(`chartHeight${capital(resolveMapHeight(view))}`),
            opensPage: true,
            onClick: () => panel.push(this.mapHeight()),
          }),
          filterRow,
        ];
        const listRows = (): HTMLElement[] => [
          nameRow,
          layoutRow,
          panelRow({
            label: this.t('settingsPropertyVisibility'),
            testId: 'database-settings-properties',
            icon: IconPreview,
            value: String(this.listedProperties().filter((p) => p.visible).length),
            opensPage: true,
            onClick: () => panel.push(this.properties()),
          }),
          filterRow,
          panelRow({
            label: this.t('settingsSort'),
            testId: 'database-settings-sort',
            icon: IconSort,
            ...sortValue(view.sorts, this.ctx.schema()),
            opensPage: true,
            onClick: () => panel.push(this.sorts()),
          }),
          panelRow({
            label: this.t('settingsGroup'),
            testId: 'database-settings-group',
            icon: IconGallery,
            ...nameValue(group),
            opensPage: true,
            onClick: () => panel.push(this.group(false)),
          }),
        ];
        const layoutRows = isMap ? mapRows() : listRows();
        const rows: HTMLElement[] = isDashboard ? [nameRow, layoutRow] : layoutRows;

        if (view.type === 'board') {
          rows.push(panelRow({
            label: this.t('settingsSubGroup'),
            testId: 'database-settings-subgroup',
            icon: IconGallery,
            ...nameValue(this.property(view.subGroupBy)),
            opensPage: true,
            onClick: () => panel.push(this.group(true)),
          }));
        }
        if (COLOR_RULE_LAYOUTS.includes(view.type) && !isDashboard) {
          rows.push(panelRow({
            label: this.t('settingsConditionalColor'),
            testId: 'database-settings-color',
            icon: IconPaintRoller,
            ...countValue(view.colorRules?.length ?? 0),
            opensPage: true,
            onClick: () => panel.push(this.colors()),
          }));
        }
        const sources = this.ctx.dataSources;
        const choices = sources?.list() ?? [];

        rows.push(
          panelRow({ label: this.t('settingsCopyLink'), testId: 'database-settings-copy-link', icon: IconLink, onClick: () => this.ctx.copyViewLink() }),
          ...this.loneViewDuplicate(panel),
          // Actions Notion has no row for (saving a chart) sit under Copy link.
          ...this.actionRows(panel, (this.ctx.actions?.() ?? []).filter((action) => action.moreSettings !== true))
        );
        const sourceGroupAt = rows.length;

        if (sources !== undefined && choices.length > 0) {
          const current = choices.find((choice) => choice.id === sources.current()) ?? sources.existing?.().find((choice) => choice.id === sources.current());
          const others = choices.filter((choice) => choice !== current && choice.fits);

          rows.push(panelRow({
            label: this.t('settingsSource'),
            testId: 'database-settings-source',
            icon: IconDatabase,
            value: this.sourceName(current),
            opensPage: true,
            disabled: !this.shared || others.length === 0,
            onClick: () => panel.push(this.sourcePicker(sources)),
          }));
        }
        const editProperties = this.ctx.editProperties;

        // research/28 L131: a map's settings have no Edit properties row.
        if (editProperties !== undefined && !isMap && !isDashboard) {
          rows.push(panelRow({
            label: this.t('settingsEditProperties'),
            testId: 'database-settings-edit-properties',
            icon: IconListBulleted,
            opensPage: true,
            disabled: !editProperties.writable(),
            onClick: () => {
              if (editProperties.writable()) panel.push(this.editPropertiesPage(editProperties));
            },
          }));
        }
        const automations = this.ctx.automations;

        if (automations !== undefined) {
          const control = panelRow({
            label: this.t('automationTitle'),
            testId: 'database-settings-automations',
            icon: IconBolt,
            opensPage: true,
            disabled: !automations.writable(),
            onClick: () => {
              if (control.isConnected && automations.writable()) panel.push(automationListPage(automations, this.ctx.i18n));
            },
          });

          rows.push(control);
        }
        const autofill = this.ctx.autofill;

        if (autofill !== undefined) {
          rows.push(panelRow({
            label: this.t('aiAutofill'),
            testId: 'database-settings-autofill',
            icon: IconWand,
            ...countValue(autofill.properties().filter((p) => p.autofill !== undefined).length),
            opensPage: true,
            disabled: !autofill.writable(),
            onClick: () => {
              if (autofill.writable()) panel.push(this.autofillList(autofill));
            },
          }));
        }
        const starterRow = this.ctx.starterRow?.();

        if (starterRow?.kind === 'undo') {
          rows.push(panelRow({
            label: starterRow.label,
            testId: 'database-settings-undo-starter',
            icon: IconReplace,
            disabled: !this.shared,
            onClick: () => {
              panel.close();
              starterRow.onClick();
            },
          }));
        }
        if (starterRow?.kind === 'turnInto') {
          rows.push(panelRow({
            label: starterRow.label,
            testId: 'database-settings-turn-into',
            icon: IconReplace,
            opensPage: true,
            disabled: !this.shared,
            onClick: () => panel.push(this.turnInto(starterRow)),
          }));
        }
        if (this.ctx.structure !== undefined || this.ctx.customizeLayout?.() !== undefined || this.moreActions().length > 0) {
          rows.push(panelRow({
            label: this.t('settingsMoreSettings'),
            testId: 'database-settings-more',
            icon: IconDotsHorizontal,
            opensPage: true,
            onClick: () => panel.push(this.moreSettings()),
          }));
        }
        // research/09 §1: Source, Automations, AI Autofill and More settings sit under "Data source settings".
        if (rows.length > sourceGroupAt) rows.splice(sourceGroupAt, 0, panelSeparator(), panelLabel(this.t('settingsDataSourceSettings')));
        const manageInCalendar = this.ctx.manageInCalendar;

        rows.push(
          panelSeparator(),
          panelSwitch({
            label: this.t(this.ctx.linked?.() === true ? 'settingsLockViews' : 'settingsLockDatabase'),
            testId: 'database-settings-lock',
            icon: IconLock,
            checked: this.ctx.locked(),
            onToggle: (next) => {
              this.ctx.setLocked(next);
              panel.refresh();
            },
          }),
          ...(manageInCalendar === undefined ? [] : [panelRow({
            label: manageInCalendar.label,
            testId: 'database-settings-manage-calendar',
            icon: IconCalendar,
            external: true,
            onClick: () => {
              panel.close();
              manageInCalendar.onClick();
            },
          })])
        );

        return rows;
      },
    };
  }

  /**
   * findings V10: the layout glyph and a "View name" field. It commits on
   * Enter or blur, trimmed, and a blank name keeps the old one, as the tab's
   * inline rename does. Notion's icon picker and description need saved
   * fields a view does not have, so the glyph is not a button.
   */
  private viewNameRow(): HTMLElement {
    const view = this.ctx.view();
    const row = document.createElement('div');
    const icon = document.createElement('span');
    const input = panelInput({
      value: view.name,
      placeholder: this.t('layoutViewName'),
      label: this.t('layoutViewName'),
      testId: 'database-settings-view-name',
      onInput: () => undefined,
    });
    const commit = (): void => {
      const name = input.value.trim();
      const current = this.ctx.view().name;

      if (name === '') {
        input.value = current;

        return;
      }
      if (name !== current) this.ctx.updateView({ name });
    };

    row.setAttribute('data-blok-database-view-name-row', '');
    icon.setAttribute('data-blok-database-view-name-icon', '');
    icon.setAttribute('aria-hidden', 'true');
    icon.innerHTML = VIEW_ICONS[view.type] ?? IconTable;
    input.disabled = !this.shared;
    input.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' || event.isComposing) return;
      event.preventDefault();
      commit();
    });
    // A press inside the panel that blurs the field waits for the press to
    // end: the redraw a rename makes would swallow that row's click.
    const pressed = { now: false };
    const onPress = (): void => {
      pressed.now = true;
    };
    const panelOf = (): HTMLElement | null => input.closest('[data-blok-database-panel]');

    input.addEventListener('focus', () => panelOf()?.addEventListener('pointerdown', onPress, true));
    input.addEventListener('blur', () => {
      panelOf()?.removeEventListener('pointerdown', onPress, true);
      if (!pressed.now) {
        commit();

        return;
      }
      pressed.now = false;
      document.addEventListener('pointerup', () => setTimeout(commit, 0), { capture: true, once: true });
    });
    row.append(icon, input);

    return row;
  }

  /** One view hides its tab, and with it the tab menu's Duplicate: then it stays here. */
  private loneViewDuplicate(panel: DatabasePanel): HTMLElement[] {
    if (this.ctx.canDeleteView()) return [];

    return [panelRow({
      label: this.t('duplicateView'),
      testId: 'database-settings-duplicate',
      icon: IconCopy,
      disabled: !this.shared,
      onClick: () => {
        panel.close();
        this.ctx.duplicateView();
      },
    })];
  }

  private moreActions(): ViewSettingsAction[] {
    return (this.ctx.actions?.() ?? []).filter((action) => action.moreSettings === true);
  }

  private actionRows(panel: DatabasePanel, actions: ViewSettingsAction[]): HTMLElement[] {
    return actions.map((action) => {
      const page = action.page;

      return panelRow({
        label: action.label,
        testId: action.testId,
        icon: action.icon,
        disabled: action.disabled === true,
        opensPage: page !== undefined,
        onClick: () => {
          if (page !== undefined) {
            panel.push(page());

            return;
          }
          panel.close();
          action.onClick?.();
        },
      });
    });
  }

  private sourceName(choice: DataSourceChoice | undefined): string {
    return choice === undefined || choice.title.trim() === '' ? this.t('newDataSource') : choice.title;
  }

  // ─── Source: the other sources of this database, under "Suggested" (research/23 §10) ───

  private sourcePicker(sources: DataSourceSettings): PanelPage {
    const state = { query: '' };
    const list = document.createElement('div');
    const fill = (panel: DatabasePanel): void => {
      const query = state.query.trim().toLowerCase();
      const matches = sources.list()
        .filter((choice) => choice.id !== sources.current() && choice.fits)
        .filter((choice) => this.sourceName(choice).toLowerCase().includes(query));
      const existing = (sources.existing?.() ?? [])
        .filter((choice) => choice.id !== sources.current() && choice.fits)
        .filter((choice) => this.sourceName(choice).toLowerCase().includes(query));
      const row = (choice: DataSourceChoice): HTMLElement => panelRow({
        label: this.sourceName(choice),
        ...(choice.parent === undefined ? {} : { description: choice.parent }),
        testId: `database-source-option-${choice.id}`,
        icon: IconDatabase,
        onClick: () => {
          panel.close();
          sources.pick(choice.id);
        },
      });

      list.replaceChildren(
        ...(matches.length === 0 ? [] : [panelLabel(this.t('linkedSuggested')), ...matches.map(row)]),
        ...(existing.length === 0 ? [] : [panelLabel(this.t('layoutExistingDataSources')), ...existing.map(row)])
      );
    };

    return {
      title: this.t('settingsSource'),
      build: (panel) => {
        const search = panelInput({
          value: state.query,
          placeholder: this.t('layoutLinkDataSourceSearch'),
          label: this.t('layoutLinkDataSourceSearch'),
          testId: 'database-source-search',
          // Only the list redraws, so the field keeps its caret.
          onInput: (value) => {
            state.query = value;
            fill(panel);
          },
        });

        fill(panel);

        return [search, list];
      },
    };
  }

  // ─── AI Autofill: one row per set-up property, then "New AI Autofill" (research/12 §2) ───

  autofillList(autofill: AutofillPanelSettings): PanelPage {
    const open = (panel: DatabasePanel, id: string): void => {
      if (!autofill.writable()) return;
      panel.close();
      autofill.open(id);
    };

    return {
      title: this.t('aiAutofill'),
      build: (panel) => {
        const properties = autofill.properties();
        const rows = properties.filter((p) => p.autofill !== undefined).map((property) => panelRow({
          label: this.t('aiAutofillProperty', { name: property.name }),
          testId: `database-autofill-open-${property.id}`,
          icon: IconWand,
          disabled: !autofill.writable(),
          onClick: () => open(panel, property.id),
        }));
        const candidates = (): PropertyDefinition[] => autofill.properties()
          .filter((p) => p.autofill === undefined && offersAutofill(p.type));

        rows.push(panelRow({
          label: this.t('aiAutofillNew'),
          testId: 'database-autofill-new',
          icon: IconPlus,
          disabled: !autofill.writable() || candidates().length === 0,
          onClick: () => panel.push({
            title: this.t('aiAutofillNew'),
            build: () => candidates().map((property) => panelRow({
              label: property.name,
              testId: `database-autofill-pick-${property.id}`,
              disabled: !autofill.writable(),
              onClick: () => open(panel, property.id),
            })),
          }),
        }));

        return rows;
      },
    };
  }

  // ─── More settings: Sub-items, Dependencies, then Customize page layout (research/09 §1) ───

  /** What its entries do was not measured (research/33 §3.10), so they stay disabled. */
  private turnInto(row: Extract<StarterRow, { kind: 'turnInto' }>): PanelPage {
    return {
      title: row.label,
      returnFocus: 'database-settings-turn-into',
      build: () => row.choices.map((choice) => panelRow({ label: choice.label, testId: choice.testId, disabled: true, onClick: () => undefined })),
    };
  }

  private moreSettings(): PanelPage {
    return {
      title: this.t('settingsMoreSettings'),
      build: (panel) => {
        const rows: HTMLElement[] = [];
        const structure = this.ctx.structure;
        const customize = this.ctx.customizeLayout?.();

        if (structure !== undefined) {
          rows.push(
            panelRow({
              label: this.t('settingsSubItems'),
              testId: 'database-settings-subitems',
              value: this.t(structure.subItems() ? 'settingsOn' : 'settingsOff'),
              opensPage: true,
              onClick: () => panel.push(this.subItems(structure)),
            }),
            panelRow({
              label: this.t('settingsDependencies'),
              testId: 'database-settings-dependencies',
              value: this.t(structure.dependencies() !== undefined ? 'settingsOn' : 'settingsOff'),
              opensPage: true,
              onClick: () => panel.push(this.dependencies(structure)),
            })
          );
        }
        if (customize !== undefined) {
          // Notion draws a chevron on every row here, this one included.
          rows.push(panelRow({
            label: customize.label,
            testId: customize.testId,
            icon: customize.icon,
            opensPage: true,
            disabled: customize.disabled === true,
            onClick: () => {
              panel.close();
              customize.onClick?.();
            },
          }));
        }
        rows.push(...this.actionRows(panel, this.moreActions()));

        return rows;
      },
    };
  }

  // ─── Sub-items and dependencies ───

  private subItems(structure: StructureSettings): PanelPage {
    return {
      title: this.t('settingsSubItems'),
      build: (panel) => {
        const view = this.ctx.view();
        const on = structure.subItems();
        const rows: HTMLElement[] = [
          panelSwitch({
            label: this.t('settingsSubItemsOn'),
            testId: 'database-settings-subitems-switch',
            checked: on,
            disabled: !this.shared,
            onToggle: (next) => {
              structure.setSubItems(next);
              panel.refresh();
            },
          }),
        ];

        if (!on) return rows;
        const display = resolveSubItemsDisplay(view);
        const displays: SubItemsDisplay[] = display === 'card' || CARD_LAYOUTS.has(view.type) ? ['card', 'flattened'] : ['nested', 'flattened'];
        const filters: SubItemsFilter[] = display === 'card' ? ['parents'] : ['parents', 'parentsAndSubItems', 'subItems'];
        const filter = resolveSubItemsFilter(view);

        rows.push(
          panelSeparator(),
          panelLabel(this.t('settingsSubItemsDisplay')),
          ...displays.map((choice) => panelRow({
            label: this.t(`settingsSubItemsDisplay${capital(choice)}`),
            testId: `database-settings-subitems-display-${choice}`,
            checked: display === choice,
            disabled: !this.shared,
            onClick: () => this.ctx.updateView({ subItemsDisplay: choice }),
          })),
          panelSeparator(),
          panelLabel(this.t('settingsSubItemsFilter')),
          ...filters.map((choice) => panelRow({
            label: this.t(`settingsSubItemsFilter${capital(choice)}`),
            testId: `database-settings-subitems-filter-${choice}`,
            checked: filter === choice,
            disabled: !this.shared,
            onClick: () => this.ctx.updateView({ subItemsFilter: choice }),
          }))
        );

        return rows;
      },
    };
  }

  private dependencies(structure: StructureSettings): PanelPage {
    return {
      title: this.t('settingsDependencies'),
      build: (panel) => {
        const settings = structure.dependencies();
        const rows: HTMLElement[] = [
          panelSwitch({
            label: this.t('settingsDependenciesOn'),
            testId: 'database-settings-dependencies-switch',
            checked: settings !== undefined,
            disabled: !this.shared,
            onToggle: (next) => {
              structure.setDependencies(next);
              panel.refresh();
            },
          }),
        ];

        if (settings === undefined) return rows;
        const shift = settings.shift ?? 'none';

        rows.push(
          panelSeparator(),
          panelLabel(this.t('settingsDependencyShift')),
          ...(['overlap', 'maintain', 'none'] as const).map((choice) => panelRow({
            label: this.t(`settingsDependencyShift${capital(choice)}`),
            testId: `database-settings-dependencies-shift-${choice}`,
            checked: shift === choice,
            disabled: !this.shared,
            onClick: () => structure.updateDependency({ shift: choice }),
          })),
          panelSwitch({
            label: this.t('settingsDependencyWeekends'),
            testId: 'database-settings-dependencies-weekends',
            checked: settings.avoidWeekends === true,
            disabled: !this.shared,
            onToggle: (next) => structure.updateDependency({ avoidWeekends: next }),
          })
        );

        return rows;
      },
    };
  }

  // ─── Layout ───

  layout(): PanelPage {
    return {
      title: this.t('settingsLayout'),
      // database.css: the measured row box (notion-motion.md Round 9).
      name: 'layout',
      build: (panel) => {
        const view = this.ctx.view();
        const tiles = this.layoutTiles(panel, view.type);
        // Linked views only: a database that holds its rows shows its own title (R-2022-03-15).
        const sourceTitle = this.ctx.linked?.() === true
          ? [panelSwitch({
            label: this.t('settingsShowDataSourceTitle'),
            testId: 'database-settings-data-source-title',
            checked: view.showDataSourceTitle !== false,
            disabled: !this.shared,
            onToggle: (next) => this.ctx.updateView({ showDataSourceTitle: next }),
          })]
          : [];
        const pageIcon = panelSwitch({
          label: this.t('settingsShowPageIcon'),
          testId: 'database-settings-page-icon',
          checked: view.showPageIcon !== false,
          disabled: !this.shared,
          onToggle: (next) => this.ctx.updateView({ showPageIcon: next }),
        });
        const openPages = panelRow({
          label: this.t('settingsOpenPagesIn'),
          testId: 'database-settings-open-pages',
          value: this.t(`openPages${capital(resolveOpenPagesIn(view))}`),
          opensPage: true,
          onClick: () => panel.push(this.openPagesIn()),
        });
        const loadLimit = panelRow({
          label: this.t('settingsLoadLimit'),
          testId: 'database-settings-load-limit',
          value: String(resolveLoadLimit(view)),
          opensPage: true,
          onClick: () => panel.push(this.loadLimit()),
        });

        if (view.type === 'map') {
          // Measured order, no Wrap (research/20 §1f).
          return [
            tiles,
            ...sourceTitle,
            pageIcon,
            panelRow({
              label: this.t('settingsMapBy'),
              testId: 'database-settings-map-by',
              value: resolveMapBy(view, this.ctx.schema())?.name ?? this.t('settingsNone'),
              opensPage: true,
              onClick: () => panel.push(this.mapBy()),
            }),
            openPages,
            loadLimit,
          ];
        }
        const verticalLines = view.type === 'table'
          ? [panelSwitch({
            label: this.t('settingsVerticalLines'),
            testId: 'database-settings-vertical-lines',
            checked: resolveShowVerticalLines(view),
            disabled: !this.shared,
            onToggle: (next) => this.ctx.updateView({ showVerticalLines: next }),
          })]
          : [];
        const wrap = panelSwitch({
          label: this.t('settingsWrapAll'),
          testId: 'database-settings-wrap',
          checked: resolveWrapCells(view),
          disabled: !this.shared,
          onToggle: (next) => this.ctx.updateView({ wrapCells: next }),
        });

        // 11-notion-layout.png: the switches, then Open pages in and Load limit.
        return [
          tiles,
          ...sourceTitle,
          ...verticalLines,
          pageIcon,
          wrap,
          openPages,
          loadLimit,
          ...this.layoutRows(panel),
          ...(view.type === 'board' || view.type === 'gallery' ? [this.cardLayoutBox(panel)] : []),
        ];
      },
    };
  }

  /**
   * findings V13 (11-notion-layout.png): a 3-column grid of glyph-over-label
   * tiles in Notion's order. Notion rings the pick blue; Blok marks it gray
   * with a ✓ (no-blue law).
   */
  private layoutTiles(panel: DatabasePanel, current: ViewType): HTMLElement {
    const grid = document.createElement('div');
    const rank = (type: ViewType): number => {
      const at = LAYOUT_TILE_ORDER.indexOf(type);

      return at === -1 ? LAYOUT_TILE_ORDER.length : at;
    };
    const types = [...this.ctx.layouts].sort((a, b) => rank(a) - rank(b));

    grid.setAttribute('data-blok-database-layout-tiles', '');
    grid.append(...types.map((type) => {
      const tile = document.createElement('button');
      const glyph = document.createElement('span');
      const label = document.createElement('span');

      tile.type = 'button';
      tile.setAttribute('data-blok-database-layout-tile', type);
      tile.setAttribute('data-blok-testid', `database-layout-${type}`);
      tile.setAttribute('role', 'menuitemradio');
      tile.setAttribute('aria-checked', String(current === type));
      tile.disabled = !this.shared;
      glyph.setAttribute('data-blok-database-layout-tile-glyph', '');
      glyph.innerHTML = VIEW_ICONS[type] ?? IconTable;
      label.textContent = this.t(`viewType${capital(type)}`);
      tile.append(glyph, label);
      if (current === type) {
        const check = document.createElement('span');

        check.setAttribute('data-blok-database-panel-check', '');
        check.innerHTML = IconCheck;
        tile.appendChild(check);
      }
      tile.addEventListener('click', () => {
        this.ctx.setLayout(type);
        panel.refresh();
      });

      return tile;
    }));

    return grid;
  }

  /**
   * research/30 §10d, §10f (shots 22, 24): the board's "Card layout" box, two
   * drawn tiles. Notion rings the pick blue; Blok rings it in primary ink (no-blue law).
   */
  private cardLayoutBox(panel: DatabasePanel): HTMLElement {
    const box = document.createElement('div');
    const label = document.createElement('div');
    const tiles = document.createElement('div');
    const current = resolveCardLayout(this.ctx.view());

    box.setAttribute('data-blok-database-card-layout', '');
    box.setAttribute('data-blok-testid', 'database-settings-card-layout');
    label.setAttribute('data-blok-database-card-layout-label', '');
    label.textContent = this.t('settingsCardLayout');
    tiles.setAttribute('data-blok-database-card-layout-tiles', '');
    tiles.append(...(['compact', 'list'] as const).map((layout) => {
      const tile = document.createElement('button');
      const drawing = document.createElement('span');
      const caption = document.createElement('span');

      tile.type = 'button';
      tile.setAttribute('data-blok-database-card-layout-tile', layout);
      tile.setAttribute('data-blok-testid', `database-card-layout-${layout}`);
      tile.setAttribute('aria-pressed', String(current === layout));
      tile.disabled = !this.shared;
      drawing.setAttribute('data-blok-database-card-layout-drawing', layout);
      drawing.setAttribute('aria-hidden', 'true');
      // The drawing: a dot, then bars side by side (Compact) or one per line (List).
      drawing.append(...Array.from({ length: layout === 'compact' ? 6 : 3 }, () => document.createElement('i')));
      caption.textContent = this.t(layout === 'compact' ? 'settingsCardLayoutCompact' : 'viewTypeList');
      tile.append(drawing, caption);
      tile.addEventListener('click', () => {
        this.ctx.updateView({ cardLayout: layout });
        panel.refresh();
      });

      return tile;
    }));
    box.append(label, tiles);

    return box;
  }

  private currentLayoutItems(): LayoutItem[] {
    return readLayoutItems(this.ctx.layoutItems?.() ?? []);
  }

  /** The gallery or calendar rows, read afresh on every refresh so a pick shows at once. */
  private layoutRows(panel: DatabasePanel): HTMLElement[] {
    const items = this.currentLayoutItems();

    if (items.length === 0) {
      return [];
    }

    return [panelSeparator(), ...items.map((item) => {
      if (item.children === undefined) {
        return panelSwitch({
          label: item.title,
          testId: `database-${item.name}`,
          checked: item.active,
          disabled: !this.shared,
          onToggle: () => {
            item.activate?.();
            panel.refresh();
          },
        });
      }

      return panelRow({
        label: item.title,
        testId: `database-${item.name}`,
        value: item.children.find((child) => child.active)?.title ?? '',
        opensPage: true,
        disabled: !this.shared,
        onClick: () => panel.push(this.layoutChoices(item.name, item.title)),
      });
    })];
  }

  private layoutChoices(name: string, title: string): PanelPage {
    return {
      title,
      build: (panel) => (this.currentLayoutItems().find((item) => item.name === name)?.children ?? []).map((child) => panelRow({
        label: child.title,
        testId: `database-${child.name}`,
        checked: child.active,
        disabled: !this.shared,
        onClick: () => {
          child.activate?.();
          panel.refresh();
        },
      })),
    };
  }

  private openPagesIn(): PanelPage {
    const modes: OpenPagesIn[] = ['side', 'center', 'full'];
    const type = this.ctx.view().type;
    // A dashboard (D6) has no layout label, so it gets no "Default for" line.
    const defaultMode = type === 'dashboard' ? null : defaultOpenPagesIn(type);

    return {
      title: this.t('settingsOpenPagesIn'),
      build: (panel) => modes.flatMap((mode) => [
        panelRow({
          label: this.t(`openPages${capital(mode)}`),
          testId: `database-open-pages-${mode}`,
          checked: resolveOpenPagesIn(this.ctx.view()) === mode,
          disabled: !this.shared,
          onClick: () => {
            this.ctx.updateView({ openPagesIn: mode });
            panel.refresh();
          },
        }),
        panelText(this.t(`openPages${capital(mode)}Description`)),
        ...(mode === defaultMode ? [panelText(this.t('openPagesDefaultFor', { layout: this.t(`viewType${capital(type)}`) }))] : []),
      ]),
    };
  }

  private mapHeight(): PanelPage {
    return {
      title: this.t('chartHeight'),
      build: (panel) => MAP_HEIGHTS.map((height) => panelRow({
        label: this.t(`chartHeight${capital(height)}`),
        testId: `database-map-height-${height}`,
        checked: resolveMapHeight(this.ctx.view()) === height,
        disabled: !this.shared,
        onClick: () => {
          this.ctx.updateView({ mapHeight: height });
          panel.refresh();
        },
      })),
    };
  }

  private mapBy(): PanelPage {
    return {
      title: this.t('settingsMapBy'),
      build: (panel) => this.ctx.schema().filter((p) => p.type === 'place').map((property) => panelRow({
        label: property.name,
        testId: `database-map-by-${property.id}`,
        checked: resolveMapBy(this.ctx.view(), this.ctx.schema())?.id === property.id,
        disabled: !this.shared,
        onClick: () => {
          this.ctx.updateView({ mapBy: property.id });
          panel.refresh();
        },
      })),
    };
  }

  private loadLimit(): PanelPage {
    return {
      title: this.t('settingsLoadLimit'),
      build: (panel) => LOAD_LIMITS.map((limit) => panelRow({
        label: this.t('settingsLoadLimitPages', { count: limit }),
        testId: `database-load-limit-${limit}`,
        checked: resolveLoadLimit(this.ctx.view()) === limit,
        disabled: !this.shared,
        onClick: () => {
          this.ctx.updateView({ loadLimit: limit });
          panel.refresh();
        },
      })),
    };
  }

  // ─── Property visibility ───

  /** research/35 §2.2: Feed's lists leave out the title property. */
  private listedProperties(): ReturnType<typeof resolveViewProperties> {
    const view = this.ctx.view();
    const schema = this.ctx.schema();
    const titleId = view.type === 'feed' ? schema.find((p) => p.type === 'title')?.id : undefined;

    return resolveViewProperties(view, schema).filter((entry) => entry.id !== titleId);
  }

  /**
   * 33-edit-properties.png, research/35 L196: "Properties", a focused search,
   * each property (type glyph, name, chevron), then "New property". A feed's
   * list leaves out the title.
   */
  private editPropertiesPage(settings: EditPropertiesSettings): PanelPage {
    const state = { query: '' };
    const list = document.createElement('div');
    const fill = (panel: DatabasePanel): void => {
      const query = state.query.trim().toLowerCase();
      const feed = this.ctx.view().type === 'feed';
      const rows = settings.properties()
        .filter((property) => !(feed && property.type === 'title') && property.name.toLowerCase().includes(query))
        .map((property) => panelRow({
          label: property.name,
          testId: `database-edit-property-${property.id}`,
          icon: propertyTypeMeta(property.type).icon,
          opensPage: true,
          onClick: () => {
            panel.close();
            settings.edit(property.id);
          },
        }));

      list.replaceChildren(...(rows.length === 0 ? [panelText(this.ctx.i18n.t('find.noResults'))] : rows));
    };

    return {
      title: this.t('propertiesSection'),
      build: (panel) => {
        const search = panelInput({
          value: state.query,
          placeholder: this.t('settingsSearchProperty'),
          label: this.t('settingsSearchProperty'),
          testId: 'database-edit-properties-search',
          // Only the list redraws, so the field keeps its caret.
          onInput: (value) => {
            state.query = value;
            fill(panel);
          },
        });

        search.autofocus = true;
        list.setAttribute('data-blok-database-picker-list', '');
        fill(panel);

        return [
          search,
          list,
          panelSeparator(),
          panelRow({
            label: this.t('settingsNewProperty'),
            testId: 'database-edit-properties-new',
            icon: IconPlus,
            muted: true,
            onClick: () => {
              panel.close();
              settings.add();
            },
          }),
        ];
      },
    };
  }

  properties(): PanelPage {
    const state = { query: '' };
    const list = document.createElement('div');
    const fill = (panel: DatabasePanel): void => {
      const schema = this.ctx.schema();
      const listed = this.listedProperties();
      const query = state.query.trim().toLowerCase();

      if (listed.length === 0) {
        list.replaceChildren(panelText(this.ctx.i18n.t('find.noResults')));

        return;
      }
      const items = listed.flatMap((entry) => {
        const property = schema.find((p) => p.id === entry.id);

        if (property === undefined || !property.name.toLowerCase().includes(query)) return [];

        return [{ id: property.id, element: this.propertyVisibilityRow(panel, property, entry.visible) }];
      });

      list.replaceChildren(...this.shownHeader(panel, listed), panelReorderList({
        testId: 'database-properties-list',
        handleLabel: this.t('settingsDragToReorder'),
        items,
        onMove: (id, beforeId) => {
          // A filtered list hides the neighbours a move is placed between.
          if (!this.shared || query !== '') return;
          this.ctx.updateView({ properties: withPropertyOrder(this.ctx.view(), this.ctx.schema(), id, beforeId) });
          panel.refresh();
        },
      }));
    };

    return {
      title: this.t('settingsPropertyVisibility'),
      name: 'properties',
      build: (panel) => {
        const search = panelInput({
          value: state.query,
          placeholder: this.t('settingsSearchProperty'),
          label: this.t('settingsSearchProperty'),
          testId: 'database-property-search',
          // Only the list redraws, so the field keeps its caret.
          onInput: (value) => {
            state.query = value;
            fill(panel);
          },
        });

        // 12-notion-propvis.png: the search has focus when the page opens.
        search.autofocus = true;

        fill(panel);

        return [search, list];
      },
    };
  }

  /** A type glyph, the name and an eye switch. The title's eye is grayed: it is always shown. */
  private propertyVisibilityRow(panel: DatabasePanel, property: PropertyDefinition, visible: boolean): HTMLElement {
    const row = document.createElement('div');
    const icon = document.createElement('span');
    const name = document.createElement('span');
    const eye = document.createElement('button');
    const isTitle = property.type === 'title';
    const shown = isTitle || visible;

    row.setAttribute('data-blok-database-property-visibility-row', '');
    icon.setAttribute('data-blok-database-panel-icon', '');
    icon.innerHTML = propertyTypeMeta(property.type).icon;
    name.setAttribute('data-blok-database-panel-label', '');
    name.textContent = property.name;
    eye.type = 'button';
    eye.setAttribute('role', 'switch');
    eye.setAttribute('aria-checked', String(shown));
    eye.setAttribute('aria-label', property.name);
    eye.setAttribute('data-blok-database-property-eye', '');
    eye.setAttribute('data-blok-testid', `database-property-visible-${property.id}`);
    eye.innerHTML = shown ? IconPreview : IconEyeSlash;
    eye.disabled = isTitle || !this.shared;
    eye.addEventListener('click', () => {
      this.ctx.updateView({ properties: withPropertySetting(this.ctx.view(), this.ctx.schema(), property.id, { visible: !shown }) });
      panel.refresh();
    });
    row.append(icon, name, eye);

    return row;
  }

  /** The group's pill (or name) and an eye. A hidden group's pill is faded and its eye gray (database.css). */
  private groupVisibilityRow(group: ViewGroupEntry, isHidden: boolean, disabled: boolean, onToggle: () => void): HTMLElement {
    const row = document.createElement('div');
    const name = document.createElement('span');
    const eye = document.createElement('button');

    row.setAttribute('data-blok-database-property-visibility-row', '');
    row.setAttribute('data-blok-database-group-visibility-row', '');
    row.toggleAttribute('data-hidden', isHidden);
    name.setAttribute('data-blok-database-panel-label', '');
    name.append(group.pill?.() ?? group.label);
    eye.type = 'button';
    // notion-motion.md, Round 8c: a plain button named for what a click does.
    eye.setAttribute('aria-label', this.t(isHidden ? 'groupShow' : 'groupHide'));
    eye.setAttribute('data-blok-database-property-eye', '');
    eye.setAttribute('data-blok-testid', `database-group-visible-${group.key}`);
    eye.innerHTML = isHidden ? IconEyeSlash : IconPreview;
    eye.disabled = disabled;
    eye.addEventListener('click', onToggle);
    row.append(name, eye);

    return row;
  }

  /** research/35:197, 12-notion-propvis.png: "Shown in <layout>" and Hide all (Show all once all are hidden). */
  private shownHeader(panel: DatabasePanel, listed: ReturnType<typeof resolveViewProperties>): HTMLElement[] {
    const titleId = this.ctx.schema().find((p) => p.type === 'title')?.id;
    const hideable = listed.filter((entry) => entry.id !== titleId);

    if (hideable.length === 0) return [];
    const allHidden = hideable.every((entry) => !entry.visible);
    const header = document.createElement('div');
    const toggle = document.createElement('button');

    header.setAttribute('data-blok-database-property-visibility-header', '');
    toggle.type = 'button';
    toggle.setAttribute('data-blok-database-property-hide-all', '');
    toggle.setAttribute('data-blok-testid', 'database-property-hide-all');
    toggle.textContent = this.t(allHidden ? 'groupShowAll' : 'groupHideAll');
    toggle.disabled = !this.shared;
    toggle.addEventListener('click', () => {
      const view = this.ctx.view();
      const properties = hideable.reduce<ViewPropertySetting[] | undefined>(
        (entries, entry) => withPropertySetting(entries === undefined ? view : { ...view, properties: entries }, this.ctx.schema(), entry.id, { visible: allHidden }),
        undefined
      ) ?? [];

      this.ctx.updateView({ properties });
      panel.refresh();
    });
    header.append(panelLabel(this.t(SHOWN_IN_KEYS[this.ctx.view().type] ?? 'propertiesSection')), toggle);

    return [header];
  }

  // ─── Property picker ───

  /**
   * `measured`: the picker layout measured in notion-motion.md Round 10 (database.css "pick" page).
   * `used`: properties left out, as Notion's Add sort and Add filter leave out the ones already set.
   */
  private pickProperty(
    title: string,
    types: readonly PropertyType[],
    onPick: (property: PropertyDefinition) => void,
    options: { measured?: boolean; used?: () => string[]; footer?: (panel: DatabasePanel) => HTMLElement[] } = {}
  ): PanelPage {
    const query = queryState();

    return {
      title,
      ...(options.measured === true ? { name: 'pick' } : {}),
      build: (panel) => [...this.propertyPicker(query, types, onPick, { used: options.used?.() ?? [] }), ...(options.footer?.(panel) ?? [])],
    };
  }

  /**
   * findings V15: a search over the properties, Name first, then A→Z. Only
   * the list redraws on input, so the field keeps its caret.
   */
  private propertyPicker(
    query: QueryState,
    types: readonly PropertyType[],
    onPick: (property: PropertyDefinition) => void,
    options: { leading?: () => HTMLElement[]; disabled?: boolean; placeholder?: string; used?: string[] } = {}
  ): HTMLElement[] {
    const list = document.createElement('div');

    list.setAttribute('data-blok-database-property-picker-list', '');
    const fill = (): void => {
      const needle = query.get().trim().toLowerCase();
      const choices = this.ctx.schema()
        .filter((p) => types.includes(p.type) && p.name.toLowerCase().includes(needle) && options.used?.includes(p.id) !== true)
        .sort((a, b) => Number(b.type === 'title') - Number(a.type === 'title') || a.name.localeCompare(b.name));

      const leading = options.leading?.() ?? [];
      const rows = choices.map((property) => panelRow({
        label: property.name,
        testId: `database-pick-property-${property.id}`,
        icon: propertyTypeMeta(property.type).icon,
        disabled: options.disabled === true,
        onClick: () => onPick(property),
      }));

      // notion-motion.md Round 18 §2: an empty list says "No results".
      list.replaceChildren(...leading, ...(leading.length + rows.length === 0 ? [panelText(this.ctx.i18n.t('find.noResults'))] : rows));
    };
    const placeholder = options.placeholder ?? this.t('settingsSearchProperty');
    const search = panelInput({
      value: query.get(),
      placeholder,
      label: placeholder,
      testId: 'database-property-picker-search',
      onInput: (value) => {
        query.set(value);
        fill();
      },
    });

    search.autofocus = true;
    fill();

    return [search, list];
  }

  // ─── Filters ───

  /** The Filter page: simple filters (reorderable), then the advanced filter. */
  filters(): PanelPage {
    const pickState = queryState();
    const empty = (): boolean => this.ctx.view().filters.length === 0 && countFilterRules(this.ctx.view().filterTree) === 0;
    const t = (key: string): string => this.t(key);

    // notion-motion.md Round 9 (r9-vs-filter.raw): with no filter yet the page reads "Add filter".
    return {
      get title() {
        return t(empty() ? 'filterAdd' : 'settingsFilter');
      },
      get name() {
        return empty() ? 'pick' : undefined;
      },
      build: (panel) => {
        const view = this.ctx.view();
        const schema = this.ctx.schema();
        const filters = withEntryIds(view.filters);

        // findings V15: with no filter yet, the page is the property picker, the advanced filter at its foot.
        if (filters.length === 0 && countFilterRules(view.filterTree) === 0) {
          return [
            ...this.propertyPicker(pickState, FILTERABLE_TYPES, (property) => {
              const filter = defaultFilterFor(property);

              this.ctx.updatePersonal({ filters: [filter] });
              panel.push(this.simpleFilter(filter.id));
            }, { placeholder: this.t('filterByPlaceholder') }),
            panelSeparator(),
            panelRow({
              label: this.t('filterAdvanced'),
              testId: 'database-filter-advanced',
              icon: IconPlus,
              muted: true,
              onClick: () => panel.push(this.advanced()),
            }),
          ];
        }
        const items = filters.flatMap((filter) => {
          const property = schema.find((p) => p.id === filter.propertyId);

          if (property === undefined) return [];

          const translate = (key: string, vars?: Record<string, string | number>): string => this.ctx.i18n.t(key, vars);
          const rowTitle = (id: string): string | undefined => this.ctx.relatedRows?.(property).find((row) => row.id === id)?.title;
          const locale = editorLocale(this.ctx.i18n);
          const parts = filterPillParts(filter, property, translate, (id) => this.personName(id), rowTitle, locale);
          // notion-motion.md Round 18 §2: each filter is its chip; a click opens its rule popover under it, the page stays.
          const chip = filterChip(`database-filter-row-${filter.id}`, filterPillLabel(filter, property, translate, (id) => this.personName(id), rowTitle, locale), {
            glyph: propertyTypeMeta(property.type).icon,
            ...parts,
          });

          chip.toggleAttribute('data-active', parts.value !== '');
          chip.addEventListener('click', () => {
            openFilterChip(chip, this.ctx, filter.id, () => panel.refresh(), panel);
          });

          return [{ id: filter.id, element: chip }];
        });
        const rows: HTMLElement[] = [];

        if (items.length > 0) {
          rows.push(panelReorderList({
            testId: 'database-filters-list',
            handleLabel: this.t('settingsDragToReorder'),
            items,
            onMove: (id, beforeId) => {
              const moving = filters.find((f) => f.id === id);
              const rest = filters.filter((f) => f.id !== id);
              const at = beforeId === null ? rest.length : rest.findIndex((f) => f.id === beforeId);

              if (moving === undefined) return;
              this.ctx.updatePersonal({ filters: [...rest.slice(0, at), moving, ...rest.slice(at)] });
              panel.refresh();
            },
          }));
        }
        rows.push(
          panelRow({
            label: this.t('filterAdd'),
            testId: 'database-filter-add',
            icon: IconPlus,
            onClick: () => panel.push(this.pickProperty(this.t('filterAdd'), FILTERABLE_TYPES, (property) => {
              const filter = defaultFilterFor(property);

              this.ctx.updatePersonal({ filters: [...withEntryIds(this.ctx.view().filters), filter] });
              panel.back();
              panel.push(this.simpleFilter(filter.id));
            }, {
              measured: true,
              used: () => this.ctx.view().filters.map((f) => f.propertyId),
              // notion-motion.md Round 18 §2 (r18-settings-addfilter.raw): "Add advanced filter" at the foot.
              footer: (page) => [panelSeparator(), panelRow({
                label: this.t('filterAdvanced'),
                testId: 'database-filter-advanced',
                icon: IconPlus,
                muted: true,
                onClick: () => page.push(this.advanced()),
              })],
            })),
          }),
        );
        const rules = countFilterRules(view.filterTree);

        // notion-motion.md Round 19 §1 (r19-settings-filterpage.raw, r19-settings-advchip.raw): the advanced filter
        // is its chip; a click opens its popover beside the page, which stays.
        if (rules > 0) {
          // Top-level items, as the bar chip counts them: a group is one.
          const label = this.t('filterRuleCount', { count: view.filterTree?.filterRules.length ?? 0 });
          const chip = filterChip('database-filter-advanced-chip', label, { glyph: IconFilter, name: label });

          chip.setAttribute('data-active', '');
          chip.addEventListener('click', () => {
            openAdvancedFilter(chip, this.ctx, () => panel.refresh(), panel);
          });
          // Its own list: the ⠿ and the chip's place match the simple chips, and it cannot mix into their order.
          rows.unshift(panelReorderList({
            testId: 'database-filters-advanced',
            handleLabel: this.t('settingsDragToReorder'),
            items: [{ id: 'advanced', element: chip }],
            onMove: () => undefined,
          }));
        }

        return rows;
      },
    };
  }

  /** The editor of one simple filter. Also the root page of a filter pill's popover. */
  simpleFilter(filterId: string): PanelPage {
    const current = (): FilterConfig | undefined => withEntryIds(this.ctx.view().filters).find((f) => f.id === filterId);
    const write = (next: (filters: Array<FilterConfig & { id: string }>) => FilterConfig[]): void =>
      this.ctx.updatePersonal({ filters: next(withEntryIds(this.ctx.view().filters)) });

    return this.ruleEditor({
      read: current,
      update: (patch) => write((filters) => filters.map((f) => (f.id === filterId ? { ...f, ...patch } : f))),
      remove: () => write((filters) => filters.filter((f) => f.id !== filterId)),
      toAdvanced: () => {
        const filter = current();

        if (filter === undefined) return;
        const tree = this.ctx.view().filterTree ?? emptyFilterTree();

        this.ctx.updatePersonal({
          filters: withEntryIds(this.ctx.view().filters).filter((f) => f.id !== filterId),
          filterTree: addFilterRule(tree, tree.id, { id: nanoid(), propertyId: filter.propertyId, operator: filter.operator, value: filter.value }),
        });
      },
    });
  }

  private ruleEditor(rule: {
    read: () => Pick<FilterConfig, 'propertyId' | 'operator' | 'value'> | undefined;
    update: (patch: Partial<Pick<FilterConfig, 'propertyId' | 'operator' | 'value'>>) => void;
    remove: () => void;
    toAdvanced?: () => void;
  }): PanelPage {
    return {
      build: (panel) => {
        const current = rule.read();
        const property = this.property(current?.propertyId);

        if (current === undefined || property === undefined) {
          return [panelText(this.t('filterGone'))];
        }
        const opKey = operatorLabelKey(property.type, current.operator);
        const { lead, operator: inner } = splitOperator(current.operator);
        const writeLead = (next: string | undefined): void => {
          rule.update({ operator: joinOperator(next, inner) });
          panel.back();
        };
        const rows: HTMLElement[] = [
          // notion-motion.md Round 13: a Date filter's Start date / End date, a Name rollup's Any / None / Every.
          ...(property.type === 'date' ? [panelRow({
            label: this.t(lead === 'end' ? 'dateEnd' : 'dateStart'),
            testId: 'database-filter-side',
            opensPage: true,
            onClick: () => panel.push({
              build: () => (['start', 'end'] as const).map((side) => panelRow({
                label: this.t(side === 'end' ? 'dateEnd' : 'dateStart'),
                testId: `database-filter-side-${side}`,
                checked: (lead === 'end') === (side === 'end'),
                onClick: () => writeLead(side === 'end' ? 'end' : undefined),
              })),
            }),
          })] : []),
          ...(isQuantifiedText(property, current.operator) ? [panelRow({
            label: this.ctx.i18n.t(`tools.database.filterOperator.${lead ?? 'any'}`),
            testId: 'database-filter-quantifier',
            opensPage: true,
            onClick: () => panel.push({
              build: () => quantifierChoices().map((choice) => panelRow({
                label: this.ctx.i18n.t(choice.labelKey),
                testId: `database-filter-quantifier-${choice.operator}`,
                checked: (lead ?? 'any') === choice.operator,
                onClick: () => writeLead(choice.operator),
              })),
            }),
          })] : []),
          panelRow({
            label: property.name,
            testId: 'database-filter-operator',
            value: opKey === undefined ? current.operator : this.ctx.i18n.t(opKey),
            opensPage: true,
            onClick: () => panel.push(this.operators(property, current.operator, (operator) => {
              rule.update(operatorPick(property, operator, current));
              panel.back();
            })),
          }),
          ...this.valueControls(property, current, (patch) => {
            rule.update(patch.operator === undefined ? patch : { ...patch, operator: keepLead(current.operator, patch.operator) });
            panel.refresh();
          }),
          panelSeparator(),
        ];

        if (rule.toAdvanced !== undefined) {
          const toAdvanced = rule.toAdvanced;

          rows.push(panelRow({
            label: this.t('filterAddToAdvanced'),
            testId: 'database-filter-to-advanced',
            onClick: () => {
              toAdvanced();
              panel.close();
            },
          }));
        }
        rows.push(panelRow({
          label: this.t('filterDelete'),
          testId: 'database-filter-delete',
          icon: IconTrash,
          danger: true,
          onClick: () => {
            rule.remove();
            panel.back();
          },
        }));

        return rows;
      },
    };
  }

  private operators(property: PropertyDefinition, current: string, onPick: (operator: string) => void): PanelPage {
    return {
      title: property.name,
      build: () => operatorChoicesFor(property, current).map((choice) => panelRow({
        label: this.ctx.i18n.t(choice.labelKey),
        testId: `database-filter-op-${choice.operator}`,
        checked: menuOperatorOf(current) === choice.operator,
        onClick: () => onPick(choice.operator),
      })),
    };
  }

  private valueControls(
    property: PropertyDefinition,
    filter: Pick<FilterConfig, 'operator' | 'value'>,
    update: (patch: Partial<Pick<FilterConfig, 'operator' | 'value'>>) => void,
    thisPage = true
  ): HTMLElement[] {
    const { value } = filter;
    const operator = splitOperator(filter.operator).operator;
    // filter-sort's relative and "Is between" editors (findings V18), shared with the chip.
    const dates = DATE_LIKE_TYPES.includes(property.type) ? dateRuleControls(this.ctx, filter, update) : undefined;

    if (dates !== undefined) return dates;
    if ((WITHIN_OPERATORS as readonly string[]).includes(operator)) {
      return WITHIN_OPERATORS.map((within) => panelRow({
        label: this.ctx.i18n.t(withinLabelKey(within)),
        testId: `database-filter-within-${within}`,
        checked: operator === within,
        onClick: () => update({ operator: within, value: null }),
      }));
    }
    if (!operatorNeedsValue(operator)) return [];
    if (operator === 'relative_to_today') return this.relativeControls(value, update);
    if (isQuantifiedText(property, filter.operator)) {
      return [panelInput({
        value: typeof value === 'string' ? value : '',
        placeholder: this.t('filterValuePlaceholder'),
        label: this.t('filterValue'),
        testId: 'database-filter-value',
        onInput: (text) => update({ value: text }),
      })];
    }

    switch (property.type) {
      case 'select':
      case 'multiSelect':
      case 'status': {
        const ids = idList(value);

        return (property.config?.options ?? []).map((option) => panelRow({
          label: option.label,
          testId: `database-filter-option-${option.id}`,
          checked: ids.includes(option.id),
          onClick: () => update({ value: ids.includes(option.id) ? ids.filter((id) => id !== option.id) : [...ids, option.id] }),
        }));
      }
      case 'checkbox':
        return [true, false].map((checked) => panelRow({
          label: this.t(checked ? 'filterChecked' : 'filterUnchecked'),
          testId: `database-filter-checkbox-${String(checked)}`,
          checked: value === checked,
          onClick: () => update({ value: checked }),
        }));
      case 'person':
      case 'createdBy':
      case 'lastEditedBy':
        return this.personControls(value, update);
      case 'relation':
        return this.relationControls(property, value, update, thisPage);
      case 'files':
      case 'formula':
      case 'rollup':
      case 'button':
      case 'verification':
        return [];
      case 'date':
      case 'createdTime':
      case 'lastEditedTime':
        return [
          ...RELATIVE_DATE_VALUES.map((relative) => panelRow({
            label: this.ctx.i18n.t(relativeValueLabelKey(relative)),
            testId: `database-filter-date-${relative}`,
            checked: value === relative,
            onClick: () => update({ value: relative }),
          })),
          panelInput({
            value: typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : '',
            placeholder: 'YYYY-MM-DD',
            label: this.t('filterExactDate'),
            testId: 'database-filter-value',
            onInput: (text) => {
              if (/^\d{4}-\d{2}-\d{2}$/.test(text)) update({ value: text });
            },
          }),
        ];
      case 'number':
      case 'uniqueId':
        return [panelInput({
          value: typeof value === 'number' ? String(value) : '',
          placeholder: this.t('filterValuePlaceholder'),
          label: this.t('filterValue'),
          testId: 'database-filter-value',
          onInput: (text) => {
            const n = Number(text);

            update({ value: text.trim() === '' || !Number.isFinite(n) ? null : n });
          },
        })];
      case 'title':
      case 'text':
      case 'url':
      case 'richText':
      case 'email':
      case 'phone':
      case 'place':
        return [panelInput({
          value: typeof value === 'string' ? value : '',
          placeholder: this.t('filterValuePlaceholder'),
          label: this.t('filterValue'),
          testId: 'database-filter-value',
          onInput: (text) => update({ value: text }),
        })];
    }
  }

  /**
   * A relation filter: "This page" first on a row page (research/13 §1c), or
   * while chosen so it can be cleared, then the related database's rows.
   */
  private relationControls(property: PropertyDefinition, value: FilterConfig['value'], update: (patch: { value: string[] }) => void, thisPage: boolean): HTMLElement[] {
    const ids = idList(value);
    const pageDatabase = thisPage ? this.ctx.thisPageDatabase?.() ?? null : null;
    // Only a relation to the page's own database can hold the page's row.
    const page = ids.includes(THIS_PAGE_FILTER_VALUE) || (pageDatabase !== null && property.relation?.targetDatabaseId === pageDatabase)
      ? [panelRow({
        label: this.t('filterThisPage'),
        testId: 'database-filter-related-this-page',
        checked: ids.includes(THIS_PAGE_FILTER_VALUE),
        onClick: () => update({ value: ids.includes(THIS_PAGE_FILTER_VALUE) ? ids.filter((id) => id !== THIS_PAGE_FILTER_VALUE) : [...ids, THIS_PAGE_FILTER_VALUE] }),
      })]
      : [];

    return [...page, ...(this.ctx.relatedRows?.(property) ?? []).map((row) => panelRow({
      label: row.title === '' ? this.t('relationUntitled') : row.title,
      testId: `database-filter-related-${row.id}`,
      checked: ids.includes(row.id),
      onClick: () => update({ value: ids.includes(row.id) ? ids.filter((id) => id !== row.id) : [...ids, row.id] }),
    }))];
  }

  /**
   * A person filter: "Me" first (Notion API value `me`, resolved against the
   * people lever at query time), then everyone the host lists.
   */
  private personControls(value: FilterConfig['value'], update: (patch: { value: string[] }) => void): HTMLElement[] {
    const ids = idList(value);
    const toggle = (id: string): void => update({ value: ids.includes(id) ? ids.filter((other) => other !== id) : [...ids, id] });
    const me = panelRow({
      label: this.t('filterMe'),
      testId: 'database-filter-person-me',
      checked: ids.includes(ME_FILTER_VALUE),
      onClick: () => toggle(ME_FILTER_VALUE),
    });

    return [me, ...(this.ctx.people?.() ?? []).map((person) => panelRow({
      label: person.name,
      testId: `database-filter-person-${person.id}`,
      checked: ids.includes(person.id),
      onClick: () => toggle(person.id),
    }))];
  }

  private relativeControls(value: FilterConfig['value'], update: (patch: { value: string }) => void): HTMLElement[] {
    const span = parseRelativeSpan(value) ?? { direction: 'past' as const, count: 1, unit: 'week' as const };

    return [
      ...(['past', 'next'] as const).map((direction) => panelRow({
        label: this.t(`filterDirection${capital(direction)}`),
        testId: `database-filter-direction-${direction}`,
        checked: span.direction === direction,
        onClick: () => update({ value: formatRelativeSpan({ ...span, direction }) }),
      })),
      panelInput({
        value: String(span.count),
        placeholder: '1',
        label: this.t('filterCount'),
        testId: 'database-filter-count',
        onInput: (text) => {
          const count = Number(text);

          if (Number.isInteger(count) && count >= 1) update({ value: formatRelativeSpan({ ...span, count }) });
        },
      }),
      ...RELATIVE_DATE_UNITS.map((unit) => panelRow({
        label: this.t(`filterUnit${capital(unit)}`),
        testId: `database-filter-unit-${unit}`,
        checked: span.unit === unit,
        onClick: () => update({ value: formatRelativeSpan({ ...span, unit }) }),
      })),
    ];
  }

  // ─── Advanced filter ───

  /** `titled` false: the chip's popover, which Notion draws with no header (r18-adv-open.raw). */
  advanced(titled = true): PanelPage {
    // Keep rule ids stable until the first edit saves the tree.
    const view = this.ctx.view();
    const fallback = { ...emptyFilterTree(), filterRules: withEntryIds(view.filters) };
    const tree = (): FilterGroup => this.ctx.view().filterTree ?? fallback;
    const write = (next: FilterGroup): void => this.ctx.updatePersonal({
      ...(view.filterTree === undefined ? { filters: [] } : {}),
      filterTree: next,
    });

    return {
      ...(titled ? { title: this.t('filterAdvanced') } : {}),
      // notion-motion.md Round 18 §2 (r18-adv-open.raw): 508.2 wide for one Name rule, the width of its rules.
      fitContent: true,
      build: (panel) => [
        ...this.groupRows(panel, tree(), 1, tree, write),
        panelSeparator(),
        panelRow({
          label: this.t('filterDeleteAdvanced'),
          testId: 'database-filter-delete-advanced',
          icon: IconTrash,
          danger: true,
          onClick: () => {
            write({ ...tree(), filterRules: [] });
            panel.refresh();
          },
        }),
      ],
    };
  }

  private groupRows(
    panel: DatabasePanel,
    group: FilterGroup,
    layer: number,
    tree: () => FilterGroup,
    write: (next: FilterGroup) => void
  ): HTMLElement[] {
    const rows: HTMLElement[] = [];

    group.filterRules.forEach((node, index) => {
      const prefix = this.conjunctionLabel(panel, group, index, tree, write);

      if (isFilterGroup(node)) {
        const box = document.createElement('div');

        // notion-motion.md Round 19 §1 (r19-adv-groupmore.raw).
        const more = this.nodeMore(panel, node.id, { button: `database-filter-group-more-${node.id}`, menu: 'database-filter-group-more-menu', width: GROUP_MORE_WIDTH }, tree, write, (act) => [
          panelRow({
            label: this.t('filterTurnIntoFilter'),
            testId: 'database-filter-turn-into-filter',
            icon: IconReplace,
            // Notion's was read on a group of one. Blok never drops rules, so a bigger group cannot turn.
            disabled: node.filterRules.length !== 1,
            onClick: () => act(() => unwrapFilterGroup(tree(), node.id)),
          }),
          panelRow({
            label: this.t('filterWrapInGroup'),
            description: this.t('filterWrapInGroupDescription'),
            testId: 'database-filter-wrap-in-group',
            icon: IconReplace,
            disabled: !canGroupFilterNode(tree(), node.id),
            onClick: () => act(() => groupFilterNode(tree(), node.id, { id: nanoid(), conjunction: NEW_GROUP_CONJUNCTION })),
          }),
        ]);

        const line = document.createElement('div');

        more.setAttribute('data-blok-database-filter-group-more', '');
        box.setAttribute('data-blok-database-filter-group', '');
        box.setAttribute('data-blok-testid', `database-filter-group-${node.id}`);
        box.append(...this.groupRows(panel, node, layer + 1, tree, write));
        // notion-motion.md Round 19 §1 (r19-adv-group.raw): the box starts in the property column, its ⋯ in the rules' ⋯ column.
        line.setAttribute('data-blok-database-filter-group-line', '');
        line.append(prefix, box, more);
        rows.push(line);

        return;
      }
      rows.push(this.ruleLine(panel, node, prefix, tree, write));
    });

    const addRule = (): void => {
      write(addFilterRule(tree(), group.id, this.firstRule(group, tree())));
      panel.refresh();
    };
    const canAddGroup = layer < MAX_FILTER_DEPTH && filterGroupDepth(tree(), group.id) < MAX_FILTER_DEPTH;
    // notion-motion.md Round 18 §2 (r18-adv-addrule.raw): one "+ Add filter rule ⌄" button, its menu under it.
    // Round 20 §2 (r20-g-lvl3.png): a group that cannot hold a group gets a plain button that adds the rule at once.
    const add: HTMLElement = canAddGroup ? sortChevron(panelRow({
      label: this.t('filterAddRule'),
      testId: `database-filter-add-rule-${group.id}`,
      icon: IconPlus,
      onClick: () => openFlyout(add, panel, 'database-filter-add-menu', ADD_MENU_WIDTH, (pick) => [
        // Round 19 §1 (r19-adv-two.raw): the rule comes at once as "Name · Contains", no property picker first.
        panelRow({
          label: this.t('filterAddRule'),
          testId: 'database-filter-add-rule',
          onClick: () => pick(addRule),
        }),
        panelRow({
          label: this.t('filterAddGroup'),
          description: this.t('filterAddGroupDescription'),
          testId: 'database-filter-add-group',
          onClick: () => pick(() => {
            // Round 19 §1 (r19-adv-group.raw): a new group holds one rule. Round 20 §5: its And/Or is the opposite of its parent's.
            write(addFilterGroup(tree(), group.id, { id: nanoid(), conjunction: group.conjunction === 'and' ? 'or' : 'and', filterRules: [this.firstRule(group, tree())] }));
            panel.refresh();
          }),
        }),
      ]),
    })) : panelRow({
      label: this.t('filterAddRule'),
      testId: `database-filter-add-rule-${group.id}`,
      icon: IconPlus,
      onClick: addRule,
    });

    add.setAttribute('data-blok-database-filter-add-rule', '');
    rows.push(add);

    return rows;
  }

  /**
   * notion-motion.md Round 18 §2 (r18-adv-open.raw): "Where · property ⌄ · operator ⌄ · value · ⋯", edited in
   * place. The property and operator lists are flyouts under their buttons (r18-adv-prop.raw, r18-adv-op.raw).
   * A value that is not one text field (options, people, dates) still opens the rule page: Notion's is unread.
   */
  private ruleLine(
    panel: DatabasePanel,
    node: FilterConfig & { id: string },
    prefix: HTMLElement,
    tree: () => FilterGroup,
    write: (next: FilterGroup) => void
  ): HTMLElement {
    const id = node.id;
    const line = document.createElement('div');
    const property = this.property(node.propertyId);
    const save = (patch: Partial<Pick<FilterConfig, 'propertyId' | 'operator' | 'value'>>): void => {
      write(updateFilterRule(tree(), id, patch));
      panel.refresh();
    };
    const button = (testId: string, label: string, onClick: (self: HTMLElement) => void, icon?: string): HTMLElement => {
      const self: HTMLElement = sortChevron(panelRow({ label, testId, ...(icon !== undefined ? { icon } : {}), onClick: () => onClick(self) }));

      self.setAttribute('data-blok-database-filter-rule-button', '');

      return self;
    };
    // notion-motion.md Round 19 §1 (r19-adv-rulemore.raw): the menu sits under the ⋯.
    const more = this.nodeMore(panel, id, { button: `database-filter-rule-more-${id}`, menu: 'database-filter-rule-more-menu', width: RULE_MORE_WIDTH }, tree, write, (act) => [
      panelRow({
        label: this.t('filterTurnIntoGroup'),
        testId: 'database-filter-turn-into-group',
        icon: IconReplace,
        disabled: !canGroupFilterNode(tree(), id),
        onClick: () => act(() => groupFilterNode(tree(), id, { id: nanoid(), conjunction: NEW_GROUP_CONJUNCTION })),
      }),
    ]);

    more.setAttribute('data-blok-database-filter-rule-more', '');
    line.setAttribute('data-blok-database-filter-rule', '');
    line.setAttribute('data-blok-testid', `database-filter-rule-${id}`);

    if (property === undefined) {
      line.append(prefix, panelText(this.t('filterGone')), more);

      return line;
    }
    const opKey = operatorLabelKey(property.type, node.operator);
    const filterable = this.ctx.schema().filter((p) => FILTERABLE_TYPES.includes(p.type));
    const ordered = [...filterable.filter((p) => p.type === 'title'), ...filterable.filter((p) => p.type !== 'title').sort((a, b) => a.name.localeCompare(b.name))];
    const propertyButton = button(`database-filter-rule-property-${id}`, property.name, (self) => {
      openFlyout(self, panel, 'database-filter-rule-property-picker', PROPERTY_FLYOUT_WIDTH, (pick) => ordered.map((p) => panelRow({
        label: p.name,
        icon: propertyTypeMeta(p.type).icon,
        testId: `database-pick-property-${p.id}`,
        onClick: () => pick(() => {
          const { id: _fresh, ...condition } = defaultFilterFor(p);

          save(condition);
        }),
      })));
    }, propertyTypeMeta(property.type).icon);
    const operatorButton = button(`database-filter-rule-operator-${id}`, opKey === undefined ? node.operator : this.ctx.i18n.t(opKey), (self) => {
      openFlyout(self, panel, 'database-filter-operator-picker', OPERATOR_FLYOUT_WIDTH, (pick) => operatorChoicesFor(property, node.operator).map((choice) => panelRow({
        label: this.ctx.i18n.t(choice.labelKey),
        testId: `database-filter-op-${choice.operator}`,
        checked: menuOperatorOf(node.operator) === choice.operator,
        onClick: () => pick(() => {
          const picked = operatorPick(property, choice.operator, node);

          // notion-motion.md Round 19 §1 (r19-adv-date*.raw): an advanced Date "Is" starts on Today.
          save(property.type === 'date' && choice.operator === 'equals' && (picked.value === null || picked.value === '') ? { ...picked, value: 'today' } : picked);
        }),
      })));
    });
    const controls = this.valueControls(property, node, (patch) => {
      save(patch.operator === undefined ? patch : { ...patch, operator: keepLead(node.operator, patch.operator) });
    });
    const [only] = controls;

    line.append(prefix, propertyButton);
    // notion-motion.md Round 19 §1 (r19-adv-date*.raw): a Date row adds "Start date ⌄" before the operator.
    if (property.type === 'date') {
      const { lead, operator } = splitOperator(node.operator);

      line.append(button(`database-filter-rule-side-${id}`, this.t(lead === 'end' ? 'dateEnd' : 'dateStart'), (self) => {
        openFlyout(self, panel, 'database-filter-side-picker', OPERATOR_FLYOUT_WIDTH, (pick) => (['start', 'end'] as const).map((side) => panelRow({
          label: this.t(side === 'end' ? 'dateEnd' : 'dateStart'),
          testId: `database-filter-side-${side}`,
          checked: (lead === 'end') === (side === 'end'),
          onClick: () => pick(() => save({ operator: joinOperator(side === 'end' ? 'end' : undefined, operator) })),
        })));
      }));
    }
    line.append(operatorButton);
    if (controls.length === 1 && only instanceof HTMLInputElement) {
      only.setAttribute('data-blok-testid', `database-filter-rule-value-${id}`);
      only.setAttribute('data-blok-database-filter-rule-value', '');
      line.append(only);
    } else if (controls.length > 0) {
      const day = DATE_LIKE_TYPES.includes(property.type) && typeof node.value === 'string' && ISO_DAY_VALUE.test(node.value) ? node.value : undefined;
      const shown = day !== undefined ? longDay(day, editorLocale(this.ctx.i18n)) : filterValueText(node, property, (key, vars) => this.ctx.i18n.t(key, vars), (person) => this.personName(person), (row) => this.ctx.relatedRows?.(property).find((r) => r.id === row)?.title, editorLocale(this.ctx.i18n));
      const valueButton = button(`database-filter-rule-value-${id}`, shown || this.ctx.i18n.t(VALUE_PLACEHOLDER_KEYS[property.type] ?? 'tools.database.filterValue'), (self) => {
        openRuleValueFlyout(self, panel, this.ctx, () => findRule(tree(), id), (patch) => {
          write(updateFilterRule(tree(), id, patch.operator === undefined ? patch : { ...patch, operator: keepLead(findRule(tree(), id)?.operator ?? node.operator, patch.operator) }));
        });
      });

      if (shown === '') valueButton.setAttribute('data-blok-database-filter-placeholder', '');
      line.append(valueButton);
    }
    line.append(more);

    return line;
  }

  /** A rule's or group's ⋯: Remove (red), Duplicate, then the rows `extra` gives. A pick saves and redraws. */
  private nodeMore(
    panel: DatabasePanel,
    nodeId: string,
    ids: { button: string; menu: string; width: number },
    tree: () => FilterGroup,
    write: (next: FilterGroup) => void,
    extra: (act: (next: () => FilterGroup) => void) => HTMLElement[]
  ): HTMLElement {
    const more = document.createElement('button');

    more.type = 'button';
    more.setAttribute('data-blok-testid', ids.button);
    more.setAttribute('aria-label', this.t('tableMoreActions'));
    more.innerHTML = IconDotsHorizontal;
    more.addEventListener('click', () => openFlyout(more, panel, ids.menu, ids.width, (pick) => {
      const act = (next: () => FilterGroup): void => pick(() => {
        write(next());
        panel.refresh();
      });

      return [
        panelRow({
          label: this.t('filterRemove'),
          testId: 'database-filter-remove',
          icon: IconTrash,
          danger: true,
          onClick: () => act(() => removeFilterNode(tree(), nodeId)),
        }),
        panelRow({
          label: this.t('filterDuplicate'),
          testId: 'database-filter-duplicate',
          icon: IconCopy,
          onClick: () => act(() => duplicateFilterNode(tree(), nodeId)),
        }),
        ...extra(act),
      ];
    }));

    return more;
  }

  /**
   * A new advanced rule, empty, on the property already in use: the last rule in `group`, else the
   * tree's first rule, else Name (Round 19 §1, Round 20 §2). Which rule Notion copies is unread.
   */
  private firstRule(group: FilterGroup, tree: FilterGroup): FilterConfig & { id: string } {
    const filterable = this.ctx.schema().filter((p) => FILTERABLE_TYPES.includes(p.type));
    const seed = rulesOf(group).at(-1) ?? rulesOf(tree)[0];
    const property = filterable.find((p) => p.id === seed?.propertyId) ?? filterable.find((p) => p.type === 'title') ?? filterable[0];
    const { id: _id, ...condition } = defaultFilterFor(property);

    return { id: nanoid(), ...condition };
  }

  /** "Where" on the first rule, the And/Or choice on the second, plain text after (research/08). */
  private conjunctionLabel(
    panel: DatabasePanel,
    group: FilterGroup,
    index: number,
    tree: () => FilterGroup,
    write: (next: FilterGroup) => void
  ): HTMLElement {
    if (index === 0) return panelText(this.t('filterWhere'));
    const label = this.t(group.conjunction === 'or' ? 'filterOr' : 'filterAnd');

    if (index > 1) return panelText(label);

    // notion-motion.md Round 19 §1 (r19-adv-andor.raw): a flyout under the button, two rows with a hint each.
    // Blok marks the current one with a checkmark; Notion only tints it.
    const button: HTMLElement = sortChevron(panelRow({
      label,
      testId: `database-filter-conjunction-${group.id}`,
      onClick: () => openFlyout(button, panel, 'database-filter-conjunction-picker', CONJUNCTION_FLYOUT_WIDTH, (pick) => (['and', 'or'] as const).map((conjunction) => panelRow({
        label: this.t(conjunction === 'or' ? 'filterOr' : 'filterAnd'),
        description: this.t(conjunction === 'or' ? 'filterOrDescription' : 'filterAndDescription'),
        testId: `database-filter-conjunction-${conjunction}`,
        checked: group.conjunction === conjunction,
        onClick: () => pick(() => {
          write(setFilterConjunction(tree(), group.id, conjunction));
          panel.refresh();
        }),
      }))),
    }));

    button.setAttribute('data-blok-database-filter-conjunction', '');

    return button;
  }

  // ─── Sorts ───

  sorts(): PanelPage {
    const pickState = queryState();
    const empty = (): boolean => this.ctx.view().sorts.length === 0;
    const t = (key: string): string => this.t(key);

    // notion-motion.md Round 9 (r9-vs-sort.raw): with no sort yet the page reads "New sort".
    return {
      get title() {
        return t(empty() ? 'sortNew' : 'settingsSort');
      },
      get name() {
        return empty() ? 'pick' : undefined;
      },
      build: (panel) => {
        const schema = this.ctx.schema();
        const sorts = withEntryIds(this.ctx.view().sorts);
        const write = (next: SortConfig[]): void => {
          this.ctx.updatePersonal({ sorts: next });
          panel.refresh();
        };

        // findings V15: with no sort yet, the page is the property picker.
        if (sorts.length === 0) {
          return this.propertyPicker(pickState, GROUPABLE_TYPES, (property) => write([{ id: nanoid(), propertyId: property.id, direction: 'asc' }]), { placeholder: this.t('sortByPlaceholder') });
        }
        const items = sorts.flatMap((sort) => {
          const property = schema.find((p) => p.id === sort.propertyId);

          if (property === undefined) return [];
          const line = document.createElement('div');
          // Notion's "Remove sort rule" is an icon-only × (research/26 §3a).
          const remove = panelRow({
            label: this.t('sortRemove'),
            testId: `database-sort-remove-${sort.id}`,
            icon: IconCross,
            onClick: () => write(sorts.filter((s) => s.id !== sort.id)),
          });

          remove.querySelector('[data-blok-database-panel-label]')?.remove();
          remove.setAttribute('aria-label', this.t('sortRemove'));
          remove.setAttribute('data-blok-database-sort-remove', '');
          line.setAttribute('data-blok-database-sort-row', '');
          line.setAttribute('data-blok-testid', `database-sort-row-${sort.id}`);
          // notion-motion.md Round 17 §5: both buttons open a flyout under them; the page stays.
          const propertyButton: HTMLElement = sortChevron(panelRow({
            label: property.name,
            testId: `database-sort-property-${sort.id}`,
            icon: propertyTypeMeta(property.type).icon,
            onClick: () => openSortPropertyFlyout(
              propertyButton,
              panel,
              schema.filter((p) => GROUPABLE_TYPES.includes(p.type)),
              (picked) => write(withEntryIds(this.ctx.view().sorts).map((s) => (s.id === sort.id ? { ...s, propertyId: picked.id } : s)))
            ),
          }));
          const directionButton: HTMLElement = sortChevron(panelRow({
            label: this.ctx.i18n.t(sortDirectionLabelKey(property.type, sort.direction)),
            testId: `database-sort-direction-${sort.id}`,
            onClick: () => openSortDirectionFlyout(
              directionButton,
              panel,
              (key) => this.ctx.i18n.t(key),
              property,
              sort.direction,
              (direction) => write(withEntryIds(this.ctx.view().sorts).map((s) => (s.id === sort.id ? { ...s, direction } : s)))
            ),
          }));

          line.append(propertyButton, directionButton, remove);

          return [{ id: sort.id, element: line }];
        });

        return [
          panelReorderList({
            testId: 'database-sorts-list',
            handleLabel: this.t('settingsDragToReorder'),
            items,
            onMove: (id, beforeId) => {
              const moving = sorts.find((s) => s.id === id);
              const rest = sorts.filter((s) => s.id !== id);
              const at = beforeId === null ? rest.length : rest.findIndex((s) => s.id === beforeId);

              if (moving !== undefined) write([...rest.slice(0, at), moving, ...rest.slice(at)]);
            },
          }),
          // notion-motion.md Round 17 §5: gone once every property is sorted.
          ...(schema.some((p) => GROUPABLE_TYPES.includes(p.type) && !sorts.some((s) => s.propertyId === p.id)) ? [panelRow({
            label: this.t('sortAdd'),
            testId: 'database-sort-add',
            muted: true,
            icon: IconPlus,
            onClick: () => panel.push(this.pickProperty(this.t('sortAdd'), GROUPABLE_TYPES, (property) => {
              this.ctx.updatePersonal({ sorts: [...sorts, { id: nanoid(), propertyId: property.id, direction: 'asc' }] });
              panel.back();
            }, { measured: true, used: () => sorts.map((sort) => sort.propertyId) })),
          })] : []),
          panelRow({
            label: this.t('sortDeleteAll'),
            testId: 'database-sort-delete-all',
            muted: true,
            icon: IconTrash,
            danger: true,
            disabled: sorts.length === 0,
            onClick: () => write([]),
          }),
        ];
      },
    };
  }

  // ─── Group ───

  /** `sub` edits the board's sub-grouping: `subGroupBy`, `subGroupSettings` and `sub:` group states. */
  group(sub: boolean): PanelPage {
    const settingsKey = sub ? 'subGroupSettings' : 'groupSettings';
    const settings = (): GroupSettings => this.ctx.view()[settingsKey] ?? {};
    const setSettings = (patch: Partial<GroupSettings>): void =>
      this.ctx.updateView({ [settingsKey]: { ...settings(), ...patch } });
    const stateKey = (key: string): string => (sub ? `sub:${key}` : key);
    const pickState = queryState();

    const ungrouped = (): boolean => !sub && this.property(this.ctx.view().groupBy) === undefined;
    const t = (key: string): string => this.t(key);

    // notion-motion.md Round 10 "Group by list": ungrouped, the page is the property list titled "Group by".
    return {
      get title() {
        if (sub) return t('settingsSubGroup');

        return t(ungrouped() ? 'groupBy' : 'settingsGroup');
      },
      get name() {
        if (sub) return undefined;

        return ungrouped() ? 'pick' : 'group';
      },
      build: (panel) => {
        const view = this.ctx.view();
        const property = this.property(sub ? view.subGroupBy : view.groupBy);
        const disabled = !this.shared;

        // findings V15 (26-notion-group.png): ungrouped, the page is None, then the property picker.
        if (!sub && property === undefined) {
          return this.propertyPicker(pickState, GROUPABLE_TYPES, (picked) => {
            this.ctx.updateView(groupByChange(this.ctx.view(), picked));
            panel.refresh();
          }, {
            disabled,
            leading: () => [panelRow({ label: this.t('settingsNone'), testId: 'database-group-none', checked: true, onClick: () => undefined })],
          });
        }
        const refreshAfter = (write: () => void): (() => void) => () => {
          write();
          panel.refresh();
        };
        const rows: HTMLElement[] = [
          panelRow({
            label: this.t('groupBy'),
            testId: sub ? 'database-subgroup-by' : 'database-group-by',
            value: property?.name ?? this.t('settingsNone'),
            opensPage: true,
            disabled,
            onClick: () => panel.push(this.pickProperty(this.t('groupBy'), GROUPABLE_TYPES, (picked) => {
              this.ctx.updateView(sub ? subGroupByChange(this.ctx.view(), picked) : groupByChange(this.ctx.view(), picked));
              panel.back();
            }, { measured: true })),
          }),
        ];

        if (property === undefined) return rows;

        if (property.type === 'status' && !sub) {
          const statusBy = view.groupByStatus ?? 'option';

          rows.push(panelRow({
            label: this.t('groupStatusBy'),
            testId: 'database-group-status-by',
            value: this.t(statusBy === 'group' ? 'groupStatusGroup' : 'groupStatusOption'),
            opensPage: true,
            disabled,
            onClick: () => panel.push({
              title: this.t('groupStatusBy'),
              build: (inner) => (['group', 'option'] as const).map((by) => panelRow({
                label: this.t(by === 'group' ? 'groupStatusGroup' : 'groupStatusOption'),
                testId: `database-group-status-by-${by}`,
                checked: (this.ctx.view().groupByStatus ?? 'option') === by,
                onClick: () => {
                  this.ctx.updateView({ groupByStatus: by });
                  inner.back();
                },
              })),
            }),
          }));
        }
        rows.push(...this.groupTypeRows(panel, property, settings, setSettings, disabled));
        const sortChoices = groupSortChoices(property.type);

        if (sortChoices.length > 0) {
          const current = settings().sort ?? defaultGroupSort(property.type);

          rows.push(panelRow({
            label: this.t('groupSort'),
            testId: 'database-group-sort',
            value: this.t(sortChoices.find(([sort]) => sort === current)?.[1] ?? 'groupSortManual'),
            opensPage: true,
            disabled,
            onClick: () => panel.push({
              title: this.t('groupSort'),
              build: (inner) => sortChoices.map(([sort, key]) => panelRow({
                label: this.t(key),
                testId: `database-group-sort-${sort}`,
                checked: (settings().sort ?? defaultGroupSort(property.type)) === sort,
                onClick: () => {
                  setSettings({ sort });
                  inner.back();
                },
              })),
            }),
          }));
        }
        rows.push(panelSwitch({
          label: this.t('groupHideEmpty'),
          testId: 'database-group-hide-empty',
          checked: settings().hideEmptyGroups === true,
          disabled,
          onToggle: (next) => setSettings({ hideEmptyGroups: next }),
        }));
        if (view.type === 'board' && !sub && (property.type === 'select' || property.type === 'multiSelect' || property.type === 'status')) {
          rows.push(panelSwitch({
            label: this.t('groupColorColumns'),
            testId: 'database-group-color-columns',
            checked: settings().colorColumns !== false,
            disabled,
            onToggle: (next) => setSettings({ colorColumns: next }),
          }));
        }

        const groups = this.ctx.groups(sub);
        const hidden = (key: string): boolean =>
          isGroupHidden(this.ctx.view(), stateKey(key));
        const allHidden = groups.length > 0 && groups.every((g) => hidden(g.key));

        // notion-motion.md, Round 8c "Hidden groups": Hide all on the Groups label, then each group's pill and eye.
        const header = document.createElement('div');
        const hideAll = document.createElement('button');

        header.setAttribute('data-blok-database-property-visibility-header', '');
        hideAll.type = 'button';
        hideAll.setAttribute('data-blok-database-property-hide-all', '');
        hideAll.setAttribute('data-blok-testid', 'database-group-hide-all');
        hideAll.textContent = this.t(allHidden ? 'groupShowAll' : 'groupHideAll');
        hideAll.disabled = disabled;
        hideAll.addEventListener('click', refreshAfter(() => this.ctx.updateView({
          ...withGroupFlags(this.ctx.view(), groups.map((g) => stateKey(g.key)), { hidden: !allHidden }),
        })));
        header.append(panelLabel(this.t('groupGroups')), hideAll);
        rows.push(
          panelSeparator(),
          header,
          ...groups.map((group) => this.groupVisibilityRow(group, hidden(group.key), disabled, refreshAfter(() => this.ctx.updateView({
            ...withGroupFlags(this.ctx.view(), [stateKey(group.key)], { hidden: !hidden(group.key) }),
          })))),
        );
        if (view.type !== 'board' || sub) {
          rows.push(panelSeparator(), panelRow({
            label: this.t('groupRemove'),
            testId: sub ? 'database-subgroup-remove' : 'database-group-remove',
            icon: IconTrash,
            danger: true,
            disabled,
            onClick: () => {
              this.ctx.updateView(sub ? { subGroupBy: undefined } : { groupBy: undefined });
              panel.back();
            },
          }));
        }

        return rows;
      },
    };
  }

  /**
   * research/22 §7, shots 37/38: "Number by" opens its own page, and the Range
   * fields sit there, never on the Group page. Notion's Range page shows no
   * Unique/Range rows; how it switches back is unmeasured, so Blok keeps them.
   */
  private numberByRow(
    panel: DatabasePanel,
    settings: () => GroupSettings,
    set: (patch: Partial<GroupSettings>) => void,
    disabled: boolean
  ): HTMLElement {
    const choices = [['unique', 'groupNumberUnique'], ['range', 'groupNumberRange']] as const;
    const numberBy = (): 'unique' | 'range' => settings().numberBy ?? 'unique';

    return panelRow({
      label: this.t('groupNumberBy'),
      testId: 'database-group-number-by',
      value: this.t(numberBy() === 'range' ? 'groupNumberRange' : 'groupNumberUnique'),
      opensPage: true,
      disabled,
      onClick: () => panel.push({
        title: this.t('groupNumberBy'),
        returnFocus: 'database-group-number-by',
        build: (inner) => {
          const rows: HTMLElement[] = choices.map(([value, key]) => panelRow({
            label: this.t(key),
            testId: `database-group-number-by-${value}`,
            checked: numberBy() === value,
            disabled,
            onClick: () => {
              set({ numberBy: value });
              inner.refresh();
            },
          }));

          if (numberBy() === 'range') rows.push(...this.rangeFields(settings(), set));

          return rows;
        },
      }),
    });
  }

  private rangeFields(settings: GroupSettings, set: (patch: Partial<GroupSettings>) => void): HTMLElement[] {
    const defaults = { rangeStart: DEFAULT_RANGE.start, rangeEnd: DEFAULT_RANGE.end, rangeSize: DEFAULT_RANGE.size };
    const current = { ...settings };
    // rangeOf, as the group keys and names use, so the line matches the real groups.
    const example = (): string => {
      const { start, size } = rangeOf(current);

      return this.t('groupRangeExample', { start, middle: start + size, end: start + 2 * size });
    };
    const note = panelText(example());

    note.setAttribute('data-blok-testid', 'database-group-range-example');

    const numberInput = (field: 'rangeStart' | 'rangeEnd' | 'rangeSize', labelKey: string): HTMLElement => panelInput({
      value: String(typeof settings[field] === 'number' ? settings[field] : defaults[field]),
      placeholder: this.t(labelKey),
      label: this.t(labelKey),
      testId: `database-group-${field}`,
      onInput: (text) => {
        const n = Number(text);

        if (text.trim() === '' || !Number.isFinite(n)) return;
        current[field] = n;
        note.textContent = example();
        set({ [field]: n });
      },
    });
    const pair = document.createElement('div');
    const dash = document.createElement('span');

    pair.setAttribute('data-blok-database-range-pair', '');
    dash.setAttribute('aria-hidden', 'true');
    dash.textContent = '–';
    pair.append(numberInput('rangeStart', 'groupRangeStart'), dash, numberInput('rangeEnd', 'groupRangeEnd'));

    return [panelLabel(this.t('groupRange')), pair, panelLabel(this.t('groupRangeEvery')), numberInput('rangeSize', 'groupRangeEvery'), note];
  }

  private groupTypeRows(
    panel: DatabasePanel,
    property: PropertyDefinition,
    liveSettings: () => GroupSettings,
    set: (patch: Partial<GroupSettings>) => void,
    disabled: boolean
  ): HTMLElement[] {
    const settings = liveSettings();
    const choice = <K extends keyof GroupSettings>(
      testId: string,
      labelKey: string,
      field: K,
      options: ReadonlyArray<readonly [NonNullable<GroupSettings[K]>, string]>,
      fallback: NonNullable<GroupSettings[K]>
    ): HTMLElement => {
      const current = settings[field] ?? fallback;

      return panelRow({
        label: this.t(labelKey),
        testId,
        value: this.t(options.find(([value]) => value === current)?.[1] ?? labelKey),
        opensPage: true,
        disabled,
        onClick: () => panel.push({
          title: this.t(labelKey),
          build: (inner) => options.map(([value, key]) => panelRow({
            label: this.t(key),
            testId: `${testId}-${String(value)}`,
            checked: (settings[field] ?? fallback) === value,
            onClick: () => {
              set({ [field]: value });
              inner.back();
            },
          })),
        }),
      });
    };

    switch (property.type) {
      case 'date':
        return [
          choice('database-group-date-by', 'groupDateBy', 'dateBy', [
            ['relative', 'groupDateRelative'], ['day', 'groupDateDay'], ['week', 'groupDateWeek'], ['month', 'groupDateMonth'], ['year', 'groupDateYear'],
          ], 'relative'),
          choice('database-group-week-start', 'groupWeekStart', 'weekStart', [[0, 'groupWeekSunday'], [1, 'groupWeekMonday']], 0),
        ];
      case 'number':
        return [this.numberByRow(panel, liveSettings, set, disabled)];
      case 'title':
      case 'text':
      case 'url':
      case 'email':
      case 'phone':
        return [choice('database-group-text-by', 'groupTextBy', 'textBy', [['exact', 'groupTextExact'], ['alphabet', 'groupTextAlphabet']], 'exact')];
      case 'createdTime':
      case 'lastEditedTime':
        return [
          choice('database-group-date-by', 'groupDateBy', 'dateBy', [
            ['relative', 'groupDateRelative'], ['day', 'groupDateDay'], ['week', 'groupDateWeek'], ['month', 'groupDateMonth'], ['year', 'groupDateYear'],
          ], 'relative'),
        ];
      // research/08: select, multi-select, checkbox and person have no "by" row; status's
      // "Status by" is built by the caller because it writes the view, not these settings.
      case 'select':
      case 'multiSelect':
      case 'status':
      case 'checkbox':
      case 'person':
      case 'createdBy':
      case 'lastEditedBy':
      case 'relation':
        return [];
      // Not groupable (GROUPABLE_TYPES): Notion leaves Files and ID out of "Group by".
      case 'files':
      case 'uniqueId':
      case 'richText':
      // The panel gets formula and rollup as their result type.
      case 'formula':
      case 'rollup':
      case 'button':
      case 'place':
      case 'verification':
        return [];
    }
  }

  // ─── Conditional color ───

  /**
   * A color rule card's head, the simple filter popover's (notion-motion.md Round 20 §4, r20-cc-sel.raw):
   * "Select is not empty ⌄", the operator in a 190-wide flyout, then a trash that deletes at once.
   * A Date rule leads with "Start date ⌄" and a Name rollup with "any ⌄", as the advanced filter's rule.
   */
  private colorRuleHeader(
    panel: DatabasePanel,
    rule: ColorRule,
    property: PropertyDefinition | undefined,
    disabled: boolean,
    update: (change: Partial<ColorRule>) => void,
    remove: () => void
  ): HTMLElement {
    const header = document.createElement('div');
    const lead = document.createElement('span');
    const trash = document.createElement('button');
    // A flyout list under the button, 190 wide, as the filter popover's operator (Round 18 §2).
    const headerButton = (testId: string, label: string, flyoutId: string, rows: (pick: (write: () => void) => void) => HTMLElement[], name?: string): HTMLButtonElement => {
      const button = document.createElement('button');
      const text = document.createElement('span');
      const chevron = document.createElement('span');

      button.type = 'button';
      button.disabled = disabled;
      button.setAttribute('data-blok-database-chip-operator', '');
      button.setAttribute('data-blok-testid', testId);
      text.setAttribute('data-blok-database-chip-operator-label', '');
      text.textContent = label;
      chevron.setAttribute('aria-hidden', 'true');
      chevron.innerHTML = IconChevronDown;
      if (name !== undefined) button.append(name, ' ');
      button.append(text, chevron);
      button.addEventListener('click', () => openFlyout(button, panel, flyoutId, OPERATOR_FLYOUT_WIDTH, rows));

      return button;
    };
    const choice = (testId: string, label: string, checked: boolean, change: Partial<ColorRule>, pick: (write: () => void) => void): HTMLElement => panelRow({
      label,
      testId,
      checked,
      onClick: () => pick(() => {
        update(change);
        panel.refresh();
      }),
    });

    header.setAttribute('data-blok-database-chip-header', '');
    header.setAttribute('data-blok-database-color-rule-header', '');
    if (property === undefined) {
      lead.textContent = this.t('filterGone');
    } else {
      const { lead: part, operator: inner } = splitOperator(rule.operator);
      const opKey = operatorLabelKey(property.type, rule.operator);
      const plain = property.type !== 'date' && !isQuantifiedText(property, rule.operator);

      if (property.type === 'date') {
        lead.append(headerButton(`database-color-side-${rule.id}`, this.t(part === 'end' ? 'dateEnd' : 'dateStart'), 'database-filter-side-picker', (pick) => (['start', 'end'] as const).map((side) =>
          choice(`database-filter-side-${side}`, this.t(side === 'end' ? 'dateEnd' : 'dateStart'), (part === 'end') === (side === 'end'), { operator: joinOperator(side === 'end' ? 'end' : undefined, inner) }, pick))));
      } else if (!plain) {
        lead.append(property.name, ' ', headerButton(`database-color-quantifier-${rule.id}`, this.ctx.i18n.t(`tools.database.filterOperator.${part ?? 'any'}`).toLocaleLowerCase(), 'database-filter-quantifier-picker', (pick) => quantifierChoices().map((q) =>
          choice(`database-filter-quantifier-${q.operator}`, this.ctx.i18n.t(q.labelKey), (part ?? 'any') === q.operator, { operator: joinOperator(q.operator, inner) }, pick))));
      }
      lead.append(headerButton(`database-color-operator-${rule.id}`, (opKey === undefined ? rule.operator : this.ctx.i18n.t(opKey)).toLocaleLowerCase(), 'database-filter-operator-picker', (pick) => colorRuleOperatorChoices(property, rule.operator).map((c) =>
        choice(`database-filter-op-${c.operator}`, this.ctx.i18n.t(c.labelKey), menuOperatorOf(rule.operator) === c.operator, operatorPick(property, c.operator, rule), pick)), plain ? property.name : undefined));
    }
    trash.type = 'button';
    trash.disabled = disabled;
    trash.setAttribute('data-blok-database-color-rule-delete', '');
    trash.setAttribute('data-blok-testid', `database-color-delete-${rule.id}`);
    trash.setAttribute('aria-label', this.t('colorDelete'));
    trash.innerHTML = IconTrash;
    trash.addEventListener('click', remove);
    header.append(lead, trash);

    return header;
  }

  /**
   * The value under a color rule's head when its operator takes one (notion-motion.md Round 20 §4,
   * r20-cc-is.raw): a text field inline, anything else a field that opens the advanced filter's value flyout.
   * A color rule reads no row page, so "This page" is never offered.
   */
  private colorRuleValue(
    panel: DatabasePanel,
    rule: ColorRule,
    property: PropertyDefinition,
    disabled: boolean,
    read: () => ColorRule | undefined,
    update: (change: Partial<ColorRule>) => void
  ): HTMLElement[] {
    const save = (change: Partial<Pick<FilterConfig, 'operator' | 'value'>>): void => update(change.operator === undefined ? change : { ...change, operator: keepLead(read()?.operator ?? rule.operator, change.operator) });
    const controls = this.valueControls(property, rule, save, false);
    const [only] = controls;

    if (controls.length === 0) return [];
    if (controls.length === 1 && only instanceof HTMLInputElement) {
      only.disabled = disabled;
      only.setAttribute('data-blok-testid', `database-color-value-${rule.id}`);
      only.setAttribute('data-blok-database-color-rule-value', '');
      only.setAttribute('data-blok-database-color-rule-field', '');

      return [only];
    }
    // r20-cc-is.raw: a 240×34 button holds the 232×30 field, and the flyout opens under the button.
    const button = document.createElement('button');
    const field = document.createElement('span');
    const text = filterValueText(rule, property, (key, vars) => this.ctx.i18n.t(key, vars), (person) => this.personName(person), (row) => this.ctx.relatedRows?.(property).find((r) => r.id === row)?.title, editorLocale(this.ctx.i18n));
    const scoped: ViewSettingsContext = { ...this.ctx, thisPageDatabase: () => null };

    button.type = 'button';
    button.disabled = disabled;
    button.setAttribute('data-blok-database-color-rule-value', '');
    button.setAttribute('data-blok-testid', `database-color-value-${rule.id}`);
    button.toggleAttribute('data-empty', text === '');
    field.setAttribute('data-blok-database-color-rule-field', '');
    field.textContent = text === '' ? this.t('filterValue') : text;
    // r20-cc-is.raw, r20-cc-red.png: a Select rule reads "Select..." while empty and shows its picks as tokens.
    // Other types are unmeasured and keep "Value" and plain text.
    if (property.type === 'select') {
      const picked: unknown[] = Array.isArray(rule.value) ? rule.value : [];
      const tokens = (property.config?.options ?? []).filter((option) => picked.includes(option.id)).map((option) => createOptionPill(option));

      button.toggleAttribute('data-empty', tokens.length === 0);
      if (tokens.length === 0) field.textContent = this.t('colorValuePlaceholder');
      else field.replaceChildren(...tokens);
    }
    button.append(field);
    button.addEventListener('click', () => openRuleValueFlyout(button, panel, scoped, read, save, COLOR_VALUE_FLYOUT_WIDTH, COLOR_VALUE_FLYOUT_GAP));

    return [button];
  }

  /**
   * notion-motion.md Round 20 §4 (r20-cc-bg.raw, r20-cc-swatches.raw): a 190-wide flyout under the value.
   * A Select rule first gets a focused "Match option" switch and a divider; then 10 swatches with no names,
   * hinted "Blue background". A pick closes it. Blok marks the current swatch with a neutral ring, not
   * Notion's blue one (no-blue law); the switch stays blue (approved).
   */
  private colorPicker(
    anchor: HTMLButtonElement,
    panel: DatabasePanel,
    property: PropertyDefinition | undefined,
    current: () => string | undefined,
    write: (color: string) => void
  ): void {
    const picker = openFlyout(anchor, panel, 'database-color-background-picker', COLOR_PICKER_WIDTH, (pick) => {
      const grid = document.createElement('div');

      grid.setAttribute('data-blok-database-color-swatches', '');
      grid.append(...COLORS.map((color) => {
        const swatch = document.createElement('button');
        const chip = document.createElement('span');
        const hint = this.t('colorBackgroundHint', { color: this.t(`color${capital(color)}`) });

        swatch.type = 'button';
        swatch.setAttribute('data-blok-database-color-swatch', '');
        swatch.setAttribute('data-color', color);
        swatch.setAttribute('data-blok-testid', `database-color-pick-${color}`);
        swatch.setAttribute('aria-label', hint);
        swatch.setAttribute('aria-pressed', String(current() === color));
        chip.setAttribute('data-blok-database-color-chip', '');
        chip.setAttribute('data-color', color);
        swatch.append(chip);
        onHover(swatch, hint);
        swatch.addEventListener('click', () => pick(() => write(color)));

        return swatch;
      }));
      if (property === undefined || !MATCH_OPTION_TYPES.includes(property.type)) return [grid];

      // Turning it off is unmeasured: the rule takes Default, the first swatch.
      return [panelSwitch({
        label: this.t(matchOptionLabelKey(property)),
        testId: 'database-color-match-option',
        checked: current() === MATCH_OPTION_COLOR,
        onToggle: (on) => pick(() => write(on ? MATCH_OPTION_COLOR : 'default')),
      }), panelSeparator(), grid];
    });

    picker.root.querySelector<HTMLElement>('[data-blok-testid="database-color-match-option"]')?.focus();
  }


  private colors(): PanelPage {
    const rules = (): ColorRule[] => this.ctx.view().colorRules ?? [];
    const write = (next: ColorRule[]): void => this.ctx.updateView({ colorRules: next });
    const patch = (id: string, change: Partial<ColorRule>): void => write(rules().map((r) => (r.id === id ? { ...r, ...change } : r)));

    return {
      title: this.t('settingsConditionalColor'),
      build: (panel) => {
        const view = this.ctx.view();
        const schema = this.ctx.schema();
        const disabled = !this.shared;
        const cards = rules().map((rule) => {
          const property = schema.find((p) => p.id === rule.propertyId);
          const card = document.createElement('div');

          card.setAttribute('data-blok-database-color-rule', '');
          card.setAttribute('data-blok-testid', `database-color-rule-${rule.id}`);
          card.append(
            this.colorRuleHeader(panel, rule, property, disabled, (change) => patch(rule.id, change), () => {
              write(rules().filter((r) => r.id !== rule.id));
              panel.refresh();
            }),
            ...(property === undefined ? [] : this.colorRuleValue(panel, rule, property, disabled, () => rules().find((r) => r.id === rule.id), (change) => patch(rule.id, change))),
            colorSetting({
              label: this.t('colorPageBackground'),
              testId: `database-color-background-${rule.id}`,
              value: this.t(rule.color === MATCH_OPTION_COLOR ? matchOptionLabelKey(property) : `color${capital(rule.color)}`),
              chip: rule.color === MATCH_OPTION_COLOR ? undefined : rule.color,
              disabled,
              onClick: (button) => this.colorPicker(button, panel, property, () => rules().find((r) => r.id === rule.id)?.color, (color) => patch(rule.id, { color })),
            })
          );
          if (view.type === 'table') {
            card.appendChild(colorSetting({
              label: this.t('colorApplyTo'),
              testId: `database-color-apply-${rule.id}`,
              value: this.t(rule.applyTo === 'property' ? 'colorApplyProperty' : 'colorApplyRow'),
              disabled,
              onClick: (button) => openFlyout(button, panel, 'database-color-apply-picker', APPLY_FLYOUT_WIDTH, (pick) => (['row', 'property'] as const).map((applyTo) => panelRow({
                label: this.t(applyTo === 'property' ? 'colorApplyProperty' : 'colorApplyRow'),
                testId: `database-color-apply-${applyTo}`,
                checked: (rules().find((r) => r.id === rule.id)?.applyTo ?? 'row') === applyTo,
                onClick: () => pick(() => {
                  patch(rule.id, { applyTo });
                  panel.refresh();
                }),
              })), { fit: true }),
            }));
          }
          return { id: rule.id, element: card };
        });

        // notion-motion.md Round 20 §4 (r20-cc-new.raw): the property list is a 258-wide flyout, its search focused.
        // Notion keeps it 4px off the button.
        const add: HTMLElement = marked(panelRow({
          label: this.t(cards.length === 0 ? 'colorNew' : 'colorAddAnother'),
          testId: 'database-color-add',
          icon: IconPlus,
          disabled,
          onClick: () => openFlyout(add, panel, 'database-color-property-picker', COLOR_PROPERTY_FLYOUT_WIDTH, (pick) => this.propertyPicker(queryState(), COLOR_RULE_TYPES, (property) => pick(() => {
            write([...rules(), { id: nanoid(), propertyId: property.id, ...newColorRule(property.type) }]);
            panel.refresh();
          })), { gap: COLOR_PROPERTY_FLYOUT_GAP }),
        }), cards.length === 0 ? 'data-blok-database-color-new' : 'data-blok-database-color-add-another');

        // notion-motion.md Round 20 §4: the intro text shows only while there is no rule.
        return [
          ...(cards.length === 0 ? [panelText(this.t('colorBlurb'))] : []),
          // notion-motion.md Round 20 §4: the list order is each cell's priority; a ⠿ handle reorders it.
          // A locked view cannot reorder: the cards stand in a plain list.
          ...(cards.length > 0 && disabled ? [plainColorRules(cards.map((card) => card.element))] : []),
          ...(cards.length === 0 || disabled ? [] : [marked(panelReorderList({
            testId: 'database-color-rules',
            handleLabel: this.t('settingsDragToReorder'),
            items: cards,
            onMove: (id, beforeId) => {
              const all = rules();
              const moving = all.find((r) => r.id === id);
              const rest = all.filter((r) => r.id !== id);
              const at = beforeId === null ? rest.length : rest.findIndex((r) => r.id === beforeId);

              if (moving !== undefined) write([...rest.slice(0, at), moving, ...rest.slice(at)]);
            },
          }), 'data-blok-database-color-rules')]),
          add,
        ];
      },
    };
  }
}

/** notion-motion.md Round 20 §2 (r20-adv-*-parts.raw): what an empty advanced value asks for, per type. */
const VALUE_PLACEHOLDER_KEYS: Partial<Record<PropertyType, string>> = {
  select: 'tools.database.filterSelectOption',
  multiSelect: 'tools.database.filterSelectOption',
  status: 'tools.database.filterSelectOption',
  checkbox: 'tools.database.filterSelectValue',
  person: 'tools.database.filterSelectPeople',
  createdBy: 'tools.database.filterSelectPeople',
  lastEditedBy: 'tools.database.filterSelectPeople',
  relation: 'tools.database.filterSelectPage',
  date: 'tools.database.filterSelectDate',
  createdTime: 'tools.database.filterSelectDate',
  lastEditedTime: 'tools.database.filterSelectDate',
};

const ISO_DAY_VALUE = /^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2})?$/;

const rulesOf = (group: FilterGroup): FilterRule[] =>
  group.filterRules.flatMap((node) => (isFilterGroup(node) ? rulesOf(node) : [node]));

/** The rule cards without handles, for a locked view. */
const plainColorRules = (cards: HTMLElement[]): HTMLElement => {
  const list = marked(document.createElement('div'), 'data-blok-database-color-rules');

  list.append(...cards);

  return list;
};

/** Sets a bare attribute database.css styles the element by. */
const marked = <T extends HTMLElement>(element: T, attribute: string): T => {
  element.setAttribute(attribute, '');

  return element;
};

/**
 * What a new colour rule starts on (notion-motion.md Round 20 §4, Round 21 §1): option types on
 * Match option, the five types read on Green. The rest keep gray: unread.
 * Checkbox starts on "is" with no value; every type's flyout offers "is not empty" otherwise.
 */
const GREEN_RULE_TYPES: readonly PropertyType[] = ['text', 'number', 'date', 'checkbox', 'person'];

const newColorRule = (type: PropertyType): Pick<ColorRule, 'operator' | 'value' | 'color'> => {
  const plain = GREEN_RULE_TYPES.includes(type) ? 'green' : 'gray';

  return {
    operator: type === 'checkbox' ? 'equals' : 'is_not_empty',
    value: null,
    color: MATCH_OPTION_TYPES.includes(type) ? MATCH_OPTION_COLOR : plain,
  };
};

/** notion-motion.md Round 21 §1 (r21-cc-ms-bg.raw): Multi-select's switch reads "Match first option". */
const matchOptionLabelKey = (property: PropertyDefinition | undefined): string =>
  (property?.type === 'multiSelect' ? 'colorMatchFirstOption' : 'colorMatchOption');

/** notion-motion.md Round 20 §4 (r20-cc-new.raw, r20-cc-srch.raw): the property list is 258 wide, 4px off its button. */
const COLOR_PROPERTY_FLYOUT_WIDTH = 258;
const COLOR_PROPERTY_FLYOUT_GAP = 4;

/** notion-motion.md Round 20 §4 (r20-cc-selval.raw): a colour rule's value flyout is 240 wide. */
const COLOR_VALUE_FLYOUT_WIDTH = 240;
/** r20-cc-is.raw, r20-cc-selval.raw: the button ends at 493, the flyout starts at 497. */
const COLOR_VALUE_FLYOUT_GAP = 4;

/** notion-motion.md Round 20 §4 (r20-cc-bg.raw): the colour picker is 190 wide. */
const COLOR_PICKER_WIDTH = 190;

/** notion-motion.md Round 20 §4 (r20-cc-apply.raw): 112.6 wide in English; a longer label widens it. */
const APPLY_FLYOUT_WIDTH = 112;

/**
 * A conditional color card's "Page background" / "Apply to" line. Only the
 * value is a button, and its flyout opens under it (notion-motion.md Round 20 §4).
 */
const colorSetting = (options: { label: string; testId: string; value: string; chip?: string; disabled: boolean; onClick: (button: HTMLButtonElement) => void }): HTMLElement => {
  const line = document.createElement('div');
  const label = document.createElement('span');
  const button = document.createElement('button');
  const text = document.createElement('span');
  const chevron = document.createElement('span');

  line.setAttribute('data-blok-database-color-setting', '');
  label.setAttribute('data-blok-database-color-setting-label', '');
  label.textContent = options.label;
  button.type = 'button';
  button.setAttribute('data-blok-database-color-setting-value', '');
  button.setAttribute('data-blok-testid', options.testId);
  button.setAttribute('aria-label', `${options.label}: ${options.value}`);
  button.disabled = options.disabled;
  text.textContent = options.value;
  chevron.setAttribute('aria-hidden', 'true');
  chevron.innerHTML = IconChevronRight;
  if (options.chip !== undefined) {
    const chip = document.createElement('span');

    chip.setAttribute('data-blok-database-color-chip', '');
    chip.setAttribute('data-color', options.chip);
    chip.setAttribute('aria-hidden', 'true');
    button.append(chip);
  }
  button.append(text, chevron);
  button.addEventListener('click', () => options.onClick(button));
  line.append(label, button);

  return line;
};

const findRule = (group: FilterGroup, id: string): FilterRule | undefined => {
  for (const node of group.filterRules) {
    if (!isFilterGroup(node) && node.id === id) return node;
    const found = isFilterGroup(node) ? findRule(node, id) : undefined;

    if (found !== undefined) return found;
  }

  return undefined;
};

/** Notion's group sort menus per type (research/08). Checkbox has none. */
const groupSortChoices = (type: PropertyType): Array<readonly [GroupSort, string]> => {
  switch (type) {
    case 'date':
    case 'createdTime':
    case 'lastEditedTime':
      return [['ascending', 'groupSortOldest'], ['descending', 'groupSortNewest']];
    case 'number': return [['ascending', 'groupSortAscending'], ['descending', 'groupSortDescending']];
    case 'select':
    case 'multiSelect':
    case 'title':
    case 'text':
    case 'url':
    case 'email':
    case 'phone':
      return [['manual', 'groupSortManual'], ['ascending', 'groupSortAlphabetical'], ['descending', 'groupSortReverse']];
    case 'status':
      return [['manual', 'groupSortManual'], ['ascending', 'groupSortAscending'], ['descending', 'groupSortDescending']];
    case 'checkbox':
    case 'person':
    case 'createdBy':
    case 'lastEditedBy':
    case 'relation':
      return [];
    // Not groupable (GROUPABLE_TYPES).
    case 'files':
    case 'uniqueId':
    case 'richText':
    case 'formula':
    case 'rollup':
    case 'button':
    case 'place':
    case 'verification':
      return [];
  }
};

const idList = (value: FilterConfig['value']): string[] => {
  if (Array.isArray(value)) return value.flatMap((entry) => (typeof entry === 'string' ? [entry] : []));

  return typeof value === 'string' && value !== '' ? [value] : [];
};

/** `rename` is the root with the name field focused and selected (findings V08). */
export type ViewSettingsStart = 'root' | 'rename' | 'filter' | 'sort' | 'group' | 'layout' | 'properties' | 'automations' | 'autofill';

/** Opens the view settings panel under `anchor`, at `start`. */
export const openViewSettings = (
  anchor: HTMLElement,
  ctx: ViewSettingsContext,
  start: ViewSettingsStart = 'root',
  onClose?: (escape: boolean) => void
): DatabasePanel => {
  const pages = new ViewSettingsPages(ctx);
  const root = {
    root: (): PanelPage => pages.root(),
    rename: (): PanelPage => pages.root(),
    filter: (): PanelPage => pages.filters(),
    sort: (): PanelPage => pages.sorts(),
    group: (): PanelPage => pages.group(false),
    layout: (): PanelPage => pages.layout(),
    properties: (): PanelPage => pages.properties(),
    automations: (): PanelPage => ctx.automations === undefined ? pages.root() : automationListPage(ctx.automations, ctx.i18n),
    autofill: (): PanelPage => ctx.autofill === undefined ? pages.root() : pages.autofillList(ctx.autofill),
  }[start]();
  const panel = new DatabasePanel({
    anchor,
    root,
    testId: 'database-view-settings',
    width: 290,
    backLabel: ctx.i18n.t('tools.database.settingsBack'),
    docked: true,
    closeLabel: ctx.i18n.t('tools.database.close'),
    ...(onClose !== undefined ? { onClose } : {}),
  });

  panel.open();
  if (start === 'rename') {
    const name = panel.root.querySelector<HTMLInputElement>('[data-blok-testid="database-settings-view-name"]');

    name?.focus();
    name?.select();
  }

  return panel;
};

/** Opens one simple filter's popover (research/08: 220 wide). */
/** The Filter page on its own: a button's "Edit pages in" filter reuses it (research/17 §3c). */
export const openFilterList = (anchor: HTMLElement, ctx: ViewSettingsContext, testId: string): DatabasePanel => {
  const panel = new DatabasePanel({
    anchor,
    root: new ViewSettingsPages(ctx).filters(),
    testId,
    width: 290,
    backLabel: ctx.i18n.t('tools.database.settingsBack'),
  });

  panel.open();

  return panel;
};

/** notion-motion.md Round 19 §1 (r19-adv-rulemore.raw, r19-adv-groupmore.raw): the rule and group ⋯ menus. */
const RULE_MORE_WIDTH = 150.8;
/** notion-motion.md Round 19 §1 (r19-adv-andor.raw). */
const CONJUNCTION_FLYOUT_WIDTH = 190.2;
const GROUP_MORE_WIDTH = 232.4;
/** A group Blok makes (add, turn into, wrap). Round 19 §1 saw "Or" in a new group once (r19-adv-group2.raw). */
const NEW_GROUP_CONJUNCTION = 'or';

/** notion-motion.md Round 18 §2 (r18-adv-addrule.raw): the "+ Add filter rule ⌄" menu. */
const ADD_MENU_WIDTH = 206.9;

/** The advanced filter on its own: "+ Filter"'s "Add advanced filter" footer opens it. */
export const openAdvancedFilter = (anchor: HTMLElement, ctx: ViewSettingsContext, onClose?: (escape: boolean) => void, host?: DatabasePanel): DatabasePanel => {
  const release = host?.hold();
  const panel = new DatabasePanel({
    anchor,
    root: new ViewSettingsPages(ctx).advanced(false),
    testId: 'database-advanced-filter',
    // The floor under the rules' width (advanced() fits its content). Blok's old fixed width, unmeasured in Notion.
    width: 290,
    // notion-motion.md Round 18 §2 (r18-adv-open.raw): 4px under the "1 rule" chip.
    gap: 4,
    backLabel: ctx.i18n.t('tools.database.settingsBack'),
    onClose: (escape) => {
      release?.();
      onClose?.(escape);
    },
  });

  host?.own(panel);
  panel.open();

  return panel;
};

export const openFilterPill = (anchor: HTMLElement, ctx: ViewSettingsContext, filterId: string, onClose?: () => void): DatabasePanel => {
  const panel = new DatabasePanel({
    anchor,
    root: new ViewSettingsPages(ctx).simpleFilter(filterId),
    testId: 'database-filter-popover',
    width: 220,
    backLabel: ctx.i18n.t('tools.database.settingsBack'),
    ...(onClose !== undefined ? { onClose } : {}),
  });

  panel.open();

  return panel;
};

