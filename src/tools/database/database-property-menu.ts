import { IconCalendar, IconCheck, IconHelp, IconCopy, IconEmojiSmile, IconEyeSlash, IconInfo, IconMessage, IconPencil, IconPencilLine, IconReplace, IconSliders, IconTrash, IconEmojiSparkles, IconPageLayout, IconWand } from '../../components/icons';
import { nameTakenError } from './database-name-taken-error';
import { PopoverDesktop } from '../../components/utils/popover';
import { DATA_ATTR } from '../../components/constants/data-attributes';
import { PopoverItemType } from '../../components/utils/popover/components/popover-item';
import type { PopoverItemParams } from '../../../types/utils/popover/popover-item';
import type { PopoverParams } from '../../../types/utils/popover/popover';
import { PopoverEvent } from '../../../types/utils/popover/popover-event';
import type { I18n } from '../../../types';
import { EmojiPicker } from '../callout/emoji-picker';
import { NUMBER_FORMATS } from './cells/number-format';
import { OPTION_COLORS, optionColorLabelKey, optionSwatch } from './cells/option-colors';
import { addablePropertyTypes, propertyTypeMeta } from './database-property-types';
import { typeSearchHeading } from './database-property-type-popover';
import { ROLLUP_FUNCTIONS, inheritedRollupFormat, isNumberList, rollupFunctionsFor, rollupHasFormat, rollupResultType } from './rollup';
import { buttonEditItems } from './database-button-menu';
import { createOptionsEditor } from './cells/options-editor';
import { offersAutofill } from './database-autofill-setup';
import { DATABASE_HEADER_MENU_CLASS, SHOW_PAGE_ICON_ITEM } from './database-table-menus';
import { reminderLabel, remindersFor } from './reminders';
import { DATE_FORMATS, HOUR_CYCLES, TIME_FORMATS, resolveHourCycle, resolveLocale, timeZones } from './cells/date-format';
import { overlayMountFor } from '../../components/utils/top-layer';
import { hide as hideHint, onHover, type HintOptions } from '../../components/utils/tooltip';
import { getElementDirection } from '../../components/utils/direction';
import type {
  DateDisplay,
  DateReminderOffset,
  NumberDisplay,
  NumberShowAs,
  PageVisibility,
  PersonSettings,
  PropertyDefinition,
  PropertySettingsV2,
  PropertyType,
  RelationSettings,
  RollupFunction,
  SelectOption,
} from './types';

export type PropertyMenuEntry = 'editProperty' | 'displayAs' | 'changeType' | 'visibility' | 'duplicate' | 'delete';

/** Rows that come before the view's own rows; the rest come after. */
const HEAD_ENTRIES: ReadonlySet<PropertyMenuEntry> = new Set<PropertyMenuEntry>(['editProperty', 'displayAs', 'changeType']);

/** Types whose "Edit property" panel holds settings Blok has. */
const EDITABLE_SETTINGS: ReadonlySet<PropertyType> = new Set<PropertyType>([
  'number', 'select', 'multiSelect', 'status', 'date', 'createdTime', 'lastEditedTime', 'uniqueId', 'relation', 'rollup', 'formula', 'button', 'person',
]);

/** Types whose Edit property is the options list. */
const OPTION_TYPES: ReadonlySet<PropertyType> = new Set<PropertyType>(['select', 'multiSelect', 'status']);

/** Types whose Edit property ends with research/08's "Changes apply to all views showing this property." */
const ALL_VIEWS_NOTE: ReadonlySet<PropertyType> = new Set<PropertyType>(['number', 'select', 'multiSelect', 'status']);

/**
 * The property-level rows of a column header menu, per type, in Notion's
 * order (research/08). View-level rows (filter, sort, group, calculate,
 * freeze, hide, wrap, insert) belong to the view that hosts the menu.
 * The title cannot change type, be duplicated, hidden or deleted. ID has no
 * Change type or Duplicate, as Notion's ID menu.
 */
export const propertyMenuEntries = (property: PropertyDefinition): PropertyMenuEntry[] => {
  if (property.type === 'title') {
    return [];
  }

  const isId = property.type === 'uniqueId';
  // research/08: a relation's header menu has no Duplicate.
  const noDuplicate = isId || property.type === 'relation';

  return [
    ...(EDITABLE_SETTINGS.has(property.type) ? ['editProperty' as const] : []),
    ...(property.type === 'status' ? ['displayAs' as const] : []),
    ...(isId ? [] : ['changeType' as const]),
    'visibility',
    ...(noDuplicate ? [] : ['duplicate' as const]),
    'delete',
  ];
};

export interface PropertyMenuCallbacks {
  onRename: (propertyId: string, name: string) => void;
  /** A settings change: the keys given replace the property's own. */
  onUpdate: (propertyId: string, patch: Partial<PropertySettingsV2>) => void;
  onChangeType: (propertyId: string, type: PropertyType) => void;
  onDuplicate: (propertyId: string) => void;
  onDelete: (propertyId: string) => void;
  /** The whole option list after an edit in Edit property (select, multi-select, status). */
  onOptionsChange?: (propertyId: string, options: SelectOption[]) => void;
  onClose?: () => void;
}

/** What the formula, relation and rollup settings ask of the database. */
export interface ComputedMenuHost {
  /** This database's schema. */
  schema: () => PropertyDefinition[];
  /** Database blocks a relation can point at, this one included. */
  databases: () => Array<{ id: string; title: string }>;
  /** The schema of a database in this document. */
  targetSchema: (databaseId: string) => PropertyDefinition[];
  onEditFormula: (propertyId: string) => void;
  /** A formula as its result type: a number one gets Number's rows and Show as. */
  valueProperty?: (property: PropertyDefinition) => PropertyDefinition;
  /** A property of a database in this document as its result type: a rollup of a number formula reads like one of a Number. */
  targetValueProperty?: (databaseId: string, property: PropertyDefinition) => PropertyDefinition;
  /** Turns a relation's mirroring property on the target database on or off. `name` names a new mirror. */
  onSetTwoWay: (propertyId: string, twoWay: boolean, name?: string) => void;
  /** The mirror's name, or the name a new one would get. */
  twoWayName?: (propertyId: string) => string;
  /** Renames a two-way relation's mirror. */
  onRenameMirror?: (propertyId: string, name: string) => void;
  /** The host set `config.buttons.onAction`: buttons may call it. */
  hasHostActions?: boolean;
  /** The host set `config.buttons.onNotify`: buttons may send notifications. */
  hasNotify?: boolean;
  /** The editor has `agent.assistant`: buttons may message the agent. */
  hasAgent?: boolean;
  /** This database block. */
  databaseId?: string;
  /** Databases a button can add pages to or edit, this one first. */
  dataSources?: () => Array<{ id: string; title: string }>;
  /** People the host lists. */
  people?: () => Array<{ id: string; name: string }>;
  /** Opens the filter editor of a button's "Edit pages in" step. */
  onEditButtonFilter?: (propertyId: string, actionId: string) => void;
}

export interface PropertyMenuOptions extends PropertyMenuCallbacks {
  onIconUpdate?: PropertyMenuCallbacks['onUpdate'];
  i18n: I18n;
  /** Offer Person in Change type. */
  hasPeople: boolean;
  /** Without it, formula, relation and rollup show no settings. */
  computed?: ComputedMenuHost;
  /** The host gave `config.ai.autofill`. Without it there is no AI Autofill row. */
  autofill?: {
    hasDraft: (propertyId: string) => boolean;
    open: (propertyId: string) => void;
  };
  /** Only the row page's menu ends with "Customize layout" (research/09 §1b); a column header's has none. */
  onCustomizeLayout?: () => void;
  /** Another property of this database already has `name`. Such a rename is refused (research/14 §3). */
  isNameTaken?: (propertyId: string, name: string) => boolean;
  /** The column header the menu stands on now: a write redraws the board and replaces the one it opened from. */
  liveAnchor?: () => HTMLElement | null;
}

const SHOW_AS: readonly NumberShowAs[] = ['number', 'bar', 'ring'];
const VISIBILITY: readonly PageVisibility[] = ['always', 'hideWhenEmpty', 'hidden'];

/** The row page's menu and Edit property panel: the header menu's rows, in Notion's row page look. */
const ROW_PAGE_MENU_CLASS = `${DATABASE_HEADER_MENU_CLASS} blok-database-row-page-menu`;
/** The row page's Edit property panel: Notion pads it 8px, its menus 4 (notion-spec-2 §1). */
const PROPERTY_PANEL_CLASS = `${ROW_PAGE_MENU_CLASS} blok-database-property-panel`;

/** notion-spec-2 §16.1: Number format, Decimal places and Calculate open on a click only, under their row. */
const CLICK_ONLY_UNDER = { clickOnly: true, placement: 'under' } as const;
/** notion-spec-2 §16.1, §17.7: lists off the panel pad 4px, not the panel's 8. */
const PANEL_LIST_CLASS = 'blok-database-panel-list';

