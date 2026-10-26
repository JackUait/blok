import { IconCalendar, IconCheck, IconCopy, IconEmojiSmile, IconEyeSlash, IconInfo, IconMessage, IconPencil, IconReplace, IconSliders, IconTrash, IconEmojiSparkles, IconPageLayout, IconWand } from '../../components/icons';
import { nameTakenError } from './database-name-taken-error';
import { PopoverDesktop } from '../../components/utils/popover';
import { DATA_ATTR } from '../../components/constants/data-attributes';
import { PopoverItemType } from '../../components/utils/popover/components/popover-item';
import type { PopoverItemParams } from '../../../types/utils/popover/popover-item';
import { PopoverEvent } from '../../../types/utils/popover/popover-event';
import type { I18n } from '../../../types';
import { EmojiPicker } from '../callout/emoji-picker';
import { NUMBER_FORMATS, MAX_DECIMALS } from './cells/number-format';
import { OPTION_COLORS, optionColorLabelKey } from './cells/option-colors';
import { addablePropertyTypes, propertyTypeMeta } from './database-property-types';
import { ROLLUP_FUNCTIONS, rollupFunctionsFor, rollupResultType } from './rollup';
import { buttonEditItems } from './database-button-menu';
import { createOptionsEditor } from './cells/options-editor';
import { offersAutofill } from './database-autofill-setup';
import { DATABASE_HEADER_MENU_CLASS, SHOW_PAGE_ICON_ITEM } from './database-table-menus';
import { reminderLabel, remindersFor } from './reminders';
import { DATE_FORMATS, HOUR_CYCLES, TIME_FORMATS, resolveHourCycle, resolveLocale, timeZones } from './cells/date-format';
import { overlayMountFor } from '../../components/utils/top-layer';
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
  /** Turns a relation's mirroring property on the target database on or off. */
  onSetTwoWay: (propertyId: string, twoWay: boolean) => void;
  /** The host set `config.buttons.onAction`: buttons may call it. */
  hasHostActions?: boolean;
  /** The host set `config.buttons.onNotify`: buttons may send notifications. */
  hasNotify?: boolean;
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

