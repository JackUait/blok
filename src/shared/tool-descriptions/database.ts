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
  formula: {
    type: 'object',
    required: ['expression'],
    additionalProperties: false,
    properties: {
      expression: { type: 'string', description: 'Formulas 2.0 source. prop("Name") is stored as {{property:<id>}}, so a rename keeps working.' },
    },
  },
  relation: {
    type: 'object',
    description: 'Values are id objects of rows of the target database: [{ "id": "<row block id>" }].',
    required: ['targetDatabaseId'],
    additionalProperties: false,
    properties: {
      targetDatabaseId: { type: 'string', description: 'A database block in this document. The database\'s own id makes a self-relation.' },
      targetDocumentId: { type: 'string', description: 'A database in another document, resolved by the host.' },
      limit: { enum: [1, null], description: '1 keeps one related row. Absent or null means no limit.' },
      twoWay: { type: 'boolean' },
      syncedPropertyId: { type: 'string', description: 'Two-way: the mirroring property on the target database.' },
      role: {
        type: 'string',
        enum: ['parentItem', 'subItems', 'blockedBy', 'blocking'],
        description: 'A self-relation that drives sub-items (parentItem/subItems) or dependencies (blockedBy/blocking).',
      },
    },
  },
  autofill: {
    type: 'object',
    description: 'AI autofill. Blok has no AI: the host config.ai.autofill lever fills the value.',
    required: ['mode'],
    additionalProperties: false,
    properties: {
      mode: { type: 'string', enum: ['summary', 'translate', 'keyInfo', 'custom'] },
      instruction: { type: 'string' },
      language: { type: 'string', description: 'Translate: the target language, a BCP 47 tag.' },
      onCreate: { type: 'boolean', description: 'Fill when a row is added. Default false.' },
      onEdit: { type: 'boolean', description: 'Fill again when another value of the row changes. Default false.' },
    },
  },
  rollup: {
    type: 'object',
    required: ['relationPropertyId', 'targetPropertyId', 'function'],
    additionalProperties: false,
    properties: {
      relationPropertyId: { type: 'string' },
      targetPropertyId: { type: 'string', description: 'A property of the related database.' },
      function: {
        type: 'string',
        enum: [
          'show_original', 'show_unique', 'count', 'count_values', 'unique', 'empty', 'not_empty', 'percent_empty', 'percent_not_empty',
          'sum', 'average', 'median', 'min', 'max', 'range', 'earliest_date', 'latest_date', 'date_range',
          'checked', 'unchecked', 'percent_checked', 'percent_unchecked', 'count_per_group', 'percent_per_group',
        ],
      },
    },
  },
  button: {
    type: 'object',
    additionalProperties: false,
    properties: {
      label: { type: 'string' },
      buttonActions: {
        type: 'array',
        description: 'Run in order on a click, as one undo step.',
        items: {
          type: 'object',
          required: ['id', 'type'],
          additionalProperties: false,
          properties: {
            id: { type: 'string' },
            type: { type: 'string', enum: ['editProperty', 'insertBlocks', 'openPage', 'callback'] },
            propertyId: { type: 'string', description: 'editProperty: the property to set.' },
            value: { description: 'editProperty: the new value. [{ "id": "@me" }] and "@today" are filled in on click.' },
            blocks: {
              type: 'array',
              description: 'insertBlocks: added at the end of the row page body.',
              items: {
                type: 'object',
                required: ['id', 'type', 'data'],
                additionalProperties: false,
                properties: { id: { type: 'string' }, type: { type: 'string' }, data: { type: 'object' } },
              },
            },
            url: { type: 'string', description: 'openPage: a URL. Absent opens the row page.' },
            name: { type: 'string', description: 'callback: what the host should do.' },
          },
        },
      },
    },
  },
  dependency: {
    type: 'object',
    description: 'Read on the blockedBy relation only.',
    additionalProperties: false,
    properties: {
      shift: { type: 'string', enum: ['overlap', 'maintain', 'none'], description: 'How a date change moves blocked items. Default none.' },
      avoidWeekends: { type: 'boolean' },
    },
  },
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