/** The type list's gap to the window edges (notion-spec-2 §16.1: y 132 + 574 = 706 in a 717 window). */
const TYPE_LIST_MARGIN = 11;

/** A menu laid over a spot (its start corner there), kept inside the window. */
interface PlaceOver { cover: true; viewportMargin: number; position: DOMRect; positionContext: HTMLElement }

/** notion-spec-2 §17.7: Notion offers 0 to 5. A saved 6 to 10 still shows and formats. */
const OFFERED_DECIMALS = 5;

/** What the row page label menu needs back when the type list returns to it. */
interface RowPageExtras { onComment?: () => void; edit?: boolean }

/** notion-spec-2 §17: every other Edit property row with a value opens a 250 wide list the same way. */
const VALUE_LIST = { clickOnly: true, placement: 'under', width: '250px', class: PANEL_LIST_CLASS } as const;
/** notion-spec-2 §17: a ✓ on the current choice. isActive keeps aria-checked; the panel list class drops its fill. */
const checkedIf = (current: boolean): { isActive: boolean; trailingIcon?: string } => ({ isActive: current, ...(current ? { trailingIcon: IconCheck } : {}) });
/** notion-spec-2 §17.2: a rollup's Relation and Target property lists are 280 wide and check nothing. */
const TARGET_LIST = { clickOnly: true, placement: 'under', width: '280px', class: PANEL_LIST_CLASS } as const;
/** notion-spec-2 §17.2: Target property's own search field size, in database.css. */
const TARGET_SEARCH_LIST_CLASS = `${PANEL_LIST_CLASS} blok-database-target-list`;

/** The Calculate menu's groups (notion-spec-2 §14.4, §15.2). */
const CALCULATE_GROUPS: ReadonlyArray<readonly [string, readonly RollupFunction[]]> = [
  ['tools.database.calcCount', ['count', 'count_values', 'unique', 'empty', 'not_empty', 'checked', 'unchecked', 'count_per_group']],
  ['tools.database.calcPercent', ['percent_empty', 'percent_not_empty', 'percent_checked', 'percent_unchecked', 'percent_per_group']],
  ['tools.database.calcMoreOptions', ['sum', 'average', 'median', 'min', 'max', 'range']],
  ['tools.database.calcDate', ['earliest_date', 'latest_date', 'date_range']],
];

const groupRowName = (titleKey: string): string => `rollupFunctionGroup-${titleKey.slice(titleKey.lastIndexOf('.') + 1)}`;

/** The Calculate row that holds `fn`: its own, or its group's. */
const calculateRow = (fn: RollupFunction): string => {
  const group = CALCULATE_GROUPS.find(([, members]) => members.includes(fn));

  return group === undefined ? `rollupFunction-${fn}` : groupRowName(group[0]);
};

const withoutLimit = ({ limit: _limit, ...rest }: RelationSettings): RelationSettings => rest;

/** The Sort row's choices. Manual is what an absent key means. */
const OPTION_SORTS = [
  ['manual', 'tools.database.groupSortManual'],
  ['alphabetical', 'tools.database.groupSortAlphabetical'],
  ['reverseAlphabetical', 'tools.database.groupSortReverse'],
] as const;

/** Person "Edit property" rows (research/16 §5). The first choice of each is what an absent key means. */
const PERSON_LIMITS = [['one', 'tools.database.personLimitOne'], ['none', 'tools.database.relationLimitNone']] as const;
const PERSON_DEFAULTS = [['none', 'tools.database.personDefaultNone'], ['createdBy', 'tools.database.propertyTypeCreatedBy']] as const;
const PERSON_NOTIFICATIONS = [
  ['usersAndGroups', 'tools.database.personNotificationsUsersAndGroups'],
  ['usersOnly', 'tools.database.personNotificationsUsersOnly'],
  ['none', 'tools.database.personNotificationsNone'],
] as const;

/** A copy of the settings with one key left out. */
const without = <T extends NumberDisplay | DateDisplay, K extends keyof T>(value: T, key: K): Omit<T, K> =>
  Object.fromEntries(Object.entries(value).filter(([name]) => name !== key)) as Omit<T, K>;

/**
 * A column's property menu: the name field with its icon, then the
 * property-level rows of `propertyMenuEntries`. Shared by every view's
 * column header and by the row drawer. Each change goes out through a
 * callback; the host writes it and redraws.
 */
export class DatabasePropertyMenu {
  private popover: PopoverDesktop | null = null;
  /** The open property with localized option and group names, for display only. Patches come from the saved one. */
  private shown: PropertyDefinition | null = null;
  private emojiPicker: EmojiPicker | null = null;
  /** What the menu opened from; the icon picker mounts beside it. */
  private anchor: HTMLElement | null = null;
  /** Saves the open menu's description field if it changed. */
  private saveDescription: (() => void) | null = null;
  /** Saves a mirror name typed but not yet committed. */
  private saveMirrorName: (() => void) | null = null;
  /** The row whose list the next number pick comes from: it keeps the highlight after the redraw (notion-spec-2 §8). */
  private pickedRow: string | null = null;
  /** Hints for rows of the menu being drawn, bound once its rows exist. */
  private rowHints: Array<() => void> = [];
  /** Lists whose tint already follows the pointer. */
  private readonly tintFollowers = new WeakSet<Element>();

  constructor(private readonly options: PropertyMenuOptions) {}

  get isOpen(): boolean {
    return this.popover !== null;
  }

  get isIconPickerOpen(): boolean {
    return this.emojiPicker?.isOpen() === true;
  }

  syncPageIcon(show: boolean): void {
    const item = this.popover?.getElement().querySelector<HTMLElement>('[data-blok-item-name="database-show-page-icon"]');

    if (item === null || item === undefined) return;
    item.setAttribute('aria-checked', String(show));
    if (show) item.setAttribute(DATA_ATTR.popoverItemActive, 'true');
    else item.removeAttribute(DATA_ATTR.popoverItemActive);
  }

  private t(key: string): string {
    return this.options.i18n.t(key);
  }

  /**
   * @param viewItems - the hosting view's own rows (filter, sort, freeze…),
   * placed after Change type as in Notion's header menu
   */
  open(property: PropertyDefinition, anchor: HTMLElement, viewItems: PopoverItemParams[] = [], shown: PropertyDefinition = property): void {
    this.close();
    this.drawHeaderMenu(property, anchor, viewItems, shown);
  }

  /** `typed`: a redraw's unsaved name, kept in the field. */
  private drawHeaderMenu(property: PropertyDefinition, anchor: HTMLElement, viewItems: PopoverItemParams[], shown: PropertyDefinition, typed?: string): void {
    this.shown = shown;
    this.anchor = anchor;
    this.rowHints = [];
    const name = this.nameField(property, property.type !== 'title');
    const update = this.showAsUpdate(property, name, (patch, kept) => {
      this.swap();
      this.drawHeaderMenu({ ...property, ...patch }, this.options.liveAnchor?.() ?? anchor, viewItems, { ...shown, ...patch }, kept);
      // The tiles live in the Edit property submenu: open it again.
      this.popover?.activateItemByName('editProperty');
    });
    const entries = propertyMenuEntries(property);
    const head = entries.filter((entry) => HEAD_ENTRIES.has(entry));
    const tail = entries.filter((entry) => !HEAD_ENTRIES.has(entry));
    // research/08: Title reads "Show page icon, AI Autofill, Filter…".
    const lead = viewItems.filter((item) => item.type === PopoverItemType.Default && item.name === SHOW_PAGE_ICON_ITEM);
    const rest = viewItems.filter((item) => !lead.includes(item));
    const items: PopoverItemParams[] = [
      // research/08: the title has no description.
      { type: PopoverItemType.Html, element: name, name: 'name' },
      { type: PopoverItemType.Separator },
      ...head.map((entry) => this.entry(entry, property, update)),
      ...lead,
      ...this.autofillItem(property),
      ...(rest.length > 0 ? [{ type: PopoverItemType.Separator } as const, ...rest, ...(tail.length > 0 ? [{ type: PopoverItemType.Separator } as const] : [])] : []),
      ...tail.map((entry) => this.entry(entry, property)),
      ...this.customizeItem(),
    ];
    this.show(items, anchor, '240px', DATABASE_HEADER_MENU_CLASS, typed !== undefined);
    const input = name.querySelector('input');

    if (typed !== undefined && input !== null) input.value = typed;
  }

  /** A swap, not a close: onClose would tell the host the menu is gone and its writes would stop. */
  private swap(): void {
    const previous = this.popover;

    this.popover = null;
    this.flushDescription();
    previous?.destroy();
  }

