import { IconCalendar, IconCopy, IconEmojiSmile, IconPencil, IconTrash, IconEmojiSparkles, IconMessage, IconWand } from '../../components/icons';
import { PopoverDesktop } from '../../components/utils/popover';
import { DATA_ATTR } from '../../components/constants/data-attributes';
import { PopoverItemType } from '../../components/utils/popover/components/popover-item';
import type { PopoverItemParams } from '../../../types/utils/popover/popover-item';
import { PopoverEvent } from '../../../types/utils/popover/popover-event';
import type { I18n } from '../../../types';
import { EmojiPicker } from '../callout/emoji-picker';
import { NUMBER_FORMATS, MAX_DECIMALS } from './cells/number-format';
import { OPTION_COLORS, optionColorLabelKey } from './cells/option-colors';
import { DATABASE_MENU_CLASS } from './database-group-menu';
import { addablePropertyTypes, propertyTypeMeta } from './database-property-types';
import { ROLLUP_FUNCTIONS, rollupFunctionsFor, rollupResultType } from './rollup';
import { buttonEditItems } from './database-button-menu';
import { createOptionsEditor } from './cells/options-editor';
import { offersAutofill } from './database-autofill-setup';
import { SHOW_PAGE_ICON_ITEM } from './database-table-menus';
import type {
  DateDisplay,
  DateFormat,
  NumberDisplay,
  NumberShowAs,
  PageVisibility,
  PropertyDefinition,
  PropertySettingsV2,
  PropertyType,
  RelationSettings,
  SelectOption,
  TimeFormat,
} from './types';

export type PropertyMenuEntry = 'editProperty' | 'displayAs' | 'changeType' | 'description' | 'visibility' | 'duplicate' | 'delete';

/** Rows that come before the view's own rows; the rest come after. */
const HEAD_ENTRIES: ReadonlySet<PropertyMenuEntry> = new Set<PropertyMenuEntry>(['editProperty', 'displayAs', 'changeType']);

