import type { BlockToolDescription } from '../../../types/tools/tool-description';

/** The Notion API's 45 number formats. Kept equal to cells/number-format.ts NUMBER_FORMATS by a test. */
export const NUMBER_FORMAT_ENUM = [
  'number', 'number_with_commas', 'percent',
  'dollar', 'australian_dollar', 'canadian_dollar', 'singapore_dollar', 'euro', 'pound', 'yen',
  'ruble', 'rupee', 'won', 'yuan', 'real', 'lira', 'rupiah', 'franc', 'hong_kong_dollar',
  'new_zealand_dollar', 'krona', 'norwegian_krone', 'mexican_peso', 'rand', 'new_taiwan_dollar',
  'danish_krone', 'zloty', 'baht', 'forint', 'koruna', 'shekel', 'chilean_peso', 'philippine_peso',
  'dirham', 'colombian_peso', 'riyal', 'ringgit', 'leu', 'argentine_peso', 'uruguayan_peso',
  'peruvian_sol', 'vietnamese_dong', 'pakistani_rupee', 'nigerian_naira', 'bitcoin',
];

const COLORS = ['default', 'gray', 'brown', 'orange', 'yellow', 'green', 'blue', 'purple', 'pink', 'red'];

/** Settings beside `config` on a property (Phase 2). Never inside `config`: v1.16.1 replaces it whole. */
const PROPERTY_SETTINGS = {
  description: { type: 'string' },
  icon: { type: 'string', description: 'An emoji.' },
  pageVisibility: { type: 'string', enum: ['always', 'hideWhenEmpty', 'hidden'], description: 'How the row page shows the property. Default always.' },
  number: {
    type: 'object',
    additionalProperties: false,
    properties: {
      format: { type: 'string', enum: NUMBER_FORMAT_ENUM },
      decimals: { type: 'integer', minimum: 0, maximum: 10 },
      showAs: { type: 'string', enum: ['number', 'bar', 'ring'] },
      color: { type: 'string', enum: COLORS },
      divideBy: { type: 'number', exclusiveMinimum: 0 },
    },
  },
  date: {
    type: 'object',
    description: 'Display of date, created time and last edited time values.',
    additionalProperties: false,
    properties: {
      dateFormat: { type: 'string', enum: ['full', 'short', 'month_day_year', 'day_month_year', 'year_month_day', 'relative'] },
      timeFormat: { type: 'string', enum: ['12_hour', '24_hour', 'hidden'] },
      timeZone: { type: 'string', description: 'IANA zone. Absent means the viewer\'s zone.' },
    },
  },
  status: {
    type: 'object',
    required: ['groups'],
    additionalProperties: false,
    properties: {
      groups: {
        type: 'array',
        items: {
          type: 'object',
          required: ['id', 'kind', 'name', 'position'],
          additionalProperties: false,
          properties: {
            id: { type: 'string' },
            kind: { type: 'string', enum: ['todo', 'inProgress', 'complete'] },
            name: { type: 'string' },
            color: { type: 'string' },
            position: { type: 'string' },
          },
        },
      },
      showAs: { type: 'string', enum: ['select', 'checkbox'] },
    },
  },
  uniqueId: { type: 'object', additionalProperties: false, properties: { prefix: { type: 'string' } } },
};

/** Per-view group lists hold id objects so two peers' entries merge. */
const GROUP_REFS = {
  type: 'array',
  items: {
    type: 'object',
    required: ['id'],
    additionalProperties: false,
    properties: { id: { type: 'string', description: 'Option id of the group.' } },
  },
};

const FILTER_RULE = {
  type: 'object',
  required: ['id', 'propertyId', 'operator', 'value'],
  additionalProperties: false,
  properties: {
    id: { type: 'string' },
    propertyId: { type: 'string' },
    operator: { type: 'string' },
    value: { description: 'Any property value; shape follows the property type.' },
  },
};

/** Notion nests advanced filters three layers deep; the schema spells out each layer. */
const filterGroup = (layer: number): Record<string, unknown> => ({
  type: 'object',
  required: ['id', 'conjunction', 'filterRules'],
  additionalProperties: false,
  properties: {
    id: { type: 'string' },
    conjunction: { type: 'string', enum: ['and', 'or'] },
    filterRules: {
      type: 'array',
      items: layer < 3 ? { anyOf: [FILTER_RULE, filterGroup(layer + 1)] } : FILTER_RULE,
    },
  },
});

