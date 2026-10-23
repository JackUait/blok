import { IconBolt, IconCalendar, IconCheck, IconChevronUpDown, IconCopy, IconCross, IconDatabase, IconDotsHorizontal, IconEyeSlash, IconFilter, IconGallery, IconLink, IconLock, IconPaintRoller, IconPlus, IconPreview, IconReplace, IconSort, IconTable, IconTrash, IconWand } from '../../components/icons';
import type { I18n } from '../../../types';
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
import { propertyTypeMeta } from './database-property-types';
import {
  FILTERABLE_TYPES,
  WITHIN_OPERATORS,
  defaultFilterFor,
  filterPillLabel,
  menuOperatorOf,
  operatorChoicesFor,
  operatorLabelKey,
  operatorNeedsValue,
  relativeValueLabelKey,
  sortDirectionLabelKey,
  withinLabelKey,
} from './database-filter-labels';
import {
  MAX_FILTER_DEPTH,
  addFilterGroup,
  addFilterRule,
  countFilterRules,
  emptyFilterTree,
  filterGroupDepth,
  isFilterGroup,
  removeFilterNode,
  setFilterConjunction,
  updateFilterRule,
  withEntryIds,
} from './filter-tree';
import { DEFAULT_RANGE, GROUPABLE_TYPES, defaultGroupSort, groupByChange, rangeOf, subGroupByChange } from './group-keys';
import { RELATIVE_DATE_UNITS, RELATIVE_DATE_VALUES, formatRelativeSpan, parseRelativeSpan } from './relative-dates';
import { ME_FILTER_VALUE, THIS_PAGE_FILTER_VALUE } from './database-query';
import { COLOR_RULE_LAYOUTS, COLOR_RULE_TYPES, isGroupHidden, withGroupFlags } from './view-data';
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
import { dateRuleControls, operatorPick } from './database-filter-chip';
import { VIEW_ICONS } from './database-tab-bar';
import type { AutomationSettings } from './database-automations-panel';
import { offersAutofill } from './property-values';
import { MAP_HEIGHTS, resolveMapBy, resolveMapHeight } from './database-map-view';

export interface ViewGroupEntry {
  key: string;
  label: string;
  count: number;
}