/** Types whose "Edit property" panel holds settings Blok has. Person is in Notion's list too, but what its panel holds is unmeasured. */
const EDITABLE_SETTINGS: ReadonlySet<PropertyType> = new Set<PropertyType>([
  'number', 'select', 'multiSelect', 'status', 'date', 'createdTime', 'lastEditedTime', 'uniqueId', 'relation', 'rollup', 'formula', 'button',
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
  // research/08: the Title menu has no description row.
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
    'description',
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
}

const DATE_FORMATS: readonly DateFormat[] = ['full', 'short', 'month_day_year', 'day_month_year', 'year_month_day', 'relative'];
const TIME_FORMATS: readonly TimeFormat[] = ['12_hour', '24_hour', 'hidden'];
const SHOW_AS: readonly NumberShowAs[] = ['number', 'bar', 'ring'];
const VISIBILITY: readonly PageVisibility[] = ['always', 'hideWhenEmpty', 'hidden'];

const timeZones = (): string[] => {
  const intl = Intl as typeof Intl & { supportedValuesOf?: (key: 'timeZone') => string[] };

  try {
    return intl.supportedValuesOf?.('timeZone') ?? [];
  } catch {
    return [];
  }
};

const withoutLimit = ({ limit: _limit, ...rest }: RelationSettings): RelationSettings => rest;

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
    this.shown = shown;
    const entries = propertyMenuEntries(property);
    const head = entries.filter((entry) => HEAD_ENTRIES.has(entry));
    const tail = entries.filter((entry) => !HEAD_ENTRIES.has(entry));
    // research/08: Title reads "Show page icon, AI Autofill, Filter…".
    const lead = viewItems.filter((item) => item.type === PopoverItemType.Default && item.name === SHOW_PAGE_ICON_ITEM);
    const rest = viewItems.filter((item) => !lead.includes(item));
    const items: PopoverItemParams[] = [
      { type: PopoverItemType.Html, element: this.nameField(property), name: 'name' },
      { type: PopoverItemType.Separator },
      ...head.map((entry) => this.entry(entry, property)),
      ...lead,
      ...this.autofillItem(property),
      ...(rest.length > 0 ? [{ type: PopoverItemType.Separator } as const, ...rest, ...(tail.length > 0 ? [{ type: PopoverItemType.Separator } as const] : [])] : []),
      ...tail.map((entry) => this.entry(entry, property)),
    ];
    const popover = new PopoverDesktop({ class: DATABASE_MENU_CLASS, animateClose: true, items, trigger: anchor, width: 'auto', minWidth: '240px', flippable: true, autoFocusFirstItem: false });

    this.popover = popover;
    popover.on(PopoverEvent.Closed, () => {
      if (this.popover === popover) {
        this.popover = null;
        queueMicrotask(() => popover.destroy());
        this.options.onClose?.();
      }
    });
    popover.show();
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
    popover?.destroy();
    if (popover !== null) this.options.onClose?.();
  }

  destroy(): void {
    this.close();
    this.emojiPicker?.close();
    this.emojiPicker?.getElement().remove();
    this.emojiPicker = null;
  }

  private nameField(property: PropertyDefinition): HTMLElement {
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
    input.setAttribute('aria-label', this.t('tools.database.propertyName'));
    const commit = (): void => {
      const name = input.value.trim();

      if (name !== '' && name !== property.name) {
        this.options.onRename(property.id, name);
      }
    };

    input.addEventListener('change', commit);
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && !event.isComposing) {
        event.preventDefault();
        commit();
        this.close();
      }
    });
    row.append(icon, input);

    return row;
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
      document.body.appendChild(element);
    }
    void this.emojiPicker.open(anchor, undefined, handlers);
  }

  private entry(entry: PropertyMenuEntry, property: PropertyDefinition): PopoverItemParams {
    const id = property.id;
    const update = (patch: Partial<PropertySettingsV2>): void => this.options.onUpdate(id, patch);

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
          title: this.t('tools.database.changeType'),
          icon: propertyTypeMeta(property.type).icon,
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
      case 'description':
        return { name: entry, title: this.t('tools.database.propertyDescription'), icon: IconMessage, children: { items: [this.descriptionField(property, update)] } };
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

  private descriptionField(property: PropertyDefinition, update: (patch: Partial<PropertySettingsV2>) => void): PopoverItemParams {
    const area = document.createElement('textarea');

    area.setAttribute('data-blok-database-property-description', '');
    area.setAttribute('aria-label', this.t('tools.database.propertyDescription'));
    area.placeholder = this.t('tools.database.propertyDescriptionPlaceholder');
    area.value = property.description ?? '';
    area.rows = 3;
    area.addEventListener('change', () => update({ description: area.value.trim() === '' ? undefined : area.value }));

    const wrap = document.createElement('div');

    wrap.setAttribute('data-blok-keyboard-owner', '');
    wrap.appendChild(area);

    return { type: PopoverItemType.Html, element: wrap, name: 'description-field' };
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

  private optionsItem(property: PropertyDefinition): PopoverItemParams {
    const shown = this.shown?.id === property.id ? this.shown : property;
    const element = createOptionsEditor({
      property: shown,
      i18n: this.options.i18n,
      onChange: (options) => this.options.onOptionsChange?.(property.id, options),
    });

    return { type: PopoverItemType.Html, element, name: 'options' };
  }

  private settingsItems(property: PropertyDefinition, update: (patch: Partial<PropertySettingsV2>) => void): PopoverItemParams[] {
    if (OPTION_TYPES.has(property.type)) {
      return [this.optionsItem(property)];
    }
    if (property.type === 'relation') {
      return this.relationItems(property, update);
    }
    if (property.type === 'rollup') {
      return this.rollupItems(property, update);
    }
    if (property.type === 'button') {
      return buttonEditItems(property, {
        i18n: this.options.i18n,
        schema: () => this.options.computed?.schema() ?? [],
        hasHostActions: this.options.computed?.hasHostActions === true,
        update,
      });
    }
    if (property.type === 'number') {
      return this.numberItems(property.number ?? {}, (number) => update({ number }));
    }
    if (property.type === 'uniqueId') {
      return [this.inputItem('prefix', property.uniqueId?.prefix ?? '', 'tools.database.idPrefix', (prefix) => update({ uniqueId: prefix === '' ? {} : { prefix } }))];
    }

    const date = property.date ?? {};
    const setDate = (patch: Partial<typeof date>): void => update({ date: { ...date, ...patch } });

    return [
      {
        name: 'dateFormat',
        title: this.t('tools.database.dateFormat'),
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
    ];
  }

  private numberItems(number: NumberDisplay, set: (number: NumberDisplay) => void): PopoverItemParams[] {
    const showAs = number.showAs ?? 'number';
    const gauge = showAs === 'bar' || showAs === 'ring';

    return [
      {
        name: 'numberFormat',
        title: this.t('tools.database.numberFormat'),
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
      {
        name: 'showAs',
        title: this.t('tools.database.showAs'),
        children: {
          items: SHOW_AS.map((value) => ({
            name: `showAs-${value}`,
            title: this.t(`tools.database.showAs.${value}`),
            isActive: showAs === value,
            closeOnActivate: true,
            onActivate: () => set(value === 'number' ? without(number, 'showAs') : { ...number, showAs: value }),
          })),
        },
      },
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