  /**
   * Writes a settings patch. A number or rollup pick (Show as, format, decimals, color,
   * relation, target, Calculate) draws the menu again through `redraw`: its list closes,
   * Edit property stays open with the new value (notion-spec-2 §8), and rows that hang
   * on the pick come or go. Without the redraw the next pick writes the old settings back.
   * Divide by writes through `numberItems`' quiet path instead: it lands on blur, often from a click elsewhere in the menu.
   */
  private showAsUpdate(property: PropertyDefinition, name: HTMLElement, redraw: (patch: Partial<PropertySettingsV2>, typed: string | undefined) => void): (patch: Partial<PropertySettingsV2>) => void {
    return (patch) => {
      this.options.onUpdate(property.id, patch);
      if (patch.number === undefined && patch.rollup === undefined) return;
      const input = name.querySelector('input');

      const row = this.pickedRow;

      this.pickedRow = null;
      // The old field goes away without a blur: save its name first, as leaving it would.
      input?.dispatchEvent(new Event('change'));
      redraw(patch, input?.value);
      if (row !== null) this.popover?.focusItemByName(row);
    };
  }

  /**
   * The row page's own menu for a property label (research/09:93, research/36:261):
   * Rename, Edit property, Comment, Property visibility, Duplicate, Delete, Customize layout.
   * No view rows: the row page is no column.
   */
  openRowPage(property: PropertyDefinition, anchor: HTMLElement, extras: RowPageExtras = {}): void {
    this.close();
    this.shown = property;
    if (extras.edit === true) {
      this.openRowPageEdit(property, anchor, extras);

      return;
    }
    this.drawRowPageMenu(property, anchor, extras);
  }

  /** The row page label menu, in place of what is open. */
  private drawRowPageMenu(property: PropertyDefinition, anchor: HTMLElement, extras: RowPageExtras): void {
    this.swap();
    const has = (entry: PropertyMenuEntry): boolean => propertyMenuEntries(property).includes(entry);
    // Notion: Rename and Edit property both open the Edit property panel.
    const edit = (): void => this.openRowPageEdit(property, anchor, extras);
    const onComment = extras.onComment;
    const items: PopoverItemParams[] = [
      { name: 'rename', title: this.t('tools.database.renameView'), icon: IconPencil, onActivate: edit },
      { name: 'editProperty', title: this.t('tools.database.editProperty'), icon: IconSliders, onActivate: edit },
      ...(onComment === undefined ? [] : [{ name: 'comment', title: this.t('tools.database.tableComment'), icon: IconMessage, closeOnActivate: true, onActivate: () => onComment() }]),
      { type: PopoverItemType.Separator },
      ...(has('visibility') ? [this.rowPageVisibility(property)] : []),
      ...(['duplicate', 'delete'] as const).filter(has).map((entry) => this.entry(entry, property)),
      ...this.customizeItem(),
    ];

    this.show(items, anchor, '220px', ROW_PAGE_MENU_CLASS);
    this.rowHint('editProperty', 'tools.database.editPropertyHint', 'start');
  }

  /** notion-spec-2 §15.7: a row's hint, 6px off its inline `side`. */
  private rowHint(name: string, key: string, side: 'start' | 'end'): void {
    const row = this.popover?.getElement().querySelector<HTMLElement>(`[${DATA_ATTR.itemName}="${name}"]`);

    if (row === null || row === undefined) return;
    onHover(row, this.t(key), {
      gap: 6,
      // A getter: the row is read for its direction on hover.
      get placement(): string {
        return (getElementDirection(row) === 'rtl') === (side === 'start') ? 'right' : 'left';
      },
    });
  }

  /** Notion's row page submenu: 180 wide, a check on the right of the current choice. */
  private rowPageVisibility(property: PropertyDefinition): PopoverItemParams {
    const current = property.pageVisibility ?? 'always';

    return {
      name: 'visibility',
      title: this.t('tools.database.pageVisibility'),
      // feel/findings-rowpage R07: the row page draws it with an eye-slash.
      icon: IconEyeSlash,
      children: {
        width: '180px',
        items: VISIBILITY.map((visibility) => ({
          name: `visibility-${visibility}`,
          title: this.t(`tools.database.pageVisibility.${visibility}`),
          ...(current === visibility ? { trailingIcon: IconCheck } : {}),
          closeOnActivate: true,
          onActivate: () => this.options.onUpdate(property.id, { pageVisibility: visibility }),
        })),
      },
    };
  }

  /** The row page's Edit property panel, in place of its menu, with the name selected (Notion). */
  /** `typed`: a redraw's unsaved name, kept in the field, which then keeps no focus. */
  private openRowPageEdit(property: PropertyDefinition, anchor: HTMLElement, extras: RowPageExtras, typed?: string): void {
    this.swap();
    this.rowHints = [];
    const entries = propertyMenuEntries(property);
    const has = (entry: PropertyMenuEntry): boolean => entries.includes(entry);
    const name = this.nameField(property, property.type !== 'title');
    const update = this.showAsUpdate(property, name, (patch, kept) => this.openRowPageEdit({ ...property, ...patch }, anchor, extras, kept));
    const settings: PopoverItemParams[] = [];

    if (EDITABLE_SETTINGS.has(property.type)) {
      settings.push(...(property.type === 'formula' && !this.isNumberFormula(property) ? [this.editFormulaItem(property.id, 'editFormula')] : this.editItems(property, update)));
    }
    // notion-spec-2 §17.3: Display as comes right after the status groups.
    if (has('displayAs')) settings.splice(settings.findIndex((item) => 'name' in item && item.name === 'options') + 1, 0, this.entry('displayAs', property));
    const typeItems = has('changeType') ? [this.typeRow(property, anchor, extras)] : [];
    const tail = (['duplicate', 'delete'] as const).filter(has).map((entry) => this.entry(entry, property));
    const separator = { type: PopoverItemType.Separator } as const;
    // 08-rename.png, notion-spec-2 §3, §6: number, rollup and formula rows sit under Type with no rule.
    const ruled = typeItems.length > 0 && settings.length > 0 && !(['number', 'rollup', 'formula'] as PropertyType[]).includes(property.type);
    const items: PopoverItemParams[] = [
      { type: PopoverItemType.Html, element: name, name: 'name' },
      ...typeItems,
      ...(ruled ? [separator] : []),
      ...settings,
      ...(tail.length > 0 ? [separator, ...tail] : []),
    ];

    this.show(items, anchor, '290px', PROPERTY_PANEL_CLASS, typed !== undefined);
    this.rowHint('decimals', 'tools.database.decimalPlacesHint', 'end');
    this.bindRowHints();
    const input = name.querySelector('input');

    if (typed !== undefined) {
      if (input !== null) input.value = typed;

      return;
    }
    input?.focus();
    input?.select();
  }

  /** The panel's Type row (research/10 L16): the current type on the right. */
  private typeRow(property: PropertyDefinition, anchor: HTMLElement, extras: RowPageExtras): PopoverItemParams {
    return {
      name: 'changeType',
      title: this.t('tools.database.propertyTypeListHeading'),
      icon: IconReplace,
      valueLabel: this.t(propertyTypeMeta(property.type).labelKey),
      chevron: true,
      onActivate: () => this.openTypeList(property, anchor, extras),
    };
  }

  /**
   * notion-spec-2 §16.1, §17.9: a click on Type swaps the panel for the type list,
   * headed by "Type" and its magnifier. One Escape lands on the label menu, not back on the panel.
   */
  private openTypeList(property: PropertyDefinition, anchor: HTMLElement, extras: RowPageExtras): void {
    const panel = this.popover?.getElement().querySelector('[data-blok-popover-container]')?.getBoundingClientRect();

    this.swap();
    // On the panel's corner, moved up as far as it must to fit (Notion: y 132, bottom 706 of 717).
    const place: PlaceOver | undefined = panel === undefined ? undefined : { cover: true, viewportMargin: TYPE_LIST_MARGIN, position: DOMRect.fromRect({ x: panel.left, y: panel.top, width: panel.width, height: 0 }), positionContext: anchor };

    const types = addablePropertyTypes(this.options.hasPeople);
    const heading = document.createElement('div');

    heading.appendChild(typeSearchHeading((key) => this.t(key), (query) => {
      for (const type of types) {
        this.popover?.toggleItemHiddenByName(`type-${type}`, !this.t(propertyTypeMeta(type).labelKey).toLowerCase().includes(query));
      }
    }));
    const search = heading.querySelector<HTMLElement>('[data-blok-database-property-type-search]');

    if (search !== null) onHover(search, this.t('tools.database.csvSearchTypes'));
    // §17.9: the current type stays, with a check; picking it changes nothing.
    const items: PopoverItemParams[] = [
      { type: PopoverItemType.Html, element: heading, name: 'type-heading' },
      ...types.map((type): PopoverItemParams => ({
        name: `type-${type}`,
        title: this.t(propertyTypeMeta(type).labelKey),
        icon: propertyTypeMeta(type).icon,
        closeOnActivate: true,
        ...(type === property.type ? { trailingIcon: IconCheck } : {}),
        onActivate: (): void => {
          if (type !== property.type) this.options.onChangeType(property.id, type);
        },
      })),
    ];

    this.show(items, anchor, '290px', PROPERTY_PANEL_CLASS, false, place);
    const popover = this.popover;

    if (popover === null) return;
    // The popover registry asks this first on Escape; true stops it closing the menu.
    popover.closeSubmenuOnEscape = (): boolean => {
      this.drawRowPageMenu(property, anchor, extras);

      return true;
    };
  }