/** Tier 3 (D6) view slots. Blok stores them; the host levers act on them. */
const TIER3_VIEW_FIELDS = {
  form: {
    type: 'object',
    description: 'Form view settings. The public link is the host\'s.',
    additionalProperties: false,
    properties: {
      closed: { type: 'boolean', description: 'The form takes no answers. Default false.' },
      anonymous: { type: 'boolean', description: 'Answers carry no respondent. Default false.' },
      submitLabel: { type: 'string' },
      confirmation: { type: 'string', description: 'Text shown after a submit.' },
    },
  },
  mapBy: { type: 'string', description: 'Map: the place property id. Default the first place property.' },
  dashboard: {
    type: 'object',
    description: 'Dashboard slot. Blok draws no dashboard yet.',
    required: ['rows'],
    additionalProperties: false,
    properties: {
      rows: {
        type: 'array',
        items: {
          type: 'object',
          required: ['id', 'widgets'],
          additionalProperties: false,
          properties: {
            id: { type: 'string' },
            height: { type: 'integer', minimum: 1, description: 'Row height in pixels.' },
            widgets: {
              type: 'array',
              maxItems: 4,
              items: {
                type: 'object',
                required: ['id', 'viewId', 'width'],
                additionalProperties: false,
                properties: {
                  id: { type: 'string' },
                  viewId: { type: 'string', description: 'The view the widget shows.' },
                  databaseId: { type: 'string', description: 'The database holding the view. Omit for this database.' },
                  width: { type: 'integer', minimum: 1, maximum: 12, description: 'Columns of a 12-column grid.' },
                },
              },
            },
          },
        },
      },
    },
  },
  calendarSync: {
    type: 'object',
    description: 'Calendar sync slot, for the host. Blok syncs nothing.',
    additionalProperties: false,
    properties: {
      enabled: { type: 'boolean' },
      calendarId: { type: 'string' },
    },
  },
  dataSourceId: { type: 'string', description: 'Multi-source slot: the database block whose rows this view shows. Absent means this database. Blok reads only its own rows yet.' },
};

