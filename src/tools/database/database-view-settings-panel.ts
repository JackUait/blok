import { IconCopy, IconLink, IconPlus, IconTrash } from '../../components/icons';
import type { I18n } from '../../../types';
import {
  DatabasePanel,
  panelInput,
  panelLabel,
  panelReorderList,
  panelRow,
  panelSeparator,
  panelSwitch,
  panelText,
} from './database-panel';
import type { PanelPage } from './database-panel';
import {
  WITHIN_OPERATORS,
  defaultFilterFor,
  filterPillLabel,
  menuOperatorOf,
  operatorChoices,
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
import { GROUPABLE_TYPES, defaultGroupSort } from './group-keys';
import { RELATIVE_DATE_UNITS, RELATIVE_DATE_VALUES, formatRelativeSpan, parseRelativeSpan } from './relative-dates';
import { ME_FILTER_VALUE } from './database-query';
import { COLOR_RULE_LAYOUTS, COLOR_RULE_TYPES, isGroupHidden, withGroupFlags } from './view-data';
import {
  LOAD_LIMITS,
  resolveLoadLimit,
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
  ViewType,
} from './types';
import { nanoid } from 'nanoid';

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
  duplicateView: () => void;
  deleteView: () => void;
  copyViewLink: () => void;
  /** The groups of the view's grouping (`sub` for the board's sub-grouping). */
  groups: (sub: boolean) => ViewGroupEntry[];
  /** People the host lists, for person filters. */
  people?: () => Array<{ id: string; name: string }>;
}