  private typeChoices(property: PropertyDefinition): PopoverItemParams[] {
    return addablePropertyTypes(this.options.hasPeople)
      .filter((type) => type !== property.type)
      .map((type) => ({
        name: `type-${type}`,
        title: this.t(propertyTypeMeta(type).labelKey),
        icon: propertyTypeMeta(type).icon,
        closeOnActivate: true,
        onActivate: () => this.options.onChangeType(property.id, type),
      }));
  }

  /** `redraw`: stands in for the open menu, so it shows with no entrance. */
  /** `place`: a spot of its own in place of under `anchor`. */
  private show(
    items: PopoverItemParams[],
    anchor: HTMLElement,
    minWidth: string,
    className = DATABASE_HEADER_MENU_CLASS,
    redraw = false,
    place?: PlaceOver,
  ): void {
    const rowPage = className.startsWith(ROW_PAGE_MENU_CLASS);
    const params: PopoverParams = {
      class: className, animateClose: true, items, trigger: anchor, width: 'auto', minWidth, flippable: true, autoFocusFirstItem: false,
      // Notion opens the row page menu 1px under the label.
      ...(rowPage ? { offset: 1 } : {}),
    };
    const popover = new PopoverDesktop(place === undefined ? params : { ...params, ...place });

    // research/27 §7: Escape closes the Edit property submenu only; a second Escape closes the menu.
    popover.escapeClosesSubmenuFirst = true;
    this.popover = popover;
    popover.on(PopoverEvent.Closed, () => {
      if (this.popover === popover) {
        this.popover = null;
        this.flushDescription();
        queueMicrotask(() => popover.destroy());
        this.options.onClose?.();
      }
    });
    // The entrance scales the menu: it would flash, and a submenu placed during it lands off its row.
    const container = redraw ? popover.getElement().querySelector<HTMLElement>('[data-blok-popover-container]') : null;

    if (container !== null) container.style.transition = 'none';
    popover.show();
    if (container !== null) requestAnimationFrame(() => container.style.removeProperty('transition'));
  }

  private customizeItem(): PopoverItemParams[] {
    const customize = this.options.onCustomizeLayout;

    if (customize === undefined) return [];

    return [
      { type: PopoverItemType.Separator },
      {
        type: PopoverItemType.Default,
        name: 'customize-layout',
        title: this.t('tools.database.layoutCustomize'),
        icon: IconPageLayout,
        closeOnActivate: true,
        onActivate: () => customize(),
      },
    ];
  }

  /** research/08: after Change type. Once set up or drafted, it opens the setup directly. */
  private autofillItem(property: PropertyDefinition): PopoverItemParams[] {
    const host = this.options.autofill;

    if (host === undefined || !offersAutofill(property.type)) return [];
    const open = (): void => host.open(property.id);

    if (property.autofill !== undefined || host.hasDraft(property.id)) {
      return [{
        name: 'aiAutofill',
        title: this.options.i18n.t('tools.database.aiAutofillProperty', { name: property.name }),
        icon: IconWand,
        closeOnActivate: true,
        onActivate: open,
      }];
    }

    return [{
      name: 'aiAutofill',
      title: this.t('tools.database.aiAutofill'),
      icon: IconWand,
      children: { items: [{ name: 'aiAutofill-basic', title: this.t('tools.database.aiAutofillBasic'), closeOnActivate: true, onActivate: open }] },
    }];
  }

  close(): void {
    const popover = this.popover;

    this.popover = null;
    if (popover !== null) this.flushDescription();
    this.saveMirrorName?.();
    this.saveMirrorName = null;
    popover?.destroy();
    if (popover !== null) this.options.onClose?.();
  }

  private flushDescription(): void {
    const save = this.saveDescription;

    this.saveDescription = null;
    save?.();
  }

  destroy(): void {
    this.close();
    this.emojiPicker?.close();
    this.emojiPicker?.getElement().remove();
    this.emojiPicker = null;
  }