export const DATABASE_DATA = {
  type: 'object',
  description: 'Schema and view configuration only — rows are child `database-row` blocks.',
  required: ['schema', 'views', 'activeViewId'],
  additionalProperties: false,
  properties: {
    title: { type: 'string' },
    source: {
      type: 'object',
      description: 'A linked database: shows the rows and schema of this database block. Its own schema is a stand-in for older readers.',
      required: ['databaseId'],
      additionalProperties: false,
      properties: {
        databaseId: { type: 'string' },
        documentId: { type: 'string', description: 'A database in another document, read through the host.' },
      },
    },
    activeViewId: { type: 'string', description: 'Id of the view shown by default.' },
    automations: {
      type: 'object',
      required: ['version', 'definitions'],
      additionalProperties: false,
      properties: {
        version: { type: 'integer', const: 1 },
        definitions: {
          type: 'array',
          items: {
            type: 'object',
            required: ['id', 'name', 'status', 'scope', 'triggerMode', 'triggers', 'actions'],
            additionalProperties: false,
            properties: {
              id: { type: 'string' },
              name: { type: 'string' },
              status: { type: 'string', enum: ['active', 'paused'] },
              scope: {
                oneOf: [
                  {
                    type: 'object',
                    required: ['type'],
                    additionalProperties: false,
                    properties: { type: { const: 'database' } },
                  },
                  {
                    type: 'object',
                    required: ['type', 'viewId'],
                    additionalProperties: false,
                    properties: { type: { const: 'view' }, viewId: { type: 'string' } },
                  },
                ],
              },
              triggerMode: { type: 'string', enum: ['any', 'all'] },
              triggers: {
                type: 'array',
                items: {
                  oneOf: [
                    {
                      type: 'object',
                      required: ['id', 'type'],
                      additionalProperties: false,
                      properties: { id: { type: 'string' }, type: { const: 'pageAdded' } },
                    },
                    {
                      type: 'object',
                      required: ['id', 'type', 'propertyId'],
                      additionalProperties: false,
                      properties: {
                        id: { type: 'string' },
                        type: { const: 'propertyEdited' },
                        propertyId: { type: 'string' },
                      },
                    },
                  ],
                },
              },
              actions: {
                type: 'array',
                items: {
                  type: 'object',
                  required: ['id', 'type', 'target', 'propertyId', 'value'],
                  additionalProperties: false,
                  properties: {
                    id: { type: 'string' },
                    type: { const: 'editProperty' },
                    target: { const: 'triggerRow' },
                    propertyId: { type: 'string' },
                    value: { description: 'The literal property value to write.' },
                  },
                },
              },
            },
          },
        },
      },
    },
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
              'relation', 'rollup', 'formula', 'button',
              'place', 'verification',
            ],
          },
          position: { type: 'string', description: 'Fractional-index sort key.' },
          databaseLocked: { type: 'boolean', description: 'Read on the title property only: locks the schema and views. Data entry still works.' },
          defaultTemplateId: { type: 'string', description: 'Read on the title property only: the template row new rows start from.' },
          pageLayoutStructure: { type: 'string', enum: ['simple', 'tabbed'], description: 'Read on the title property only: the row page structure. Default simple.' },
          pageLayoutGroupIn: { type: 'string', enum: ['page', 'panel'], description: 'Read on the title property only: where the row page property group sits. Default page.' },
          pageLayoutPropertyIcons: { type: 'boolean', enum: [false], description: 'Read on the title property only: false hides the icon beside each row page property label. Absent means shown.' },
          pageLayoutPlacements: {
            type: 'array',
            description: 'Read on the title property only: where properties sit on the row page. A property with no entry sits in the property group.',
            items: {
              type: 'object',
              required: ['id', 'place'],
              additionalProperties: false,
              properties: {
                id: { type: 'string', description: 'The property id.' },
                place: { type: 'string', enum: ['heading', 'page', 'panel', 'section'], description: 'heading pins it under the title; page and panel give it a module of its own.' },
                sectionId: { type: 'string', description: 'With place "section": the section it sits in.' },
              },
            },
          },
          pageLayoutSections: {
            type: 'array',
            description: 'Read on the title property only: named sections of the row page property group.',
            items: {
              type: 'object',
              required: ['id', 'name'],
              additionalProperties: false,
              properties: { id: { type: 'string' }, name: { type: 'string' } },
            },
          },
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
          type: { type: 'string', enum: ['board', 'table', 'gallery', 'list', 'calendar', 'timeline', 'chart', 'feed', 'form', 'map', 'dashboard'] },
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
                required: { type: 'boolean', description: 'Form: the question must be answered.' },
                description: { type: 'string', description: 'Form: help text under the question.' },
                questionName: { type: 'string', description: 'Form: a detached question label; absent follows the property name.' },
                longAnswer: { type: 'boolean', description: 'Form: long or short text; absent keeps the long-text field.' },
                maxSelections: { type: 'integer', minimum: 1, description: 'Form: maximum multi-select, people or relation selections.' },
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
                capCounts: { type: 'boolean', description: 'Show a count above 99 as "99+". Default false.' },
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
          timelineCenter: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$', description: "Timeline: the shared centre day (YYYY-MM-DD). A person's own last centre wins over it." },
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
          chartType: { type: 'string', enum: ['column', 'bar', 'line', 'donut', 'number'], description: 'Chart: the chart type. The X axis (donut: each slice) is groupBy; the series are subGroupBy. Default column.' },
          chartMeasure: {
            type: 'string',
            pattern: '^(count|[a-z_]+:.+)$',
            description: 'Chart: the Y axis, "count" or "<calculation>:<property id>" such as "sum:p1". Default count.',
          },
          chartSort: { type: 'string', enum: ['manual', 'xAscending', 'xDescending', 'yAscending', 'yDescending'], description: 'Chart: bar order. Default manual (the group order).' },
          chartOmitZero: { type: 'boolean', description: 'Chart: drop groups whose value is zero. Default false.' },
          chartCumulative: { type: 'boolean', description: 'Chart: running total. Applies only to count or sum with chartSort xAscending. Default false.' },
          chartColor: {
            type: 'string',
            enum: ['auto', 'colorful', 'gray', 'blue', 'yellow', 'green', 'purple', 'teal', 'orange', 'pink', 'red'],
            description: 'Chart color palette. Default auto.',
          },
          chartHeight: { type: 'string', enum: ['small', 'medium', 'large', 'extraLarge'], description: 'Chart height. Default medium.' },
          chartGridLines: { type: 'string', enum: ['none', 'horizontal', 'vertical', 'both'], description: 'Chart grid lines. Default horizontal.' },
          chartAxisNames: { type: 'boolean', description: 'Chart: show axis names. Default false.' },
          chartDataLabels: { type: 'boolean', description: 'Chart: show a value on each bar, point or slice. Default false.' },
          chartSmooth: { type: 'boolean', description: 'Line chart: smooth curve. Default false.' },
          chartGradient: { type: 'boolean', description: 'Line chart: shade the area under the line. Default false.' },
          chartCenterValue: { type: 'boolean', description: 'Donut chart: show the total in the center. Default true.' },
          chartLegend: { type: 'string', enum: ['off', 'bottom', 'side'], description: 'Chart legend position. Default bottom.' },
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
          subItemsDisplay: {
            type: 'string',
            enum: ['nested', 'card', 'flattened'],
            description: 'Sub-items: nested (table, list, timeline) or card (board, calendar, gallery) by default, or flattened.',
          },
          subItemsFilter: { type: 'string', enum: ['parents', 'parentsAndSubItems', 'subItems'], description: 'Sub-items: which rows show. Default parents.' },
          ...TIER3_VIEW_FIELDS,
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