const withoutLimit = ({ limit: _limit, ...rest }: RelationSettings): RelationSettings => rest;

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
    const name = this.nameField(property, property.type !== 'title');
    const update = this.showAsUpdate(property, name, (number, kept) => {
      this.swap();
      this.drawHeaderMenu({ ...property, number }, this.options.liveAnchor?.() ?? anchor, viewItems, { ...shown, number }, kept);
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
      ...head.map((entry) => this.entry(entry, property, false, update)),
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
   * Writes a settings patch. A new Show as draws the menu again through `redraw`,
   * so Color and Divide by come or go and later rows write the new choice.
   */
  private showAsUpdate(property: PropertyDefinition, name: HTMLElement, redraw: (number: NumberDisplay, typed: string | undefined) => void): (patch: Partial<PropertySettingsV2>) => void {
    return (patch) => {
      this.options.onUpdate(property.id, patch);
      if (patch.number === undefined || patch.number.showAs === property.number?.showAs) return;
      const input = name.querySelector('input');

      // The old field goes away without a blur: save its name first, as leaving it would.
      input?.dispatchEvent(new Event('change'));
      redraw(patch.number, input?.value);
    };
  }

  /**
   * The row page's own menu for a property label (research/09:93, research/36:261):
   * Rename, Edit property, Comment, Property visibility, Duplicate, Delete, Customize layout.
   * No view rows: the row page is no column.
   */
  openRowPage(property: PropertyDefinition, anchor: HTMLElement, extras: { onComment?: () => void; edit?: boolean } = {}): void {
    this.close();
    this.shown = property;
    if (extras.edit === true) {
      this.openRowPageEdit(property, anchor);

      return;
    }
    const has = (entry: PropertyMenuEntry): boolean => propertyMenuEntries(property).includes(entry);
    // Notion: Rename and Edit property both open the Edit property panel.
    const edit = (): void => this.openRowPageEdit(property, anchor);
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
  private openRowPageEdit(property: PropertyDefinition, anchor: HTMLElement, typed?: string): void {
    this.swap();
    const entries = propertyMenuEntries(property);
    const has = (entry: PropertyMenuEntry): boolean => entries.includes(entry);
    const name = this.nameField(property, property.type !== 'title');
    const update = this.showAsUpdate(property, name, (number, kept) => this.openRowPageEdit({ ...property, number }, anchor, kept));
    const settings: PopoverItemParams[] = [];

    if (EDITABLE_SETTINGS.has(property.type)) {
      settings.push(...(property.type === 'formula' ? [this.entry('editProperty', property)] : this.editItems(property, update)));
    }
    const typeItems = (['changeType', 'displayAs'] as const).filter(has).map((entry) => this.entry(entry, property, true));
    const tail = (['duplicate', 'delete'] as const).filter(has).map((entry) => this.entry(entry, property));
    const separator = { type: PopoverItemType.Separator } as const;
    // 08-rename.png: a number's format rows sit under Type with no rule; its rule comes before Show as.
    const ruled = typeItems.length > 0 && settings.length > 0 && property.type !== 'number';
    const items: PopoverItemParams[] = [
      { type: PopoverItemType.Html, element: name, name: 'name' },
      ...typeItems,
      ...(ruled ? [separator] : []),
      ...settings,
      ...(tail.length > 0 ? [separator, ...tail] : []),
    ];

    this.show(items, anchor, '290px', ROW_PAGE_MENU_CLASS, typed !== undefined);
    const input = name.querySelector('input');

    if (typed !== undefined) {
      if (input !== null) input.value = typed;

      return;
    }
    input?.focus();
    input?.select();
  }

  /** `redraw`: stands in for the open menu, so it shows with no entrance. */
  private show(items: PopoverItemParams[], anchor: HTMLElement, minWidth: string, className = DATABASE_HEADER_MENU_CLASS, redraw = false): void {
    const rowPage = className === ROW_PAGE_MENU_CLASS;
    const popover = new PopoverDesktop({
      class: className, animateClose: true, items, trigger: anchor, width: 'auto', minWidth, flippable: true, autoFocusFirstItem: false,
      // Notion opens the row page menu 1px under the label.
      ...(rowPage ? { offset: 1 } : {}),
    });

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

  /** `panel`: the row page's Edit property panel, whose type row reads "Type" (research/10 L16); the header menu keeps "Change type". */
  private entry(
    entry: PropertyMenuEntry,
    property: PropertyDefinition,
    panel = false,
    update: (patch: Partial<PropertySettingsV2>) => void = (patch) => this.options.onUpdate(property.id, patch),
  ): PopoverItemParams {
    const id = property.id;

    switch (entry) {
      case 'editProperty':
        if (property.type === 'formula') {
          return { name: entry, title: this.t('tools.database.editProperty'), icon: IconPencil, closeOnActivate: true, onActivate: () => this.options.computed?.onEditFormula(id) };
        }

        // research/08: Notion names a button's settings "Edit automation".
        return {
          name: entry,
          title: this.t(property.type === 'button' ? 'tools.database.editAutomation' : 'tools.database.editProperty'),
          icon: IconPencil,
          children: { items: this.editItems(property, update) },
        };
      case 'displayAs': {
        const status = property.status;
        const current = status?.showAs ?? 'select';

        return {
          name: entry,
          title: this.t('tools.database.statusDisplayAs'),
          icon: IconEmojiSparkles,
          children: {
            items: (['select', 'checkbox'] as const).map((showAs) => ({
              name: `displayAs-${showAs}`,
              title: this.t(`tools.database.statusDisplayAs.${showAs}`),
              isActive: current === showAs,
              closeOnActivate: true,
              onActivate: () => update({ status: { groups: status?.groups ?? [], ...status, showAs } }),
            })),
          },
        };
      }
      case 'changeType':
        return {
          name: entry,
          ...(panel
            ? { title: this.t('tools.database.propertyTypeListHeading'), icon: IconReplace, valueLabel: this.t(propertyTypeMeta(property.type).labelKey) }
            : { title: this.t('tools.database.changeType'), icon: propertyTypeMeta(property.type).icon }),
          children: {
            items: addablePropertyTypes(this.options.hasPeople)
              .filter((type) => type !== property.type)
              .map((type) => ({
                name: `type-${type}`,
                title: this.t(propertyTypeMeta(type).labelKey),
                icon: propertyTypeMeta(type).icon,
                closeOnActivate: true,
                onActivate: () => this.options.onChangeType(id, type),
              })),
          },
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
    const host = this.options.computed;
    const settings = property.relation ?? { targetDatabaseId: '' };
    const limit = settings.limit === 1 ? 'one' : 'none';

    return [
      {
        name: 'relatedTo',
        title: this.t('tools.database.relationRelatedTo'),
        children: {
          items: (host?.databases() ?? []).map((database) => ({
            name: `relatedTo-${database.id}`,
            title: database.title === '' ? this.t('tools.database.relationUntitledDatabase') : database.title,
            isActive: settings.targetDatabaseId === database.id,
            closeOnActivate: true,
            // A new target starts one-way: the old mirror belongs to the old target.
            onActivate: () => update({ relation: { targetDatabaseId: database.id } }),
          })),
        },
      },
      {
        name: 'limit',
        title: this.t('tools.database.relationLimit'),
        children: {
          items: (['none', 'one'] as const).map((choice) => ({
            name: `limit-${choice}`,
            title: this.t(choice === 'one' ? 'tools.database.relationLimitOne' : 'tools.database.relationLimitNone'),
            isActive: limit === choice,
            closeOnActivate: true,
            onActivate: () => update({ relation: choice === 'one' ? { ...settings, limit: 1 } : withoutLimit(settings) }),
          })),
        },
      },
      {
        name: 'twoWay',
        title: this.t('tools.database.relationTwoWay'),
        isActive: settings.twoWay === true,
        closeOnActivate: true,
        onActivate: () => host?.onSetTwoWay(property.id, settings.twoWay !== true),
      },
    ];
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
        items: choices.map(([choice, labelKey]) => ({
          name: [name, choice].join('-'),
          title: this.t(labelKey),
          isActive: choice === chosen,
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
    const target = targets.find((p) => p.id === settings.targetPropertyId);
    const set = (patch: Partial<typeof settings>): void => update({ rollup: { ...settings, ...patch } });

    return [
      {
        name: 'rollupRelation',
        title: this.t('tools.database.rollupRelation'),
        children: {
          items: relations.map((p) => ({
            name: `rollupRelation-${p.id}`,
            title: p.name,
            isActive: p.id === settings.relationPropertyId,
            closeOnActivate: true,
            onActivate: () => set({ relationPropertyId: p.id }),
          })),
        },
      },
      {
        name: 'rollupProperty',
        title: this.t('tools.database.rollupProperty'),
        children: {
          // H-rr: a rollup of a rollup is not offered.
          items: targets.filter((p) => p.type !== 'rollup').map((p) => ({
            name: `rollupProperty-${p.id}`,
            title: p.name,
            isActive: p.id === settings.targetPropertyId,
            closeOnActivate: true,
            onActivate: () => set({ targetPropertyId: p.id }),
          })),
        },
      },
      {
        name: 'rollupFunction',
        title: this.t('tools.database.rollupFunction'),
        children: {
          items: (target === undefined ? ROLLUP_FUNCTIONS : rollupFunctionsFor(target)).map((fn) => ({
            name: `rollupFunction-${fn}`,
            title: this.t(`tools.database.rollupFn.${fn}`),
            isActive: fn === settings.function,
            closeOnActivate: true,
            onActivate: () => set({ function: fn }),
          })),
        },
      },
      ...(target !== undefined && rollupResultType(settings.function, target).type === 'number'
        ? this.numberItems(property.number ?? {}, (number) => update({ number }))
        : []),
    ];
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
    if (OPTION_TYPES.has(property.type)) {
      return [this.optionsItem(property, update)];
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
    if (property.type === 'button') {
      const computed = this.options.computed;

      return buttonEditItems(property, {
        i18n: this.options.i18n,
        schema: () => computed?.schema() ?? [],
        hasHostActions: computed?.hasHostActions === true,
        update,
        hasNotify: computed?.hasNotify === true,
        ...(computed?.databaseId === undefined ? {} : { databaseId: computed.databaseId }),
        ...(computed?.dataSources === undefined ? {} : { dataSources: computed.dataSources }),
        ...(computed === undefined ? {} : { targetSchema: computed.targetSchema }),
        ...(computed?.people === undefined ? {} : { people: computed.people }),
        ...(computed?.onEditButtonFilter === undefined ? {} : { editFilter: (actionId: string) => computed.onEditButtonFilter?.(property.id, actionId) }),
      });
    }
    if (property.type === 'number') {
      return this.numberItems(property.number ?? {}, (number) => update({ number }), true);
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
          items: DATE_FORMATS.map((format) => ({
            name: `dateFormat-${format}`,
            title: this.t(`tools.database.dateFormat.${format}`),
            isActive: (date.dateFormat ?? 'full') === format,
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
          items: TIME_FORMATS.map((format) => ({
            name: `timeFormat-${format}`,
            title: this.t(`tools.database.timeFormat.${format}`),
            isActive: date.timeFormat === format,
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
        items: choices.map((choice) => ({
          name: `dateNotifications-${choice ?? 'none'}`,
          title: reminderLabel(t, choice, true, hourCycle),
          isActive: choice === chosen,
          closeOnActivate: true,
          onActivate: () => update({ date: choice === null ? without(date, 'defaultReminder') : { ...date, defaultReminder: choice } }),
        })),
      },
    };
  }

  /** `tiles`: Show as as Notion's three tiles (measured for a number property only; a rollup keeps its list). */
  private numberItems(number: NumberDisplay, set: (number: NumberDisplay) => void, tiles = false): PopoverItemParams[] {
    const showAs = number.showAs ?? 'number';
    const gauge = showAs === 'bar' || showAs === 'ring';
    const pick = (value: NumberShowAs): void => set(value === 'number' ? without(number, 'showAs') : { ...number, showAs: value });

    return [
      {
        name: 'numberFormat',
        title: this.t('tools.database.numberFormat'),
        valueLabel: this.t(`tools.database.numberFormat.${number.format ?? 'number'}`),
        children: {
          searchable: true,
          items: NUMBER_FORMATS.map((format) => ({
            name: `format-${format}`,
            title: this.t(`tools.database.numberFormat.${format}`),
            isActive: (number.format ?? 'number') === format,
            closeOnActivate: true,
            onActivate: () => set({ ...number, format }),
          })),
        },
      },
      {
        name: 'decimals',
        title: this.t('tools.database.decimalPlaces'),
        valueLabel: number.decimals === undefined ? this.t('tools.database.decimalPlacesDefault') : String(number.decimals),
        children: {
          items: [
            {
              name: 'decimals-default',
              title: this.t('tools.database.decimalPlacesDefault'),
              isActive: number.decimals === undefined,
              closeOnActivate: true,
              onActivate: () => set(without(number, 'decimals')),
            },
            ...Array.from({ length: MAX_DECIMALS + 1 }, (_, decimals) => ({
              name: `decimals-${decimals}`,
              title: String(decimals),
              isActive: number.decimals === decimals,
              closeOnActivate: true,
              onActivate: () => set({ ...number, decimals }),
            })),
          ],
        },
      },
      ...(tiles ? [{ type: PopoverItemType.Separator } as const, this.showAsTiles(showAs, pick)] : [{
        name: 'showAs',
        title: this.t('tools.database.showAs'),
        children: {
          items: SHOW_AS.map((value) => ({
            name: `showAs-${value}`,
            title: this.t(`tools.database.showAs.${value}`),
            isActive: showAs === value,
            closeOnActivate: true,
            onActivate: () => pick(value),
          })),
        },
      }]),
      ...(gauge
        ? [
          {
            name: 'color',
            title: this.t('tools.database.numberColor'),
            children: {
              items: OPTION_COLORS.map((color) => ({
                name: `color-${color}`,
                title: this.t(optionColorLabelKey(color)),
                isActive: (number.color ?? 'default') === color,
                closeOnActivate: true,
                onActivate: () => set({ ...number, color }),
              })),
            },
          },
          this.inputItem('divideBy', number.divideBy === undefined ? '' : String(number.divideBy), 'tools.database.divideBy', (text) => {
            const divideBy = Number(text);

            set(text === '' || !Number.isFinite(divideBy) || divideBy <= 0 ? without(number, 'divideBy') : { ...number, divideBy });
          }),
        ]
        : []),
    ];
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