  private nameField(property: PropertyDefinition, describable: boolean): HTMLElement {
    const row = document.createElement('div');
    const icon = document.createElement('button');
    const input = document.createElement('input');

    row.setAttribute('data-blok-database-property-menu-name', '');
    icon.type = 'button';
    icon.setAttribute('data-blok-database-property-menu-icon', '');
    icon.setAttribute('aria-label', this.t('tools.database.propertyIcon'));
    if (property.icon !== undefined && property.icon !== '') {
      icon.textContent = property.icon;
    } else {
      icon.innerHTML = propertyTypeMeta(property.type).icon;
    }
    icon.addEventListener('click', () => this.openIconPicker(property, icon));

    input.type = 'text';
    input.value = property.name;
    input.setAttribute('data-blok-database-property-menu-name-input', '');
    input.setAttribute('data-blok-field', 'text');
    input.setAttribute('aria-label', this.t('tools.database.propertyName'));
    // research/27 §7: arrows leave the field for the items, and ArrowRight/Enter act on a highlighted item.
    input.setAttribute('data-blok-flipper-navigation-target', 'true');
    const error = nameTakenError(input, 'data-blok-database-property-menu-name-error', this.options.i18n);
    const taken = (name: string): boolean => name !== property.name && this.options.isNameTaken?.(property.id, name) === true;
    const showError = (): void => {
      const name = input.value.trim();

      error.show(taken(name) ? name : null);
    };
    const commit = (): void => {
      const name = input.value.trim();

      if (name !== '' && name !== property.name && !taken(name)) {
        this.options.onRename(property.id, name);
      }
    };

    input.addEventListener('input', showError);
    input.addEventListener('change', commit);
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && !event.isComposing) {
        event.preventDefault();
        if (taken(input.value.trim())) return;
        commit();
        this.close();
      }
    });
    row.append(icon, input);
    const description = describable ? this.descriptionField(property) : null;

    if (description !== null) row.append(description.button);
    row.append(error.element);
    if (description !== null) row.append(description.box);

    return row;
  }

  /**
   * research/30 X2: the (i) at the name field's end shows a description
   * field under the name row, inside this menu. Closing the menu saves it.
   */
  private descriptionField(property: PropertyDefinition): { button: HTMLButtonElement; box: HTMLElement } {
    const button = document.createElement('button');
    const box = document.createElement('div');
    const area = document.createElement('textarea');
    const saved = property.description ?? '';

    button.type = 'button';
    button.setAttribute('data-blok-database-property-menu-description-button', '');
    button.setAttribute('aria-label', this.t(saved === '' ? 'tools.database.addPropertyDescription' : 'tools.database.editPropertyDescription'));
    button.innerHTML = IconInfo;

    // `hidden` goes on the box: textarea[data-blok-field] sets display and would beat it.
    box.setAttribute('data-blok-database-property-description-box', '');
    box.setAttribute('data-blok-keyboard-owner', '');
    // research/35 §5: a saved description does not reopen the field.
    box.hidden = true;
    area.setAttribute('data-blok-database-property-description', '');
    area.setAttribute('data-blok-field', 'text');
    area.setAttribute('aria-label', this.t('tools.database.propertyDescription'));
    area.placeholder = this.t('tools.database.propertyDescriptionPlaceholder');
    area.rows = 2;
    area.value = saved;
    box.appendChild(area);

    const written = { value: saved };
    const save = (): void => {
      const value = area.value.trim() === '' ? '' : area.value;

      if (value === written.value) return;
      written.value = value;
      this.options.onUpdate(property.id, { description: value === '' ? undefined : value });
    };

    this.saveDescription = save;
    area.addEventListener('change', save);
    // research/30 X2: Enter adds no line and keeps the menu open.
    area.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) event.preventDefault();
    });
    button.addEventListener('click', () => {
      const popover = this.popover;

      if (popover === null) return;
      // closeSubmenuOnEscape works here because open() sets escapeClosesSubmenuFirst.
      while (popover.closeSubmenuOnEscape()) { /* one level per call */ }
      box.hidden = !box.hidden;
      if (!box.hidden) area.focus();
    });

    return { button, box };
  }

  private openIconPicker(property: PropertyDefinition, anchor: HTMLElement): void {
    if (!this.isOpen) return;
    const update = this.options.onIconUpdate ?? this.options.onUpdate;
    const handlers = {
      onSelect: (native: string): void => update(property.id, { icon: native }),
      onRemove: (): void => update(property.id, { icon: undefined }),
    };

    if (this.emojiPicker === null) {
      this.emojiPicker = new EmojiPicker({ ...handlers, i18n: this.options.i18n, locale: this.options.i18n.getLocale() });
    }
    const element = this.emojiPicker.getElement();

    if (!element.isConnected) {
      overlayMountFor(this.anchor ?? anchor).appendChild(element);
    }
    void this.emojiPicker.open(anchor, undefined, handlers);
  }

  private entry(
    entry: PropertyMenuEntry,
    property: PropertyDefinition,
    update: (patch: Partial<PropertySettingsV2>) => void = (patch) => this.options.onUpdate(property.id, patch),
  ): PopoverItemParams {
    const id = property.id;

    switch (entry) {
      case 'editProperty':
        if (property.type === 'formula' && !this.isNumberFormula(property)) {
          return this.editFormulaItem(id, entry, 'tools.database.editProperty');
        }

        // research/08: Notion names a button's settings "Edit automation".
        return {
          name: entry,
          title: this.t(property.type === 'button' ? 'tools.database.editAutomation' : 'tools.database.editProperty'),
          icon: IconPencil,
          // research/27 §7: 300 wide. The all-views note wraps rather than widening it.
          // The submenu's rows mount right after onOpen.
          children: { items: this.editItems(property, update), minWidth: '300px', onOpen: () => queueMicrotask(() => this.bindRowHints()) },
        };
      case 'displayAs': {
        const status = property.status;
        const current = status?.showAs ?? 'select';

        return {
          name: entry,
          title: this.t('tools.database.statusDisplayAs'),
          icon: IconEmojiSparkles,
          valueLabel: this.t(`tools.database.statusDisplayAs.${current}`),
          children: {
            ...VALUE_LIST,
            items: (['checkbox', 'select'] as const).map((showAs) => ({
              name: `displayAs-${showAs}`,
              title: this.t(`tools.database.statusDisplayAs.${showAs}`),
              icon: propertyTypeMeta(showAs).icon,
              ...checkedIf(current === showAs),
              closeOnActivate: true,
              onActivate: () => update({ status: { groups: status?.groups ?? [], ...status, showAs } }),
            })),
          },
        };
      }
      case 'changeType':
        return {
          name: entry,
          title: this.t('tools.database.changeType'),
          icon: propertyTypeMeta(property.type).icon,
          children: { items: this.typeChoices(property) },
        };
      case 'visibility': {
        const current = property.pageVisibility ?? 'always';

        return {
          name: entry,
          title: this.t('tools.database.pageVisibility'),
          icon: IconEmojiSmile,
          children: {
            items: VISIBILITY.map((visibility) => ({
              name: `visibility-${visibility}`,
              title: this.t(`tools.database.pageVisibility.${visibility}`),
              isActive: current === visibility,
              closeOnActivate: true,
              onActivate: () => update({ pageVisibility: visibility }),
            })),
          },
        };
      }
      case 'duplicate':
        return { name: entry, title: this.t('tools.database.duplicateProperty'), icon: IconCopy, closeOnActivate: true, onActivate: () => this.options.onDuplicate(id) };
      case 'delete':
        return {
          name: entry,
          title: this.t('tools.database.deleteProperty'),
          icon: IconTrash,
          isDestructive: true,
          confirmation: {
            name: entry,
            title: this.t('tools.database.deletePropertyConfirm'),
            icon: IconTrash,
            isDestructive: true,
            closeOnActivate: true,
            onActivate: () => this.options.onDelete(id),
          },
        };
    }
  }

  /** "Related to", "Limit" and the two-way toggle of research/08's "New relation" panel. */
  private relationItems(property: PropertyDefinition, update: (patch: Partial<PropertySettingsV2>) => void): PopoverItemParams[] {
    const settings = property.relation ?? { targetDatabaseId: '' };
    const limit = settings.limit === 1 ? 'one' : 'none';
    const twoWay = settings.twoWay === true;

    return [
      settings.targetDatabaseId === '' ? this.relatedToPicker(settings, update) : this.relatedToValue(settings),
      {
        name: 'limit',
        title: this.t('tools.database.relationLimit'),
        valueLabel: this.t(limit === 'one' ? 'tools.database.relationLimitOne' : 'tools.database.relationLimitNone'),
        children: {
          ...VALUE_LIST,
          items: (['one', 'none'] as const).map((choice) => ({
            name: `limit-${choice}`,
            title: this.t(choice === 'one' ? 'tools.database.relationLimitOne' : 'tools.database.relationLimitNone'),
            ...checkedIf(limit === choice),
            closeOnActivate: true,
            onActivate: () => update({ relation: choice === 'one' ? { ...settings, limit: 1 } : withoutLimit(settings) }),
          })),
        },
      },
      this.twoWayItem(property.id, twoWay),
    ];
  }

  /** notion-spec-2 §17.1: the Enable switch, then the name of the mirror in the related database. */
  private twoWayItem(propertyId: string, twoWay: boolean): PopoverItemParams {
    const host = this.options.computed;
    // The dialog is not redrawn after a two-way change, so it keeps the switch's state itself.
    const state = { on: twoWay };
    const shownName = (): string => host?.twoWayName?.(propertyId) ?? '';
    const name = this.mirrorNameField(shownName(), (typed) => {
      if (!state.on) return true;
      host?.onRenameMirror?.(propertyId, typed);

      return false;
    }, shownName);

    return {
      name: 'twoWay',
      title: this.t('tools.database.relationTwoWay'),
      titleEl: this.twoWayLabel(),
      valueLabel: this.t(twoWay ? 'tools.database.settingsOn' : 'tools.database.settingsOff'),
      children: {
        ...VALUE_LIST,
        // A rename made from the related database shows on the next open.
        onOpen: () => name.refresh(),
        items: [
          this.switchItem('twoWay-enable', 'tools.database.relationTwoWayEnable', twoWay, (on) => {
            state.on = on;
            // An empty field means the default mirror name.
            const typed = name.value().trim();

            host?.onSetTwoWay(propertyId, on, ...(on && typed !== '' ? [typed] : []));
            name.refresh();
            const value = this.popover?.getElement().querySelector(`[${DATA_ATTR.itemName}="twoWay"] [${DATA_ATTR.popoverItemValue}]`);

            if (value !== null && value !== undefined) value.textContent = this.t(on ? 'tools.database.settingsOn' : 'tools.database.settingsOff');
          }),
          { type: PopoverItemType.Html, element: name.element, name: 'twoWay-name' },
        ],
      },
    };
  }

  /**
   * The "Related property name" field. `save` gets a trimmed, non-empty name and
   * returns whether the field keeps it; otherwise it shows `saved()` again.
   */
  private mirrorNameField(initial: string, save: (name: string) => boolean, saved: () => string): { element: HTMLElement; value: () => string; refresh: () => void } {
    const label = document.createElement('label');
    const input = document.createElement('input');
    const kept = { value: initial, dirty: false };
    const commit = (): void => {
      const typed = input.value.trim();

      this.saveMirrorName = null;
      kept.dirty = false;
      if (typed !== '' && save(typed)) {
        kept.value = typed;
        input.value = typed;

        return;
      }
      input.value = typed === '' ? kept.value : saved();
      if (typed !== '') kept.value = input.value;
    };

    label.setAttribute('data-blok-database-property-menu-mirror-name', '');
    label.append(this.t('tools.database.layoutRelatedPropertyName'));
    input.type = 'text';
    input.setAttribute('data-blok-field', 'text');
    input.value = initial;
    input.addEventListener('input', () => {
      kept.dirty = true;
      this.saveMirrorName = commit;
    });
    input.addEventListener('change', commit);
    label.appendChild(input);

    return {
      element: label,
      value: () => input.value.trim() === '' ? kept.value : input.value.trim(),
      refresh: () => {
        if (kept.dirty) return;
        kept.value = saved();
        input.value = kept.value;
      },
    };
  }

  /** A relation with no database yet picks one here. */
  private relatedToPicker(settings: RelationSettings, update: (patch: Partial<PropertySettingsV2>) => void): PopoverItemParams {
    return {
      name: 'relatedTo',
      title: this.t('tools.database.relationRelatedTo'),
      children: {
        items: (this.options.computed?.databases() ?? []).map((database) => ({
          name: `relatedTo-${database.id}`,
          title: database.title === '' ? this.t('tools.database.relationUntitledDatabase') : database.title,
          isActive: settings.targetDatabaseId === database.id,
          closeOnActivate: true,
          // A new target starts one-way: the old mirror belongs to the old target.
          onActivate: () => update({ relation: { targetDatabaseId: database.id } }),
        })),
      },
    };
  }

  /** notion-spec-2 §17.1: once set, the related database is locked. A click does nothing; a hover says why. */
  private relatedToValue(settings: RelationSettings): PopoverItemParams {
    const host = this.options.computed;
    const title = host?.databases().find((database) => database.id === settings.targetDatabaseId)?.title ?? '';
    const named = title === '' ? this.t('tools.database.relationUntitledDatabase') : title;

    this.rowHints.push(() => this.hintOnRow('relatedTo', this.t('tools.database.relationRelatedToHint'), { placement: 'top', gap: 6 }));

    return {
      name: 'relatedTo',
      title: this.t('tools.database.relationRelatedTo'),
      valueLabel: settings.targetDatabaseId === host?.databaseId ? this.t('tools.database.relationThisDatabase') : named,
      onActivate: () => undefined,
    };
  }

  /** notion-spec-2 §17.1: the label and a "?" carry the hint, below the label, 200 wide; the value part has none. */
  private twoWayLabel(): HTMLElement {
    const label = document.createElement('span');
    const help = document.createElement('span');
    const text = document.createElement('span');

    label.setAttribute('data-blok-database-property-menu-help-label', '');
    label.style.display = 'inline-flex';
    label.style.alignItems = 'center';
    label.style.gap = '6px';
    help.innerHTML = IconHelp;
    help.style.display = 'inline-flex';
    help.style.color = 'var(--blok-text-secondary)';
    help.querySelector('svg')?.setAttribute('width', '16');
    help.querySelector('svg')?.setAttribute('height', '16');
    label.append(this.t('tools.database.relationTwoWay'), help);
    // 184 + the bubble's 8px padding on each side = 200.
    text.style.display = 'block';
    text.style.maxWidth = '184px';
    text.textContent = this.t('tools.database.relationTwoWayHint');
    onHover(label, text, { placement: 'bottom', gap: 6 });

    return label;
  }

  /** notion-spec-2 §17.8: Show unique values explains itself, 6px off the Calculate menu's inline end. */
  private showUniqueHint(): void {
    const row = this.popover?.getElement().querySelector<HTMLElement>(`[${DATA_ATTR.itemName}="rollupFunction-show_unique"]`);

    if (row === null || row === undefined) return;
    const text = document.createElement('span');

    // Notion's box is 156 wide: 140 + the bubble's 8px padding on each side.
    text.style.display = 'block';
    text.style.maxWidth = '140px';
    text.textContent = this.t('tools.database.rollupShowUniqueHint');
    onHover(row, text, { placement: getElementDirection(row) === 'rtl' ? 'left' : 'right', gap: 6 });
  }

  /**
   * §17.10: a list opens with its current row in the hover tint, and the tint
   * moves to the row the pointer moves onto. `pointermove`, not `mouseover`:
   * a list opening under a resting pointer must keep the current row.
   */
  private focusCurrentRow(name: string): void {
    this.popover?.focusItemByName(name);
    const list = this.popover?.getElement().querySelector(`[${DATA_ATTR.itemName}="${name}"]`)?.closest(`[${DATA_ATTR.popoverItems}]`);

    if (list === null || list === undefined || this.tintFollowers.has(list)) return;
    this.tintFollowers.add(list);
    list.addEventListener('pointermove', (event) => {
      const row = event.target instanceof Element ? event.target.closest(`[${DATA_ATTR.itemName}]`) : null;
      const name = row?.getAttribute(DATA_ATTR.itemName);

      if (row === null || row === undefined || name === null || name === undefined || row.closest(`[${DATA_ATTR.popoverItems}]`) !== list) return;
      if (row.getAttribute(DATA_ATTR.focused) !== 'true') this.popover?.focusItemByName(name);
    });
  }

  /** Binds hints to rows drawn now. Each draw makes new rows, so it runs again on every open. */
  private bindRowHints(): void {
    this.rowHints.forEach((bind) => bind());
  }

  /** A hint on a drawn row of this menu or of an open submenu. */
  private hintOnRow(name: string, content: string, options: HintOptions): void {
    const row = this.popover?.getElement().querySelector<HTMLElement>(`[${DATA_ATTR.itemName}="${name}"]`);

    if (row !== null && row !== undefined) onHover(row, content, options);
  }

  /** Limit, Default and Notifications, each showing its current choice (research/16 §5). Default choices leave their key out. */
  private personItems(settings: PersonSettings, set: (person: PersonSettings) => void): PopoverItemParams[] {
    const current = {
      limit: settings.limit === 1 ? 'one' : 'none',
      default: settings.default ?? 'none',
      notifications: settings.notifications ?? 'usersOnly',
    };
    const write = (key: keyof PersonSettings, value: PersonSettings[keyof PersonSettings] | undefined): void => {
      const rest = Object.fromEntries(Object.entries(settings).filter(([name]) => name !== key)) as PersonSettings;

      set(value === undefined ? rest : { ...rest, [key]: value });
    };
    const row = <C extends string>(name: string, titleKey: string, choices: ReadonlyArray<readonly [C, string]>, chosen: string, pick: (choice: C) => void): PopoverItemParams => ({
      name,
      title: this.t(titleKey),
      valueLabel: this.t(choices.find(([choice]) => choice === chosen)?.[1] ?? choices[0][1]),
      children: {
        ...VALUE_LIST,
        items: choices.map(([choice, labelKey]) => ({
          name: [name, choice].join('-'),
          title: this.t(labelKey),
          // §17.5: Created by carries its type's icon in Default's list.
          ...(choice === 'createdBy' ? { icon: propertyTypeMeta('createdBy').icon } : {}),
          ...checkedIf(choice === chosen),
          closeOnActivate: true,
          onActivate: () => pick(choice),
        })),
      },
    });

    return [
      row('limit', 'tools.database.relationLimit', PERSON_LIMITS, current.limit, (choice) => write('limit', choice === 'one' ? 1 : undefined)),
      row('personDefault', 'tools.database.personDefault', PERSON_DEFAULTS, current.default, (choice) => write('default', choice === 'createdBy' ? choice : undefined)),
      row('personNotifications', 'tools.database.personNotifications', PERSON_NOTIFICATIONS, current.notifications, (choice) => write('notifications', choice === 'usersOnly' ? undefined : choice)),
    ];
  }

  /** Relation › Property › Calculate (H-rr), then the number format when the result is a number. */
  private rollupItems(property: PropertyDefinition, update: (patch: Partial<PropertySettingsV2>) => void): PopoverItemParams[] {
    const host = this.options.computed;
    const settings = property.rollup ?? { relationPropertyId: '', targetPropertyId: '', function: 'show_original' as const };
    const relations = (host?.schema() ?? []).filter((p) => p.type === 'relation');
    const relation = relations.find((p) => p.id === settings.relationPropertyId);
    const targets = relation?.relation === undefined ? [] : (host?.targetSchema(relation.relation.targetDatabaseId) ?? []);
    const picked = targets.find((p) => p.id === settings.targetPropertyId);
    const target = picked?.type === 'formula' && relation?.relation !== undefined
      ? host?.targetValueProperty?.(relation.relation.targetDatabaseId, picked) ?? picked
      : picked;
    const set = (patch: Partial<typeof settings>): void => update({ rollup: { ...settings, ...patch } });
    // notion-spec-2 §15.3: a new Calculate puts Show as back on Number.
    const setFunction = (fn: RollupFunction): void => update({
      rollup: { ...settings, function: fn },
      ...(fn !== settings.function && property.number?.showAs !== undefined ? { number: without(property.number, 'showAs') } : {}),
    });

    return [
      {
        name: 'rollupRelation',
        title: this.t('tools.database.rollupRelation'),
        valueLabel: relation?.name ?? this.t('tools.database.rollupSelect'),
        children: {
          ...TARGET_LIST,
          items: relations.map((p) => ({
            name: `rollupRelation-${p.id}`,
            title: p.name,
            closeOnActivate: true,
            onActivate: () => set({ relationPropertyId: p.id }),
          })),
        },
      },
      {
        name: 'rollupProperty',
        title: this.t('tools.database.rollupTargetProperty'),
        valueLabel: picked?.name ?? this.t('tools.database.rollupSelect'),
        children: {
          ...TARGET_LIST,
          class: TARGET_SEARCH_LIST_CLASS,
          searchable: true,
          searchPlaceholder: this.t('tools.database.settingsSearchProperty'),
          // H-rr: a rollup of a rollup is not offered.
          items: targets.filter((p) => p.type !== 'rollup').map((p) => ({
            name: `rollupProperty-${p.id}`,
            title: p.name,
            closeOnActivate: true,
            onActivate: () => update({ rollup: { ...settings, targetPropertyId: p.id }, ...inheritedRollupFormat(property, p) }),
          })),
        },
      },
      {
        name: 'rollupFunction',
        title: this.t('tools.database.rollupFunction'),
        // §17.10: no value until a relation is picked.
        ...(relation === undefined ? {} : { valueLabel: this.t(`tools.database.rollupFn.${settings.function}`) }),
        children: {
          ...CLICK_ONLY_UNDER,
          class: PANEL_LIST_CLASS,
          width: '200px',
          // §17.10: the row holding the current calculation, a group row too, opens highlighted. After show: the list is not drawn yet.
          onOpen: () => queueMicrotask(() => {
            this.focusCurrentRow(calculateRow(settings.function));
            this.showUniqueHint();
          }),
          items: this.calculateItems(target === undefined ? ROLLUP_FUNCTIONS : rollupFunctionsFor(target), settings.function, setFunction),
        },
      },
      ...(target !== undefined && (rollupResultType(settings.function, target).type === 'number' || isNumberList(settings.function, target))
        ? [...this.numberItems(property, (number) => update({ number }), rollupHasFormat(settings.function)), this.allViewsNote()]
        : []),
    ];
  }

  /**
   * notion-spec-2 §14.4, §15.2, §17.8: Show original and Show unique values, then the
   * Count, Percent and More options (or Date) groups, which open on hover. Where the
   * per-group counts sit was not measured.
   */
  private calculateItems(fns: readonly RollupFunction[], current: RollupFunction, pick: (fn: RollupFunction) => void): PopoverItemParams[] {
    const leaf = (fn: RollupFunction): PopoverItemParams => ({
      name: `rollupFunction-${fn}`,
      title: this.t(`tools.database.rollupFn.${fn}`),
      // §17.10: a check on the current one; database.css drops the checked fill in these lists.
      isActive: fn === current,
      ...(fn === current ? { trailingIcon: IconCheck } : {}),
      closeOnActivate: true,
      onActivate: () => pick(fn),
    });
    const top = fns.filter((fn) => fn === 'show_original' || fn === 'show_unique');
    const groups = CALCULATE_GROUPS
      .map(([titleKey, members]) => [titleKey, fns.filter((fn) => members.includes(fn))] as const)
      .filter(([, members]) => members.length > 0);

    return [
      ...top.map(leaf),
      ...groups.map(([titleKey, members]): PopoverItemParams => ({
        name: groupRowName(titleKey),
        title: this.t(titleKey),
        // §17.8: every group submenu is 250 wide. §14.4: the one holding the current calculation opens on it.
        children: {
          class: PANEL_LIST_CLASS,
          width: '250px',
          ...(members.includes(current) ? { onOpen: () => queueMicrotask(() => this.focusCurrentRow(`rollupFunction-${current}`)) } : {}),
          items: members.map(leaf),
        },
      })),
    ];
  }

  private isNumberFormula(property: PropertyDefinition): boolean {
    return property.type === 'formula' && this.options.computed?.valueProperty?.(property).type === 'number';
  }

  /** notion-spec-2 §6: inside Edit property the row reads "Edit formula". */
  private editFormulaItem(propertyId: string, name: string, titleKey = 'tools.database.editFormula'): PopoverItemParams {
    // notion-spec-2 §9: Notion's Edit formula row has pencilLine and a chevron; the header's own Edit property keeps the pencil.
    const own = name === 'editFormula';

    return {
      name,
      title: this.t(titleKey),
      icon: own ? IconPencilLine : IconPencil,
      ...(own ? { chevron: true } : {}),
      closeOnActivate: true,
      onActivate: () => this.options.computed?.onEditFormula(propertyId),
    };
  }

  private editItems(property: PropertyDefinition, update: (patch: Partial<PropertySettingsV2>) => void): PopoverItemParams[] {
    const items = this.settingsItems(property, update);

    return ALL_VIEWS_NOTE.has(property.type) ? [...items, this.allViewsNote()] : items;
  }

  private allViewsNote(): PopoverItemParams {
    const note = document.createElement('div');

    note.setAttribute('data-blok-database-property-menu-note', '');
    note.textContent = this.t('tools.database.changesApplyToAllViews');

    return { type: PopoverItemType.Html, element: note, name: 'all-views-note' };
  }

  /** notion-spec-2 §17.3: Sort orders a select's options in this list and in the option picker. */
  private optionSortItem(property: PropertyDefinition, update: (patch: Partial<PropertySettingsV2>) => void): PopoverItemParams {
    const current = OPTION_SORTS.find(([sort]) => sort === property.optionSort) ?? OPTION_SORTS[0];

    return {
      name: 'optionSort',
      title: this.t('tools.database.groupSort'),
      valueLabel: this.t(current[1]),
      children: {
        ...VALUE_LIST,
        items: OPTION_SORTS.map(([sort, labelKey]) => ({
          name: `optionSort-${sort}`,
          title: this.t(labelKey),
          ...checkedIf(sort === current[0]),
          closeOnActivate: true,
          onActivate: () => update({ optionSort: sort === 'manual' ? undefined : sort }),
        })),
      },
    };
  }

  private optionsItem(property: PropertyDefinition, update: (patch: Partial<PropertySettingsV2>) => void): PopoverItemParams {
    const shown = this.shown?.id === property.id ? this.shown : property;
    const status = property.status;
    const element = createOptionsEditor({
      property: shown,
      i18n: this.options.i18n,
      onChange: (options) => this.options.onOptionsChange?.(property.id, options),
      ...(property.type === 'status'
        ? { onSetDefault: (defaultOptionId: string) => update({ status: { groups: status?.groups ?? [], ...status, defaultOptionId } }) }
        : {}),
    });

    return { type: PopoverItemType.Html, element, name: 'options' };
  }

  private settingsItems(property: PropertyDefinition, update: (patch: Partial<PropertySettingsV2>) => void): PopoverItemParams[] {
    if (property.type === 'status') {
      return [this.optionsItem(property, update)];
    }
    if (OPTION_TYPES.has(property.type)) {
      return [this.optionSortItem(property, update), this.optionsItem(property, update)];
    }
    if (property.type === 'relation') {
      return this.relationItems(property, update);
    }
    if (property.type === 'person') {
      return this.personItems(property.person ?? {}, (person) => update({ person }));
    }
    if (property.type === 'rollup') {
      return this.rollupItems(property, update);
    }
    if (property.type === 'formula') {
      return [this.editFormulaItem(property.id, 'editFormula'), ...this.numberItems(property, (number) => update({ number })), this.allViewsNote()];
    }
    if (property.type === 'button') {
      const computed = this.options.computed;

      return buttonEditItems(property, {
        i18n: this.options.i18n,
        schema: () => computed?.schema() ?? [],
        hasHostActions: computed?.hasHostActions === true,
        update,
        hasNotify: computed?.hasNotify === true,
        hasAgent: computed?.hasAgent === true,
        ...(computed?.databaseId === undefined ? {} : { databaseId: computed.databaseId }),
        ...(computed?.dataSources === undefined ? {} : { dataSources: computed.dataSources }),
        ...(computed === undefined ? {} : { targetSchema: computed.targetSchema }),
        ...(computed?.people === undefined ? {} : { people: computed.people }),
        ...(computed?.onEditButtonFilter === undefined ? {} : { editFilter: (actionId: string) => computed.onEditButtonFilter?.(property.id, actionId) }),
      });
    }
    if (property.type === 'number') {
      return this.numberItems(property, (number) => update({ number }));
    }
    if (property.type === 'uniqueId') {
      return [this.inputItem('prefix', property.uniqueId?.prefix ?? '', 'tools.database.idPrefix', (prefix) => update({ uniqueId: prefix === '' ? {} : { prefix } }))];
    }

    const date = property.date ?? {};
    const setDate = (patch: Partial<typeof date>): void => update({ date: { ...date, ...patch } });
    // Saved values feed an i18n key that reaches innerHTML, so only known ones pass.
    const shownDateFormat = DATE_FORMATS.find((format) => format === date.dateFormat) ?? 'full';
    const shownTimeFormat = TIME_FORMATS.find((format) => format === date.timeFormat)
      ?? (resolveHourCycle(resolveLocale(this.options.i18n.getLocale())) === 'h12' ? '12_hour' : '24_hour');

    return [
      {
        name: 'dateFormat',
        title: this.t('tools.database.dateFormat'),
        valueLabel: this.t(`tools.database.dateFormat.${shownDateFormat}`),
        icon: IconCalendar,
        children: {
          ...VALUE_LIST,
          items: DATE_FORMATS.map((format) => ({
            name: `dateFormat-${format}`,
            title: this.t(`tools.database.dateFormat.${format}`),
            ...checkedIf((date.dateFormat ?? 'full') === format),
            closeOnActivate: true,
            onActivate: () => setDate({ dateFormat: format }),
          })),
        },
      },
      {
        name: 'timeFormat',
        title: this.t('tools.database.timeFormat'),
        valueLabel: this.t(`tools.database.timeFormat.${shownTimeFormat}`),
        children: {
          ...VALUE_LIST,
          items: TIME_FORMATS.map((format) => ({
            name: `timeFormat-${format}`,
            title: this.t(`tools.database.timeFormat.${format}`),
            ...checkedIf(shownTimeFormat === format),
            closeOnActivate: true,
            onActivate: () => setDate({ timeFormat: format }),
          })),
        },
      },
      {
        name: 'timeZone',
        title: this.t('tools.database.timeZone'),
        children: {
          searchable: true,
          items: [
            {
              name: 'timeZone-local',
              title: this.t('tools.database.timeZoneLocal'),
              isActive: date.timeZone === undefined,
              closeOnActivate: true,
              onActivate: () => update({ date: without(date, 'timeZone') }),
            },
            ...timeZones().map((zone) => ({
              name: `timeZone-${zone}`,
              title: zone,
              isActive: date.timeZone === zone,
              closeOnActivate: true,
              onActivate: () => setDate({ timeZone: zone }),
            })),
          ],
        },
      },
      this.notificationsItem(date, update),
    ];
  }

  /** "Notifications" (research/17 §1d): the Remind a date set afterwards starts with. Date-only choices. */
  private notificationsItem(date: DateDisplay, update: (patch: Partial<PropertySettingsV2>) => void): PopoverItemParams {
    const t = (key: string, vars?: Record<string, string | number>): string => this.options.i18n.t(key, vars);
    const hourCycle = HOUR_CYCLES[date.timeFormat ?? ''] ?? resolveHourCycle(resolveLocale(this.options.i18n.getLocale()));
    const chosen = date.defaultReminder ?? null;
    const choices: Array<DateReminderOffset | null> = [null, ...remindersFor(false)];

    return {
      name: 'dateNotifications',
      title: this.t('tools.database.dateNotifications'),
      valueLabel: reminderLabel(t, chosen, false, hourCycle),
      children: {
        ...VALUE_LIST,
        items: choices.map((choice) => ({
          name: `dateNotifications-${choice ?? 'none'}`,
          title: reminderLabel(t, choice, true, hourCycle),
          ...checkedIf(choice === chosen),
          closeOnActivate: true,
          onActivate: () => update({ date: choice === null ? without(date, 'defaultReminder') : { ...date, defaultReminder: choice } }),
        })),
      },
    };
  }

  /** `formats`: the Number format and Decimal places rows, which a count has not (notion-spec-2 §3). */
  private numberItems(property: PropertyDefinition, set: (number: NumberDisplay) => void, formats = true): PopoverItemParams[] {
    const number = property.number ?? {};
    // Divide by saves without a redraw, so later picks build on this, not on the drawn `number`.
    const latest = { number };
    const showAs = number.showAs ?? 'number';
    const gauge = showAs === 'bar' || showAs === 'ring';
    const current = OPTION_COLORS.find((color) => color === number.color) ?? 'default';
    // A new gauge starts Green (notion-spec-2 §7); a gauge with no saved colour keeps Default.
    const pick = (value: NumberShowAs): void => set(value === 'number' ? without(latest.number, 'showAs') : { ...latest.number, showAs: value, ...(gauge || latest.number.color !== undefined ? {} : { color: 'green' }) });

    const formatItems: PopoverItemParams[] = [
      {
        name: 'numberFormat',
        title: this.t('tools.database.numberFormat'),
        valueLabel: this.t(`tools.database.numberFormat.${number.format ?? 'number'}`),
        children: {
          ...CLICK_ONLY_UNDER,
          class: PANEL_LIST_CLASS,
          width: '192px',
          searchable: true,
          items: NUMBER_FORMATS.map((format) => ({
            name: `format-${format}`,
            title: this.t(`tools.database.numberFormat.${format}`),
            isActive: (number.format ?? 'number') === format,
            onActivate: () => this.pickFrom('numberFormat', () => set({ ...latest.number, format })),
          })),
        },
      },
      {
        name: 'decimals',
        title: this.t('tools.database.decimalPlaces'),
        valueLabel: number.decimals === undefined ? this.t('tools.database.decimalPlacesDefault') : String(number.decimals),
        children: {
          ...CLICK_ONLY_UNDER,
          class: PANEL_LIST_CLASS,
          width: '250px',
          // Its hint does not stay while the list is open, also when a key opened it.
          onOpen: hideHint,
          items: [
            {
              name: 'decimals-default',
              title: this.t('tools.database.decimalPlacesDefault'),
              // §17.7: a check on the current one; database.css drops the checked fill in these lists.
              isActive: number.decimals === undefined,
              ...(number.decimals === undefined ? { trailingIcon: IconCheck } : {}),
              onActivate: () => this.pickFrom('decimals', () => set(without(latest.number, 'decimals'))),
            },
            ...Array.from({ length: OFFERED_DECIMALS + 1 }, (_, decimals) => ({
              name: `decimals-${decimals}`,
              title: String(decimals),
              isActive: number.decimals === decimals,
              ...(number.decimals === decimals ? { trailingIcon: IconCheck } : {}),
              onActivate: () => this.pickFrom('decimals', () => set({ ...latest.number, decimals })),
            })),
          ],
        },
      },
    ];

    return [
      ...(formats ? formatItems : []),
      { type: PopoverItemType.Separator },
      this.showAsTiles(showAs, pick),
      ...(gauge
        ? [
          {
            name: 'color',
            title: this.t('tools.database.numberColor'),
            valueLabel: this.t(optionColorLabelKey(current)),
            valueIcon: optionSwatch(current),
            children: {
              placement: 'dropdown' as const,
              minWidth: '150px',
              items: OPTION_COLORS.map((color) => ({
                name: `color-${color}`,
                title: this.t(optionColorLabelKey(color)),
                icon: optionSwatch(color),
                trailingIcon: (number.color ?? 'default') === color ? IconCheck : undefined,
                onActivate: () => set({ ...latest.number, color }),
              })),
            },
          },
          this.inputItem('divideBy', number.divideBy === undefined ? '' : String(number.divideBy), 'tools.database.divideBy', (text) => {
            const divideBy = Number(text);
            const next: NumberDisplay = text === '' || !Number.isFinite(divideBy) || divideBy <= 0 ? without(latest.number, 'divideBy') : { ...latest.number, divideBy };

            if (next.divideBy === latest.number.divideBy) return;
            latest.number = next;
            this.options.onUpdate(property.id, { number: next });
          }),
          this.switchItem('showNumber', 'tools.database.showNumber', number.showNumber !== false, (on) => {
            latest.number = on ? without(latest.number, 'showNumber') : { ...latest.number, showNumber: false };
            this.options.onUpdate(property.id, { number: latest.number });
          }),
        ]
        : []),
    ];
  }

  private pickFrom(row: string, write: () => void): void {
    this.pickedRow = row;
    write();
    this.pickedRow = null;
  }

  /** 08-rename.png: a "Show as" heading over Number ("42"), Bar and Ring tiles. */
  private showAsTiles(current: NumberShowAs, pick: (value: NumberShowAs) => void): PopoverItemParams {
    const root = document.createElement('div');
    const heading = document.createElement('div');
    const group = document.createElement('div');

    root.setAttribute('data-blok-database-show-as', '');
    heading.setAttribute('data-blok-database-show-as-heading', '');
    heading.textContent = this.t('tools.database.showAs');
    group.setAttribute('role', 'radiogroup');
    group.setAttribute('aria-label', this.t('tools.database.showAs'));
    group.setAttribute('data-blok-database-show-as-tiles', '');
    for (const value of SHOW_AS) {
      const tile = document.createElement('button');
      const glyph = document.createElement('span');
      const label = document.createElement('span');

      tile.type = 'button';
      tile.setAttribute('role', 'radio');
      tile.setAttribute('aria-checked', String(value === current));
      tile.setAttribute('data-blok-database-show-as-tile', value);
      glyph.setAttribute('data-blok-database-show-as-glyph', '');
      if (value === 'number') {
        glyph.textContent = '42';
      } else {
        // The cell's own gauge, part filled, as Notion draws its tiles.
        const gauge = document.createElement('span');

        gauge.setAttribute(value === 'bar' ? 'data-blok-database-number-bar' : 'data-blok-database-number-ring', '');
        gauge.style.setProperty('--blok-database-number-fill', value === 'bar' ? '50%' : '75%');
        glyph.appendChild(gauge);
      }
      label.textContent = this.t(`tools.database.showAs.${value}`);
      tile.append(glyph, label);
      tile.addEventListener('click', () => {
        for (const other of group.querySelectorAll('[role="radio"]')) other.setAttribute('aria-checked', String(other === tile));
        pick(value);
      });
      group.appendChild(tile);
    }
    root.append(heading, group);

    return { type: PopoverItemType.Html, element: root, name: 'showAs' };
  }

  /** A label and the database switch in one button, saved without a redraw. */
  private switchItem(name: string, labelKey: string, checked: boolean, onToggle: (on: boolean) => void): PopoverItemParams {
    const button = document.createElement('button');
    const track = document.createElement('span');

    button.type = 'button';
    button.setAttribute('role', 'switch');
    button.setAttribute('aria-checked', String(checked));
    button.setAttribute('data-blok-database-property-menu-switch', name);
    track.setAttribute('data-blok-database-switch-track', '');
    track.appendChild(document.createElement('span'));
    button.append(this.t(labelKey), track);
    button.addEventListener('click', () => {
      const on = button.getAttribute('aria-checked') !== 'true';

      button.setAttribute('aria-checked', String(on));
      onToggle(on);
    });

    return { type: PopoverItemType.Html, element: button, name };
  }

  private inputItem(name: string, value: string, labelKey: string, onChange: (value: string) => void): PopoverItemParams {
    const label = document.createElement('label');
    const input = document.createElement('input');

    label.setAttribute('data-blok-database-property-menu-field', name);
    label.append(this.t(labelKey));
    input.type = 'text';
    input.value = value;
    input.addEventListener('change', () => onChange(input.value.trim()));
    label.appendChild(input);

    return { type: PopoverItemType.Html, element: label, name };
  }
}