/** The option colors Notion offers (research/08). */
const COLORS = ['default', 'gray', 'brown', 'orange', 'yellow', 'green', 'blue', 'purple', 'pink', 'red'] as const;

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
      build: (panel) => {
        const view = this.ctx.view();
        const group = this.property(view.groupBy);
        const rows: HTMLElement[] = [
          panelRow({
            label: this.t('settingsLayout'),
            testId: 'database-settings-layout',
            value: this.t(`viewType${capital(view.type)}`),
            opensPage: true,
            onClick: () => panel.push(this.layout()),
          }),
          panelRow({
            label: this.t('settingsPropertyVisibility'),
            testId: 'database-settings-properties',
            value: String(resolveViewProperties(view, this.ctx.schema()).filter((p) => p.visible).length),
            opensPage: true,
            onClick: () => panel.push(this.properties()),
          }),
          panelRow({
            label: this.t('settingsFilter'),
            testId: 'database-settings-filter',
            value: String(view.filters.length + countFilterRules(view.filterTree)),
            opensPage: true,
            onClick: () => panel.push(this.filters()),
          }),
          panelRow({
            label: this.t('settingsSort'),
            testId: 'database-settings-sort',
            value: String(view.sorts.length),
            opensPage: true,
            onClick: () => panel.push(this.sorts()),
          }),
          panelRow({
            label: this.t('settingsGroup'),
            testId: 'database-settings-group',
            value: group?.name ?? this.t('settingsNone'),
            opensPage: true,
            onClick: () => panel.push(this.group(false)),
          }),
        ];

        if (view.type === 'board') {
          rows.push(panelRow({
            label: this.t('settingsSubGroup'),
            testId: 'database-settings-subgroup',
            value: this.property(view.subGroupBy)?.name ?? this.t('settingsNone'),
            opensPage: true,
            onClick: () => panel.push(this.group(true)),
          }));
        }
        if (COLOR_RULE_LAYOUTS.includes(view.type)) {
          rows.push(panelRow({
            label: this.t('settingsConditionalColor'),
            testId: 'database-settings-color',
            value: String(view.colorRules?.length ?? 0),
            opensPage: true,
            onClick: () => panel.push(this.colors()),
          }));
        }
        rows.push(
          panelRow({ label: this.t('settingsCopyLink'), testId: 'database-settings-copy-link', icon: IconLink, onClick: () => this.ctx.copyViewLink() }),
          panelSeparator(),
          panelSwitch({
            label: this.t('settingsLockDatabase'),
            testId: 'database-settings-lock',
            checked: this.ctx.locked(),
            onToggle: (next) => {
              this.ctx.setLocked(next);
              panel.refresh();
            },
          }),
          panelRow({
            label: this.t('duplicateView'),
            testId: 'database-settings-duplicate',
            icon: IconCopy,
            disabled: !this.shared,
            onClick: () => {
              panel.close();
              this.ctx.duplicateView();
            },
          }),
          panelRow({
            label: this.t('deleteView'),
            testId: 'database-settings-delete',
            icon: IconTrash,
            danger: true,
            disabled: !this.shared || !this.ctx.canDeleteView(),
            onClick: () => {
              panel.close();
              this.ctx.deleteView();
            },
          })
        );

        return rows;
      },
    };
  }

  // ─── Layout ───

  private layout(): PanelPage {
    return {
      title: this.t('settingsLayout'),
      build: (panel) => {
        const view = this.ctx.view();
        const switches: HTMLElement[] = [
          panelSwitch({
            label: this.t('settingsWrapAll'),
            testId: 'database-settings-wrap',
            checked: resolveWrapCells(view),
            disabled: !this.shared,
            onToggle: (next) => this.ctx.updateView({ wrapCells: next }),
          }),
        ];

        if (view.type === 'table') {
          switches.push(panelSwitch({
            label: this.t('settingsVerticalLines'),
            testId: 'database-settings-vertical-lines',
            checked: resolveShowVerticalLines(view),
            disabled: !this.shared,
            onToggle: (next) => this.ctx.updateView({ showVerticalLines: next }),
          }));
        }
        switches.push(panelSwitch({
          label: this.t('settingsShowPageIcon'),
          testId: 'database-settings-page-icon',
          checked: view.showPageIcon !== false,
          disabled: !this.shared,
          onToggle: (next) => this.ctx.updateView({ showPageIcon: next }),
        }));

        return [
          ...this.ctx.layouts.map((type) => panelRow({
            label: this.t(`viewType${capital(type)}`),
            testId: `database-layout-${type}`,
            checked: view.type === type,
            disabled: !this.shared,
            onClick: () => {
              this.ctx.setLayout(type);
              panel.refresh();
            },
          })),
          panelSeparator(),
          panelRow({
            label: this.t('settingsOpenPagesIn'),
            testId: 'database-settings-open-pages',
            value: this.t(`openPages${capital(resolveOpenPagesIn(view))}`),
            opensPage: true,
            onClick: () => panel.push(this.openPagesIn()),
          }),
          panelRow({
            label: this.t('settingsLoadLimit'),
            testId: 'database-settings-load-limit',
            value: String(resolveLoadLimit(view)),
            opensPage: true,
            onClick: () => panel.push(this.loadLimit()),
          }),
          ...switches,
        ];
      },
    };
  }

  private openPagesIn(): PanelPage {
    const modes: OpenPagesIn[] = ['side', 'center', 'full'];

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
      ]),
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

  private properties(): PanelPage {
    return {
      title: this.t('settingsPropertyVisibility'),
      build: (panel) => {
        const schema = this.ctx.schema();
        const view = this.ctx.view();
        const items = resolveViewProperties(view, schema).flatMap((entry) => {
          const property = schema.find((p) => p.id === entry.id);

          if (property === undefined) return [];
          const control = property.type === 'title'
            ? panelText(property.name)
            : panelSwitch({
              label: property.name,
              testId: `database-property-visible-${property.id}`,
              checked: entry.visible,
              disabled: !this.shared,
              onToggle: (next) => this.ctx.updateView({ properties: withPropertySetting(this.ctx.view(), this.ctx.schema(), property.id, { visible: next }) }),
            });

          return [{ id: property.id, element: control }];
        });

        return [panelReorderList({
          testId: 'database-properties-list',
          handleLabel: this.t('settingsDragToReorder'),
          items,
          onMove: (id, beforeId) => {
            if (!this.shared) return;
            this.ctx.updateView({ properties: withPropertyOrder(this.ctx.view(), this.ctx.schema(), id, beforeId) });
            panel.refresh();
          },
        })];
      },
    };
  }

  // ─── Property picker ───

  private pickProperty(title: string, types: readonly PropertyType[], onPick: (property: PropertyDefinition) => void): PanelPage {
    return {
      title,
      build: () => this.ctx.schema()
        .filter((p) => types.includes(p.type))
        .map((property) => panelRow({
          label: property.name,
          testId: `database-pick-property-${property.id}`,
          onClick: () => onPick(property),
        })),
    };
  }

  // ─── Filters ───

  /** The Filter page: simple filters (reorderable), then the advanced filter. */
  filters(): PanelPage {
    return {
      title: this.t('settingsFilter'),
      build: (panel) => {
        const view = this.ctx.view();
        const schema = this.ctx.schema();
        const filters = withEntryIds(view.filters);
        const items = filters.flatMap((filter) => {
          const property = schema.find((p) => p.id === filter.propertyId);

          if (property === undefined) return [];

          return [{
            id: filter.id,
            element: panelRow({
              label: filterPillLabel(filter, property, (key, vars) => this.ctx.i18n.t(key, vars), (id) => this.personName(id)),
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
            onClick: () => panel.push(this.pickProperty(this.t('filterAdd'), GROUPABLE_TYPES, (property) => {
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
    const current = (): FilterConfig | undefined => this.ctx.view().filters.find((f) => f.id === filterId);
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
        const rows: HTMLElement[] = [
          panelRow({
            label: property.name,
            testId: 'database-filter-operator',
            value: opKey === undefined ? current.operator : this.ctx.i18n.t(opKey),
            opensPage: true,
            onClick: () => panel.push(this.operators(property, current.operator, (operator) => {
              rule.update(operator === 'within' ? { operator: 'this_week', value: null } : { operator, value: this.valueFor(property, operator, current.value) });
              panel.back();
            })),
          }),
          ...this.valueControls(property, current, (patch) => {
            rule.update(patch);
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

  /** Keeps a value the new operator can still read; otherwise starts it empty. */
  private valueFor(property: PropertyDefinition, operator: string, value: FilterConfig['value']): FilterConfig['value'] {
    if (!operatorNeedsValue(operator)) return null;
    if (operator === 'relative_to_today') return parseRelativeSpan(value) === undefined ? 'past:1:week' : value;
    if (property.type === 'date' && parseRelativeSpan(value) !== undefined) return 'today';

    return value;
  }

  private operators(property: PropertyDefinition, current: string, onPick: (operator: string) => void): PanelPage {
    return {
      title: property.name,
      build: () => operatorChoices(property.type).map((choice) => panelRow({
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
    update: (patch: Partial<Pick<FilterConfig, 'operator' | 'value'>>) => void
  ): HTMLElement[] {
    const { operator, value } = filter;

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
      case 'files':
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
    // A view from before filterTree existed gets one tree for the page's life, so ids stay put.
    const fallback = emptyFilterTree();
    const tree = (): FilterGroup => this.ctx.view().filterTree ?? fallback;
    const write = (next: FilterGroup): void => this.ctx.updatePersonal({ filterTree: next });

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
        label: property === undefined ? this.t('filterGone') : filterPillLabel(node, property, (key, vars) => this.ctx.i18n.t(key, vars), (id) => this.personName(id)),
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
      onClick: () => panel.push(this.pickProperty(this.t('filterAddRule'), GROUPABLE_TYPES, (property) => {
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
    return {
      title: this.t('settingsSort'),
      build: (panel) => {
        const schema = this.ctx.schema();
        const sorts = withEntryIds(this.ctx.view().sorts);
        const write = (next: SortConfig[]): void => {
          this.ctx.updatePersonal({ sorts: next });
          panel.refresh();
        };
        const items = sorts.flatMap((sort) => {
          const property = schema.find((p) => p.id === sort.propertyId);

          if (property === undefined) return [];
          const line = document.createElement('div');

          line.setAttribute('data-blok-database-sort-row', '');
          line.setAttribute('data-blok-testid', `database-sort-row-${sort.id}`);
          line.append(
            panelRow({
              label: property.name,
              testId: `database-sort-property-${sort.id}`,
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
            panelRow({
              label: this.t('sortRemove'),
              testId: `database-sort-remove-${sort.id}`,
              icon: IconTrash,
              onClick: () => write(sorts.filter((s) => s.id !== sort.id)),
            })
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
            icon: IconPlus,
            onClick: () => panel.push(this.pickProperty(this.t('sortAdd'), GROUPABLE_TYPES, (property) => {
              this.ctx.updatePersonal({ sorts: [...sorts, { id: nanoid(), propertyId: property.id, direction: 'asc' }] });
              panel.back();
            })),
          }),
          panelRow({
            label: this.t('sortDeleteAll'),
            testId: 'database-sort-delete-all',
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

    return {
      title: this.t(sub ? 'settingsSubGroup' : 'settingsGroup'),
      build: (panel) => {
        const view = this.ctx.view();
        const property = this.property(sub ? view.subGroupBy : view.groupBy);
        const disabled = !this.shared;
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
              this.ctx.updateView(sub ? { subGroupBy: picked.id } : { groupBy: picked.id });
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
        rows.push(...this.groupTypeRows(panel, property, settings(), setSettings, disabled));
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

  private groupTypeRows(
    panel: DatabasePanel,
    property: PropertyDefinition,
    settings: GroupSettings,
    set: (patch: Partial<GroupSettings>) => void,
    disabled: boolean
  ): HTMLElement[] {
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
      case 'number': {
        const rows = [choice('database-group-number-by', 'groupNumberBy', 'numberBy', [['unique', 'groupNumberUnique'], ['range', 'groupNumberRange']], 'unique')];

        if (settings.numberBy === 'range') {
          const numberInput = (field: 'rangeStart' | 'rangeEnd' | 'rangeSize', labelKey: string): HTMLElement => panelInput({
            value: typeof settings[field] === 'number' ? String(settings[field]) : '',
            placeholder: this.t(labelKey),
            label: this.t(labelKey),
            testId: `database-group-${field}`,
            onInput: (text) => {
              const n = Number(text);

              if (text.trim() !== '' && Number.isFinite(n)) set({ [field]: n });
            },
          });

          rows.push(numberInput('rangeStart', 'groupRangeStart'), numberInput('rangeEnd', 'groupRangeEnd'), numberInput('rangeSize', 'groupRangeSize'));
        }

        return rows;
      }
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
      default:
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
              label: property === undefined ? this.t('filterGone') : filterPillLabel(rule, property, (key, vars) => this.ctx.i18n.t(key, vars), (id) => this.personName(id)),
              testId: `database-color-condition-${rule.id}`,
              opensPage: true,
              disabled,
              onClick: () => panel.push(this.ruleEditor({
                read: () => rules().find((r) => r.id === rule.id),
                update: (change) => patch(rule.id, change),
                remove: () => write(rules().filter((r) => r.id !== rule.id)),
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
    // Status keeps its group and option order (research/08: "Ascending" only); checkbox and people have no sort.
    default:
      return [];
  }
};

const idList = (value: FilterConfig['value']): string[] => {
  if (Array.isArray(value)) return value.flatMap((entry) => (typeof entry === 'string' ? [entry] : []));

  return typeof value === 'string' && value !== '' ? [value] : [];
};

export type ViewSettingsStart = 'root' | 'filter' | 'sort' | 'group';

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
    filter: (): PanelPage => pages.filters(),
    sort: (): PanelPage => pages.sorts(),
    group: (): PanelPage => pages.group(false),
  }[start]();
  const panel = new DatabasePanel({
    anchor,
    root,
    testId: 'database-view-settings',
    width: 290,
    backLabel: ctx.i18n.t('tools.database.settingsBack'),
    ...(onClose !== undefined ? { onClose } : {}),
  });

  panel.open();

  return panel;
};

/** Opens one simple filter's popover (research/08: 220 wide). */
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