const GROUP_SETTINGS = {
  type: 'object',
  additionalProperties: false,
  properties: {
    sort: { type: 'string', enum: ['manual', 'ascending', 'descending'] },
    dateBy: { type: 'string', enum: ['relative', 'day', 'week', 'month', 'year'] },
    weekStart: { type: 'integer', enum: [0, 1], description: '0 is Sunday, 1 is Monday.' },
    numberBy: { type: 'string', enum: ['unique', 'range'] },
    rangeStart: { type: 'number' },
    rangeEnd: { type: 'number' },
    rangeSize: { type: 'number', minimum: 1 },
    textBy: { type: 'string', enum: ['exact', 'alphabet'] },
    hideEmptyGroups: { type: 'boolean' },
    colorColumns: { type: 'boolean', description: 'Board only. Default true.' },
  },
};

export const DATABASE_DATA = {
  type: 'object',
  description: 'Schema and view configuration only — rows are child `database-row` blocks.',
  required: ['schema', 'views', 'activeViewId'],
  additionalProperties: false,
  properties: {
    title: { type: 'string' },
    activeViewId: { type: 'string', description: 'Id of the view shown by default.' },
    schema: {
      type: 'array',
      description: 'Column definitions. Exactly one must have type "title".',
      items: {
        type: 'object',
        required: ['id', 'name', 'type', 'position'],
        additionalProperties: false,
        properties: {
          id: { type: 'string' },
          name: { type: 'string' },
          type: {
            type: 'string',
            enum: [
              'title', 'text', 'number', 'select', 'multiSelect', 'date', 'checkbox', 'url', 'richText',
              'status', 'email', 'phone', 'person', 'files', 'createdTime', 'lastEditedTime', 'createdBy', 'lastEditedBy', 'uniqueId',
            ],
          },
          position: { type: 'string', description: 'Fractional-index sort key.' },
          databaseLocked: { type: 'boolean', description: 'Read on the title property only: locks the schema and views. Data entry still works.' },
          config: {
            type: 'object',
            description: 'Type-specific options; select/multiSelect carry their choices here.',
            required: ['options'],
            additionalProperties: false,
            properties: {
              options: {
                type: 'array',
                items: {
                  type: 'object',
                  required: ['id', 'label', 'position'],
                  additionalProperties: false,
                  properties: {
                    id: { type: 'string' },
                    label: { type: 'string' },
                    color: { type: 'string' },
                    position: { type: 'string' },
                    groupId: { type: 'string', description: 'Status only: the id of the status group holding this option.' },
                  },
                },
              },
            },
          },
          ...PROPERTY_SETTINGS,
        },
      },
    },
    views: {
      type: 'array',
      minItems: 1,
      items: {
        type: 'object',
        required: ['id', 'name', 'type', 'position', 'sorts', 'filters', 'visibleProperties'],
        additionalProperties: false,
        properties: {
          id: { type: 'string' },
          name: { type: 'string' },
          type: { type: 'string', enum: ['board', 'table', 'gallery', 'list', 'calendar', 'timeline'] },
          position: { type: 'string' },
          groupBy: { type: 'string', description: 'Property id. Required for a board view.' },
          groupByStatus: { type: 'string', enum: ['group', 'option'], description: 'Grouping by a status: one group per status group or per option. Default option.' },
          sorts: {
            type: 'array',
            items: {
              type: 'object',
              required: ['propertyId', 'direction'],
              additionalProperties: false,
              properties: {
                id: { type: 'string' },
                propertyId: { type: 'string' },
                direction: { type: 'string', enum: ['asc', 'desc'] },
              },
            },
          },
          filters: {
            type: 'array',
            items: {
              type: 'object',
              required: ['propertyId', 'operator', 'value'],
              additionalProperties: false,
              properties: {
                id: { type: 'string' },
                propertyId: { type: 'string' },
                operator: { type: 'string', description: 'Notion API operator. Dates add past_week, next_month, this_week, relative_to_today and others.' },
                value: { description: 'Any property value; shape follows the property type.' },
              },
            },
          },
          visibleProperties: {
            type: 'array',
            items: { type: 'string' },
            description: 'Visible non-title property ids, in order. Kept in step with `properties` for older readers.',
          },
          properties: {
            type: 'array',
            description: 'Per-property settings in this view; array order is column order. Wins over visibleProperties.',
            items: {
              type: 'object',
              required: ['id'],
              additionalProperties: false,
              properties: {
                id: { type: 'string', description: 'Property id.' },
                visible: { type: 'boolean' },
                width: { type: 'number', exclusiveMinimum: 0, description: 'Column width in pixels.' },
                wrap: { type: 'boolean' },
              },
            },
          },
          wrapCells: { type: 'boolean', description: 'Wrap every cell. Default false.' },
          frozenColumnCount: { type: 'integer', minimum: 0, description: 'Columns from the start that stay put on horizontal scroll. Default 0.' },
          showVerticalLines: { type: 'boolean', description: 'Default true.' },
          loadLimit: { type: 'integer', enum: [10, 25, 50, 100], description: 'Rows shown before "Load more".' },
          calculations: {
            type: 'array',
            description: 'Footer calculations, one per property.',
            items: {
              type: 'object',
              required: ['id', 'fn'],
              additionalProperties: false,
              properties: {
                id: { type: 'string', description: 'Property id.' },
                fn: {
                  type: 'string',
                  enum: [
                    'count', 'count_values', 'unique', 'empty', 'not_empty', 'percent_empty', 'percent_not_empty',
                    'sum', 'average', 'median', 'min', 'max', 'range',
                    'earliest_date', 'latest_date', 'date_range',
                    'checked', 'unchecked', 'percent_checked', 'percent_unchecked',
                  ],
                },
              },
            },
          },
          openPagesIn: { type: 'string', enum: ['side', 'center', 'full'], description: 'Where a row page opens. Default side; center for gallery and calendar.' },
          cardSize: { type: 'string', enum: ['small', 'medium', 'large'], description: 'Gallery or board card size. Default medium.' },
          cardPreview: {
            type: 'string',
            pattern: '^(none|cover|content|property:.+)$',
            description: 'What a gallery or board card shows above its title: none, the page cover, the page content, or "property:<id>". Default content on a gallery, none on a board.',
          },
          fitImage: { type: 'boolean', description: 'Gallery or board: show the whole image instead of cropping it. Default false.' },
          calendarBy: { type: 'string', description: 'Calendar: the date property id that places each row. Default the first date property.' },
          calendarRange: { type: 'string', enum: ['month', 'week'], description: 'Calendar range. Default month.' },
          showWeekends: { type: 'boolean', description: 'Calendar. Default true.' },
          timelineBy: { type: 'string', description: 'Timeline: the date property id that places each bar. Default the first date property.' },
          timelineEndBy: { type: 'string', description: 'Timeline: a second date property id that ends each bar. Absent means timelineBy holds the range.' },
          timelineZoom: {
            type: 'string',
            enum: ['hours', 'day', 'week', 'bi_week', 'month', 'quarter', 'year', '5_years'],
            description: 'Timeline zoom. Default month.',
          },
          showTimelineTable: { type: 'boolean', description: 'Timeline: show the table panel. Default false.' },
          tableProperties: {
            type: 'array',
            description: 'Timeline table panel columns, apart from the bar properties; array order is column order.',
            items: {
              type: 'object',
              required: ['id'],
              additionalProperties: false,
              properties: {
                id: { type: 'string', description: 'Property id.' },
                visible: { type: 'boolean' },
                width: { type: 'number', exclusiveMinimum: 0, description: 'Column width in pixels.' },
                wrap: { type: 'boolean' },
              },
            },
          },
          arrowsBy: { type: 'string', description: 'Timeline: the self-relation property id that draws dependency arrows.' },
          noValueGroupPosition: { type: 'string', description: 'Where the no-value group sits among the groups. Absent means last.' },
          hiddenGroups: GROUP_REFS,
          collapsedGroups: GROUP_REFS,
          hideGroupAggregation: { type: 'boolean' },
          filterTree: { ...filterGroup(1), description: 'Advanced filter. Rows must match it and every simple filter. Older clients ignore it.' },
          groupSettings: GROUP_SETTINGS,
          subGroupBy: { type: 'string', description: 'Board only: property id of a second grouping inside each column. Its keys in hiddenGroups/collapsedGroups start with "sub:".' },
          subGroupSettings: GROUP_SETTINGS,
          colorRules: {
            type: 'array',
            description: 'Conditional color. The first matching rule colors a row.',
            items: {
              type: 'object',
              required: ['id', 'propertyId', 'operator', 'value', 'color'],
              additionalProperties: false,
              properties: {
                id: { type: 'string' },
                propertyId: { type: 'string' },
                operator: { type: 'string' },
                value: { description: 'Any property value; shape follows the property type.' },
                color: { type: 'string' },
                applyTo: { type: 'string', enum: ['row', 'property'], description: 'Table only. Default row.' },
              },
            },
          },
          showPageIcon: { type: 'boolean', description: 'Default true.' },
        },
      },
    },
  },
};

export const describeDatabase = (_config: Record<string, unknown> = {}): BlockToolDescription => ({
  summary: 'A database: a schema of properties and saved views. Rows are child database-row blocks.',
  guidance: 'Add rows with database.addRow and change their values with database.setRowValues. Change views, properties and select options with the database.* actions; schema and views cannot be written directly.',
  data: DATABASE_DATA,
  inputFields: ['title'],
  summaryFields: ['title', 'activeViewId'],
  guardedFields: { schema: 'database.*', views: 'database.*' },
});