/** What the panels ask of the database tool. */
export interface ViewSettingsContext {
  i18n: Pick<I18n, 't'>;
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
          ...countValue(view.filters.length + countFilterRules(view.filterTree)),
          opensPage: true,
          onClick: () => panel.push(this.filters()),
        });
        // A map has no Sort, Group or Property visibility (research/20 §1f).
        const rows: HTMLElement[] = isMap ? [
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
        ] : [
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
            ...countValue(view.sorts.length),
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
        if (COLOR_RULE_LAYOUTS.includes(view.type)) {
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

  private pickProperty(title: string, types: readonly PropertyType[], onPick: (property: PropertyDefinition) => void): PanelPage {
    const query = queryState();

    return {
      title,
      build: () => this.propertyPicker(query, types, onPick),
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
    options: { leading?: () => HTMLElement[]; disabled?: boolean } = {}
  ): HTMLElement[] {
    const list = document.createElement('div');
    const fill = (): void => {
      const needle = query.get().trim().toLowerCase();
      const choices = this.ctx.schema()
        .filter((p) => types.includes(p.type) && p.name.toLowerCase().includes(needle))
        .sort((a, b) => Number(b.type === 'title') - Number(a.type === 'title') || a.name.localeCompare(b.name));

      list.replaceChildren(...(options.leading?.() ?? []), ...choices.map((property) => panelRow({
        label: property.name,
        testId: `database-pick-property-${property.id}`,
        icon: propertyTypeMeta(property.type).icon,
        disabled: options.disabled === true,
        onClick: () => onPick(property),
      })));
    };
    const search = panelInput({
      value: query.get(),
      placeholder: this.t('settingsSearchProperty'),
      label: this.t('settingsSearchProperty'),
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

    return {
      title: this.t('settingsFilter'),
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
            }),
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

          return [{
            id: filter.id,
            element: panelRow({
              label: filterPillLabel(filter, property, (key, vars) => this.ctx.i18n.t(key, vars), (id) => this.personName(id), (id) => this.ctx.relatedRows?.(property).find((row) => row.id === id)?.title),
              testId: `database-filter-row-${filter.id}`,
              opensPage: true,
              onClick: () => panel.push(this.simpleFilter(filter.id)),
            }),
          }];
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
            })),
          }),
          panelSeparator(),
          panelRow({
            label: this.t('filterAdvanced'),
            testId: 'database-filter-advanced',
            value: String(countFilterRules(view.filterTree)),
            opensPage: true,
            onClick: () => panel.push(this.advanced()),
          })
        );

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
    /** A color rule reads no row page, so "This page" would never match there. */
    noThisPage?: boolean;
  }): PanelPage {
    return {
      build: (panel) => {
        const current = rule.read();
        const property = this.property(current?.propertyId);

        if (current === undefined || property === undefined) {
          return [panelText(this.t('filterGone'))];
        }
        const opKey = operatorLabelKey(property.type, current.operator);
        const rows: HTMLElement[] = [
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
            rule.update(patch);
            panel.refresh();
          }, rule.noThisPage !== true),
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
      build: () => operatorChoicesFor(property).map((choice) => panelRow({
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
    const { operator, value } = filter;
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

  private advanced(): PanelPage {
    // Keep rule ids stable until the first edit saves the tree.
    const view = this.ctx.view();
    const fallback = { ...emptyFilterTree(), filterRules: withEntryIds(view.filters) };
    const tree = (): FilterGroup => this.ctx.view().filterTree ?? fallback;
    const write = (next: FilterGroup): void => this.ctx.updatePersonal({
      ...(view.filterTree === undefined ? { filters: [] } : {}),
      filterTree: next,
    });

    return {
      title: this.t('filterAdvanced'),
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
    const schema = this.ctx.schema();

    group.filterRules.forEach((node, index) => {
      const prefix = this.conjunctionLabel(panel, group, index, tree, write);

      if (isFilterGroup(node)) {
        const box = document.createElement('div');

        box.setAttribute('data-blok-database-filter-group', '');
        box.setAttribute('data-blok-testid', `database-filter-group-${node.id}`);
        box.append(prefix, ...this.groupRows(panel, node, layer + 1, tree, write), panelRow({
          label: this.t('filterDeleteGroup'),
          testId: `database-filter-delete-group-${node.id}`,
          icon: IconTrash,
          danger: true,
          onClick: () => {
            write(removeFilterNode(tree(), node.id));
            panel.refresh();
          },
        }));
        rows.push(box);

        return;
      }
      const property = schema.find((p) => p.id === node.propertyId);
      const line = document.createElement('div');

      line.setAttribute('data-blok-database-filter-rule', '');
      line.append(prefix, panelRow({
        label: property === undefined ? this.t('filterGone') : filterPillLabel(node, property, (key, vars) => this.ctx.i18n.t(key, vars), (id) => this.personName(id), (id) => this.ctx.relatedRows?.(property).find((row) => row.id === id)?.title),
        testId: `database-filter-rule-${node.id}`,
        opensPage: true,
        onClick: () => panel.push(this.ruleEditor({
          read: () => findRule(tree(), node.id),
          update: (patch) => write(updateFilterRule(tree(), node.id, patch)),
          remove: () => write(removeFilterNode(tree(), node.id)),
        })),
      }));
      rows.push(line);
    });

    rows.push(panelRow({
      label: this.t('filterAddRule'),
      testId: `database-filter-add-rule-${group.id}`,
      icon: IconPlus,
      onClick: () => panel.push(this.pickProperty(this.t('filterAddRule'), FILTERABLE_TYPES, (property) => {
        const { id: _id, ...condition } = defaultFilterFor(property);

        write(addFilterRule(tree(), group.id, { id: nanoid(), ...condition }));
        panel.back();
      })),
    }));
    if (layer < MAX_FILTER_DEPTH && filterGroupDepth(tree(), group.id) < MAX_FILTER_DEPTH) {
      rows.push(panelRow({
        label: this.t('filterAddGroup'),
        testId: `database-filter-add-group-${group.id}`,
        icon: IconPlus,
        onClick: () => {
          write(addFilterGroup(tree(), group.id, { id: nanoid(), conjunction: 'and', filterRules: [] }));
          panel.refresh();
        },
      }));
    }

    return rows;
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

    return panelRow({
      label,
      testId: `database-filter-conjunction-${group.id}`,
      opensPage: true,
      onClick: () => panel.push({
        build: (inner) => (['and', 'or'] as const).flatMap((conjunction) => [
          panelRow({
            label: this.t(conjunction === 'or' ? 'filterOr' : 'filterAnd'),
            testId: `database-filter-conjunction-${conjunction}`,
            checked: group.conjunction === conjunction,
            onClick: () => {
              write(setFilterConjunction(tree(), group.id, conjunction));
              inner.back();
            },
          }),
          panelText(this.t(conjunction === 'or' ? 'filterOrDescription' : 'filterAndDescription')),
        ]),
      }),
    });
  }

  // ─── Sorts ───

  sorts(): PanelPage {
    const pickState = queryState();

    return {
      title: this.t('settingsSort'),
      build: (panel) => {
        const schema = this.ctx.schema();
        const sorts = withEntryIds(this.ctx.view().sorts);
        const write = (next: SortConfig[]): void => {
          this.ctx.updatePersonal({ sorts: next });
          panel.refresh();
        };

        // findings V15: with no sort yet, the page is the property picker.
        if (sorts.length === 0) {
          return this.propertyPicker(pickState, GROUPABLE_TYPES, (property) => write([{ id: nanoid(), propertyId: property.id, direction: 'asc' }]));
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
          line.append(
            panelRow({
              label: property.name,
              testId: `database-sort-property-${sort.id}`,
              icon: propertyTypeMeta(property.type).icon,
              opensPage: true,
              onClick: () => panel.push(this.pickProperty(this.t('settingsSort'), GROUPABLE_TYPES, (picked) => {
                this.ctx.updatePersonal({ sorts: withEntryIds(this.ctx.view().sorts).map((s) => (s.id === sort.id ? { ...s, propertyId: picked.id } : s)) });
                panel.back();
              })),
            }),
            panelRow({
              label: this.ctx.i18n.t(sortDirectionLabelKey(property.type, sort.direction)),
              testId: `database-sort-direction-${sort.id}`,
              onClick: () => write(sorts.map((s) => (s.id === sort.id ? { ...s, direction: s.direction === 'asc' ? 'desc' : 'asc' } : s))),
            }),
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
              const moving = sorts.find((s) => s.id === id);
              const rest = sorts.filter((s) => s.id !== id);
              const at = beforeId === null ? rest.length : rest.findIndex((s) => s.id === beforeId);

              if (moving !== undefined) write([...rest.slice(0, at), moving, ...rest.slice(at)]);
            },
          }),
          panelRow({
            label: this.t('sortAdd'),
            testId: 'database-sort-add',
            muted: true,
            icon: IconPlus,
            onClick: () => panel.push(this.pickProperty(this.t('sortAdd'), GROUPABLE_TYPES, (property) => {
              this.ctx.updatePersonal({ sorts: [...sorts, { id: nanoid(), propertyId: property.id, direction: 'asc' }] });
              panel.back();
            })),
          }),
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

    return {
      title: this.t(sub ? 'settingsSubGroup' : 'settingsGroup'),
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
            })),
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

        rows.push(
          panelSeparator(),
          panelLabel(this.t('groupGroups')),
          panelRow({
            label: this.t(allHidden ? 'groupShowAll' : 'groupHideAll'),
            testId: 'database-group-hide-all',
            disabled,
            onClick: refreshAfter(() => this.ctx.updateView({
              ...withGroupFlags(this.ctx.view(), groups.map((g) => stateKey(g.key)), { hidden: !allHidden }),
            })),
          }),
          ...groups.map((group) => panelSwitch({
            label: `${group.label} (${group.count})`,
            testId: `database-group-visible-${group.key}`,
            checked: !hidden(group.key),
            disabled,
            onToggle: (visible) => this.ctx.updateView({
              ...withGroupFlags(this.ctx.view(), [stateKey(group.key)], { hidden: !visible }),
            }),
          })),
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
            panelRow({
              label: property === undefined ? this.t('filterGone') : filterPillLabel(rule, property, (key, vars) => this.ctx.i18n.t(key, vars), (id) => this.personName(id), (id) => this.ctx.relatedRows?.(property).find((row) => row.id === id)?.title),
              testId: `database-color-condition-${rule.id}`,
              opensPage: true,
              disabled,
              onClick: () => panel.push(this.ruleEditor({
                read: () => rules().find((r) => r.id === rule.id),
                update: (change) => patch(rule.id, change),
                remove: () => write(rules().filter((r) => r.id !== rule.id)),
                noThisPage: true,
              })),
            }),
            panelRow({
              label: this.t('colorPageBackground'),
              testId: `database-color-background-${rule.id}`,
              value: this.t(`color${capital(rule.color)}`),
              opensPage: true,
              disabled,
              onClick: () => panel.push({
                title: this.t('colorPageBackground'),
                build: (inner) => COLORS.map((color) => {
                  const row = panelRow({
                    label: this.t(`color${capital(color)}`),
                    testId: `database-color-pick-${color}`,
                    checked: (rules().find((r) => r.id === rule.id)?.color ?? '') === color,
                    onClick: () => {
                      patch(rule.id, { color });
                      inner.back();
                    },
                  });

                  row.setAttribute('data-color', color);

                  return row;
                }),
              }),
            })
          );
          if (view.type === 'table') {
            card.appendChild(panelRow({
              label: this.t('colorApplyTo'),
              testId: `database-color-apply-${rule.id}`,
              value: this.t(rule.applyTo === 'property' ? 'colorApplyProperty' : 'colorApplyRow'),
              opensPage: true,
              disabled,
              onClick: () => panel.push({
                title: this.t('colorApplyTo'),
                build: (inner) => (['row', 'property'] as const).map((applyTo) => panelRow({
                  label: this.t(applyTo === 'property' ? 'colorApplyProperty' : 'colorApplyRow'),
                  testId: `database-color-apply-${applyTo}`,
                  checked: (rules().find((r) => r.id === rule.id)?.applyTo ?? 'row') === applyTo,
                  onClick: () => {
                    patch(rule.id, { applyTo });
                    inner.back();
                  },
                })),
              }),
            }));
          }
          card.appendChild(panelRow({
            label: this.t('colorDelete'),
            testId: `database-color-delete-${rule.id}`,
            icon: IconTrash,
            danger: true,
            disabled,
            onClick: () => {
              write(rules().filter((r) => r.id !== rule.id));
              panel.refresh();
            },
          }));

          return card;
        });

        return [
          panelText(this.t('colorBlurb')),
          ...cards,
          panelRow({
            label: this.t(cards.length === 0 ? 'colorNew' : 'colorAddAnother'),
            testId: 'database-color-add',
            icon: IconPlus,
            disabled,
            onClick: () => panel.push(this.pickProperty(this.t('colorNew'), COLOR_RULE_TYPES, (property) => {
              write([...rules(), { id: nanoid(), propertyId: property.id, operator: 'is_not_empty', value: null, color: 'gray' }]);
              panel.back();
            })),
          }),
        ];
      },
    };
  }
}

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
  onClose?: () => void
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

