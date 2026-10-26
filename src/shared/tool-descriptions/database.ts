import { CONVERTIBLE_TYPES } from '../database/property-conversion';
import { DATABASE_COMMENT_ACTIONS } from './database-comments';
import { DATABASE_ROW_DATA } from './database-row';

import type { BlockToolDescription, BlokSchema, ToolActionDeclaration } from '../../../types/tools/tool-description';

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
const PROPERTY_TYPES = [
  'title', 'text', 'number', 'select', 'multiSelect', 'date', 'checkbox', 'url', 'richText',
  'status', 'email', 'phone', 'person', 'files', 'createdTime', 'lastEditedTime', 'createdBy', 'lastEditedBy', 'uniqueId',
  'relation', 'rollup', 'formula', 'button',
  'place', 'verification',
];

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
      showNumber: { type: 'boolean', description: 'Bar or ring: false draws the gauge without its number. Default true.' },
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
      defaultReminder: {
        type: 'string',
        enum: ['on_day_of_event', '1_day_before', '2_days_before', '1_week_before'],
        description: 'Notifications: the reminder a date set afterwards in an empty cell starts with. Existing reminders stay.',
      },
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
      defaultOptionId: { type: 'string', description: 'The option id a new row starts with.' },
    },
  },
  uniqueId: { type: 'object', additionalProperties: false, properties: { prefix: { type: 'string' } } },
  person: {
    type: 'object',
    description: 'Person options. Blok sends no notifications: it only stores the choice for the host.',
    additionalProperties: false,
    properties: {
      limit: { anyOf: [{ type: 'integer', enum: [1] }, { type: 'null' }], description: '1 keeps one person. Absent or null means no limit.' },
      default: { type: 'string', enum: ['createdBy'], description: 'createdBy: a new row starts with the user who adds it.' },
      notifications: { type: 'string', enum: ['usersAndGroups', 'none'], description: 'Absent means users only.' },
    },
  },
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
      onEditProperties: { type: 'array', items: { type: 'string' }, description: 'With onEdit: only a change to one of these property ids fills again. Absent means any property.' },
      onEditContent: { type: 'boolean', description: "Fill again when the row's page body is edited here (never a peer, undo or redo). Default false." },
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
            type: {
              type: 'string',
              enum: ['editProperty', 'insertBlocks', 'openPage', 'callback', 'addPage', 'editPages', 'showConfirmation', 'defineVariables', 'sendNotification'],
            },
            propertyId: { type: 'string', description: 'editProperty: the property to set.' },
            value: { description: 'editProperty: the new value. [{ "id": "@me" }] and "@today" are filled in on click.' },
            databaseId: { type: 'string', description: 'addPage: the database block the page goes into. Absent: this database.' },
            edits: {
              type: 'array',
              description: 'addPage and editPages: the values the page gets, filled in on click like an editProperty value.',
              items: {
                type: 'object',
                required: ['id', 'propertyId', 'value'],
                additionalProperties: false,
                properties: { id: { type: 'string' }, propertyId: { type: 'string' }, value: {} },
              },
            },
            target: {
              type: 'object',
              description: 'editPages: thisPage, the page an earlier addPage step added, or the pages of a database that match both filter lists (none: every page). Absent: edits nothing.',
              required: ['type'],
              additionalProperties: false,
              properties: {
                type: { type: 'string', enum: ['thisPage', 'addedPage', 'database'] },
                stepId: { type: 'string', description: 'addedPage: the addPage action id.' },
                databaseId: { type: 'string', description: 'database: the database block.' },
                filters: {
                  type: 'array',
                  description: 'Same shape as a view filter.',
                  items: {
                    type: 'object',
                    required: ['propertyId', 'operator', 'value'],
                    additionalProperties: false,
                    properties: { id: { type: 'string' }, propertyId: { type: 'string' }, operator: { type: 'string' }, value: {} },
                  },
                },
                // Spelled out, the advanced filter takes the agent tool schema past the OpenAI depth limit (src/agent/render-tools.ts).
                filterTree: { type: 'object', description: 'Same shape as a view filterTree.' },
              },
            },
            stepId: { type: 'string', description: 'openPage: open the page an earlier addPage action added. Wins over url.' },
            message: { type: 'string', description: 'showConfirmation: the question. sendNotification: the message.' },
            confirmLabel: { type: 'string', description: 'showConfirmation: the Continue button text.' },
            cancelLabel: { type: 'string', description: 'showConfirmation: the Cancel button text. Cancel stops this action and every one after it.' },
            variables: {
              type: 'array',
              description: 'defineVariables: stored only; no action field reads them yet.',
              items: {
                type: 'object',
                required: ['id', 'name'],
                additionalProperties: false,
                properties: {
                  id: { type: 'string' },
                  name: { type: 'string' },
                  kind: { type: 'string', enum: ['text', 'formula'] },
                  value: { type: 'string' },
                },
              },
            },
            recipients: {
              type: 'object',
              description: 'sendNotification: up to 20 people, or the people in a person property of the row. The host sends it (config.buttons.onNotify).',
              required: ['type'],
              additionalProperties: false,
              properties: {
                type: { type: 'string', enum: ['people', 'property'] },
                people: { type: 'array', maxItems: 20, items: { type: 'object', required: ['id'], additionalProperties: false, properties: { id: { type: 'string' } } } },
                propertyId: { type: 'string' },
              },
            },
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
            name: { type: 'string', description: 'callback: what the host should do. addPage: the new page name; empty shows "Untitled".' },
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

/** A calculation on one property: a table footer cell, or a board's group calculation. */
const VIEW_CALCULATION = {
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
    value: { description: 'Any property value; shape follows the property type. A relation filter may hold "this_page": the row page the view is shown on (no row page: matches nothing).' },
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
      public: { type: 'boolean', description: 'Anyone on the web with the link can fill it out. Default false: workspace members only.' },
      submissionAccess: {
        type: 'string', enum: ['none', 'view', 'comment', 'edit', 'full'],
        description: 'What a respondent may do with the page their answer becomes. Default none.',
      },
      submitLabel: { type: 'string' },
      confirmation: { type: 'string', description: 'Text shown after a submit.' },
    },
  },
  mapBy: { type: 'string', description: 'Map: the place property id. Default the first place property.' },
  mapHeight: { type: 'string', enum: ['small', 'medium', 'large', 'extraLarge'], description: 'Map height: 300, 400, 600 or 800 px. Default medium.' },
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
    hideDataSourceTitles: { type: 'boolean', description: 'Hides the title line above the tabs for every view. Default false.' },
    icon: {
      type: 'object',
      description: 'The icon before the title: one of Blok\'s glyphs on a tinted tile.',
      required: ['glyph', 'color'],
      additionalProperties: false,
      properties: {
        glyph: { type: 'string', enum: ['check', 'timeline', 'wand', 'doc', 'idea', 'calendar', 'flag', 'comment', 'person', 'map', 'database', 'ticket', 'feed', 'currency', 'card', 'paintBrush', 'package', 'fanDeck'] },
        color: { type: 'string', enum: ['green', 'blue', 'gray', 'red', 'orange', 'yellow', 'purple', 'pink'] },
      },
    },
    starter: { type: 'string', enum: ['tasks', 'projects', 'skills', 'documentHub', 'brainstorm', 'meetingNotes', 'goals', 'campaign', 'contentCalendar',
      'events', 'socialMedia', 'issues', 'featureRequests', 'engineeringDocs', 'fundraising', 'pipeline', 'accounts', 'creative', 'inventory', 'roadmap', 'assets'], description: 'The template this database was made from. Removed by "Undo … database".' },
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
            enum: PROPERTY_TYPES,
          },
          position: { type: 'string', description: 'Fractional-index sort key.' },
          databaseLocked: { type: 'boolean', description: 'Read on the title property only: locks the schema and views. Data entry still works.' },
          defaultTemplateId: { type: 'string', description: 'Read on the title property only: the template row new rows start from.' },
          pageLayoutStructure: { type: 'string', enum: ['simple', 'tabbed'], description: 'Read on the title property only: the row page structure. Default simple.' },
          pageLayoutGroupIn: { type: 'string', enum: ['page', 'panel'], description: 'Read on the title property only: where the row page property group sits. Default page.' },
          pageLayoutPropertyIcons: { type: 'boolean', enum: [false], description: 'Read on the title property only: false hides the icon beside each row page property label. Absent means shown.' },
          pageLayoutPropertyLabels: { type: 'boolean', enum: [false], description: 'Read on the title property only: false hides the property labels in the row page heading. Absent means shown.' },
          pageLayoutTemplates: { type: 'boolean', enum: [false], description: 'Read on the title property only: false hides the database templates on an empty row page. Absent means shown.' },
          pageLayoutFullWidth: { type: 'boolean', enum: [true], description: 'Read on the title property only: true lays every row page out full width. Absent means off.' },
          pageLayoutTabsId: { type: 'string', description: 'Read on the title property only: id of the tabs child of this database that holds the row page view tabs (first tab is Content; each other tab holds one linked database). Kept while Simple. Absent means none yet. A tab or tabs child carrying `draft` is someone\'s unapplied layout draft, not part of the layout.' },
          pageLayoutPlacements: {
            type: 'array',
            description: 'Read on the title property only: where properties sit on the row page. A property with no entry sits in the property group.',
            items: {
              type: 'object',
              required: ['id', 'place'],
              additionalProperties: false,
              properties: {
                id: { type: 'string', description: 'The property id.' },
                place: { type: 'string', enum: ['heading', 'page', 'panel', 'section', 'group'], description: 'heading pins it under the title; page and panel give it a module of its own; group keeps it in the property group, ahead of the properties with no entry.' },
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
                longAnswer: { type: 'boolean', description: 'Form: a multi-line text answer; absent means a one-line answer.' },
                maxSelections: { type: 'integer', minimum: 1, description: 'Form: maximum multi-select, people or relation selections.' },
                showOptionsAs: { type: 'string', enum: ['list', 'dropdown'], description: 'Form: how a choice question lists its options; absent is list for multi-select, dropdown for select and status.' },
              },
            },
          },
          propertyOrder: {
            type: 'string',
            enum: ['alphabetical'],
            description: 'alphabetical: a property properties does not list goes after the title, by name (a row page relation tab). Absent: unlisted properties go last.',
          },
          wrapCells: { type: 'boolean', description: 'Wrap every cell. Default true for a table, false otherwise.' },
          frozenColumnCount: { type: 'integer', minimum: 0, description: 'Columns from the start that stay put on horizontal scroll. Default 0.' },
          showVerticalLines: { type: 'boolean', description: 'Default true.' },
          loadLimit: { type: 'integer', enum: [10, 25, 50, 100], description: 'Rows shown before "Load more".' },
          calculations: {
            type: 'array',
            description: 'Footer calculations, one per property.',
            items: VIEW_CALCULATION,
          },
          openPagesIn: { type: 'string', enum: ['side', 'center', 'full'], description: 'Where a row page opens. Default side; center for gallery and calendar.' },
          cardSize: { type: 'string', enum: ['small', 'medium', 'large'], description: 'Gallery or board card size. Default medium.' },
          cardPreview: {
            type: 'string',
            pattern: '^(none|cover|content|property:.+)$',
            description: 'What a gallery or board card shows above its title: none, the page cover, the page content, or "property:<id>". Default content on a gallery, none on a board.',
          },
          fitImage: { type: 'boolean', description: 'Gallery or board: show the whole image instead of cropping it. Default false.' },
          cardLayout: { type: 'string', enum: ['compact', 'list'], description: 'Board: list puts each card property on its own line, compact sets them side by side. Default list.' },
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
          groupOrder: {
            type: 'object',
            additionalProperties: { type: 'string' },
            description: 'This view\'s own manual group order: option id to a fractional key, compared with option positions. An option without a key uses its position.',
          },
          hiddenGroups: GROUP_REFS,
          collapsedGroups: GROUP_REFS,
          hideGroupAggregation: { type: 'boolean' },
          groupCalculation: {
            ...VIEW_CALCULATION,
            description: 'Board: the calculation beside every group name. Absent means count all rows, shown as "99+" above 99. fn count is saved only to keep that cap off.',
          },
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
          showDataSourceTitle: { type: 'boolean', description: 'Linked views only: show the source title. Default true.' },
          subItemsDisplay: {
            type: 'string',
            enum: ['nested', 'card', 'flattened'],
            description: 'Sub-items: nested (table, list, timeline) or card (board, calendar, gallery) by default, or flattened.',
          },
          subItemsFilter: { type: 'string', enum: ['parents', 'parentsAndSubItems', 'subItems'], description: 'Sub-items: which rows show. Default parents.' },
          rowOrder: {
            type: 'object',
            additionalProperties: { type: 'string' },
            description: 'This view\'s own manual order: row id to a fractional key, compared with row positions. A row without a key uses its position. Absent: the shared order.',
          },
          ...TIER3_VIEW_FIELDS,
        },
      },
    },
  },
};

const VIEW_ID = { type: 'string', minLength: 1, description: 'Id of a view in views.' };

/**
 * Not view settings: id and position are the view's own, the layout type is database.setLayout,
 * rowOrder follows row moves, visibleProperties follows properties, and only a relation tab's birth sets propertyOrder.
 * calendarSync is an access setting (below).
 */
const NOT_VIEW_SETTINGS = new Set(['id', 'position', 'type', 'visibleProperties', 'rowOrder', 'propertyOrder', 'calendarSync']);

/** Who can see or submit stays with the person (security review); updateView refuses these. */
export const ACCESS_VIEW_SETTINGS: readonly string[] = ['calendarSync'];
export const ACCESS_FORM_SETTINGS: readonly string[] = ['closed', 'anonymous', 'public', 'submissionAccess'];

/** Saved on every view: a change can replace them, never remove them. */
const REQUIRED_VIEW_SETTINGS = new Set(['name', 'sorts', 'filters']);

const VIEW_PROPERTIES: Record<string, Record<string, unknown>> = DATABASE_DATA.properties.views.items.properties;

/** Ids are optional here: updateView fills them in. */
const withOptionalId = (items: Record<string, unknown>): Record<string, unknown> => ({
  ...items,
  required: (items.required as string[]).filter(key => key !== 'id'),
});

const VIEW_SETTING_ARGS: Record<string, unknown> = {
  ...VIEW_PROPERTIES,
  // Spelled out, these take the agent tool schema past the OpenAI depth limit (src/agent/render-tools.ts); the saved view is still checked whole.
  filterTree: { type: 'object', description: 'Advanced filter: { conjunction: "and" | "or", filterRules: [rule or group] }, a rule being { propertyId, operator, value } and a group nesting the same shape, three layers deep. Ids are filled in when missing. Rows must match it and every simple filter.' },
  dashboard: { type: 'object', description: 'Dashboard slot, same shape as the saved view field. Blok draws no dashboard yet.' },
  colorRules: { ...VIEW_PROPERTIES.colorRules, items: withOptionalId(VIEW_PROPERTIES.colorRules.items as Record<string, unknown>) },
  form: {
    type: 'object',
    additionalProperties: false,
    description: 'Form view texts, merged into the saved form settings; null removes one. Who can fill the form out stays with the person.',
    properties: { submitLabel: { anyOf: [{ type: 'string' }, { type: 'null' }] }, confirmation: { anyOf: [{ type: 'string' }, { type: 'null' }] } },
  },
};

/** Merged, not replaced, so the access settings beside the texts stay. */
const MERGED_VIEW_SETTINGS = new Set(['form']);

const VIEW_CHANGES = {
  type: 'object',
  additionalProperties: false,
  description: 'View keys to change, in the saved view shape. A key given replaces its whole value (form merges); null removes it (back to its default). Keys not given stay.',
  properties: Object.fromEntries(Object.entries(VIEW_SETTING_ARGS)
    .filter(([key]) => !NOT_VIEW_SETTINGS.has(key))
    .map(([key, setting]) => [key, REQUIRED_VIEW_SETTINGS.has(key) || MERGED_VIEW_SETTINGS.has(key) ? setting : { anyOf: [setting, { type: 'null' }] }])),
};

/** The title property's row page layout fields, settable through updateProperty. */
const PAGE_LAYOUT_SETTINGS = Object.fromEntries(Object.entries(DATABASE_DATA.properties.schema.items.properties)
  .filter(([key]) => key.startsWith('pageLayout')));

const PROPERTY_ID = { type: 'string', minLength: 1, description: 'Id of a property in schema.' };

const OPTION_ID = { type: 'string', minLength: 1, description: 'Id of an option in the property\'s config.options.' };

const ROW_ID = { type: 'string', minLength: 1, description: 'Id of a database-row child block.' };

const ROW_VALUES = { type: 'object', additionalProperties: true, description: 'Values keyed by property id, in the shapes schema describes.' };

const COLOR = { type: 'string', enum: COLORS };

const NEW_OPTION = {
  type: 'object',
  required: ['label'],
  additionalProperties: false,
  properties: { label: { type: 'string', minLength: 1 }, color: COLOR },
};

const ADDABLE_VIEW_TYPES = ['board', 'table', 'list', 'gallery', 'calendar', 'timeline', 'chart', 'feed', 'form', 'map'];

const closed = (properties: Record<string, unknown>, required: string[] = []): BlokSchema => ({
  type: 'object', required, additionalProperties: false, properties,
});

export const DATABASE_ACTIONS: ToolActionDeclaration[] = [
  {
    name: 'create',
    summary: 'Create a database with a Title and a Status property and one view.',
    target: 'create',
    args: closed({ title: { type: 'string' }, view: { enum: ['board', 'list', 'table'], description: 'The first view. Default board, grouped by Status.' } }),
    result: closed({ id: { type: 'string' }, childIds: { type: 'array', items: { type: 'string' } } }, ['id', 'childIds']),
    mirrors: [],
  },
  {
    name: 'addView',
    summary: 'Add a view at the end and open it.',
    guidance: 'A board or chart groups by groupBy, else by the first select property. A board needs a select property. A map adds a Place property when there is none. Change its settings with database.updateView.',
    target: 'block',
    args: closed({ type: { enum: ADDABLE_VIEW_TYPES }, name: { type: 'string' }, groupBy: { type: 'string', description: 'Property id to group by.' } }, ['type']),
    result: closed({ viewId: { type: 'string' } }, ['viewId']),
    mirrors: [],
  },
  {
    name: 'renameView',
    summary: 'Rename a view.',
    target: 'block',
    args: closed({ viewId: VIEW_ID, name: { type: 'string' } }, ['viewId', 'name']),
    mirrors: ['menu:database/database-view-rename'],
  },
  {
    name: 'duplicateView',
    summary: 'Copy a view with all its settings to the end, and open the copy.',
    target: 'block',
    args: closed({ viewId: VIEW_ID }, ['viewId']),
    result: closed({ viewId: { type: 'string' } }, ['viewId']),
    mirrors: ['menu:database/database-view-duplicate'],
  },
  {
    name: 'deleteView',
    summary: 'Delete a view. If it was open, its neighbour opens.',
    target: 'block',
    preconditions: ['At least one view must remain.'],
    args: closed({ viewId: VIEW_ID }, ['viewId']),
    mirrors: ['menu:database/database-view-delete'],
  },
  {
    name: 'moveView',
    summary: 'Move a view before or after another view.',
    target: 'block',
    args: {
      ...closed({ viewId: VIEW_ID, before: VIEW_ID, after: VIEW_ID }, ['viewId']),
      // oneOf over `required` only: core adds `id` to these properties for the block target.
      oneOf: [{ required: ['before'] }, { required: ['after'] }],
    },
    mirrors: [],
  },
  {
    name: 'updateView',
    summary: 'Change a view\'s saved settings: filters, sorts, grouping, calculations, columns, card, calendar, timeline, chart, map and form texts. It applies for everyone.',
    guidance: 'Only the keys in changes change. Each key replaces its whole value, so read the view first: to hide one column, send the full properties list with that entry visible false. form is the exception: its texts merge into the saved form. null removes a key (not form). '
      + 'Grouping by another property resets groupSettings (subGroupBy: subGroupSettings) to that type\'s defaults unless changes also sets them. A filter or sort without an id gets one. '
      + 'Change the layout type with database.setLayout. Sharing and access settings (who can fill out a form, calendar sync) are not writable.',
    target: 'block',
    preconditions: ['The database is not locked.', 'Every property a setting names exists, and has a type that setting can use.'],
    args: closed({ viewId: VIEW_ID, changes: VIEW_CHANGES }, ['viewId', 'changes']),
    mirrors: [],
  },
  {
    name: 'setLayout',
    summary: 'Change a view\'s layout type, as the view settings Layout menu does.',
    guidance: 'A board without a grouping groups by the first select, multi-select or status property, else the first property it can group by. A map adds a Place property when there is none. A timeline starts with no table columns.',
    target: 'block',
    preconditions: ['The database is not locked.', 'A board needs a property it can group by.'],
    args: closed({ viewId: VIEW_ID, type: { enum: ADDABLE_VIEW_TYPES } }, ['viewId', 'type']),
    mirrors: [],
  },
  {
    name: 'setLock',
    summary: 'Lock or unlock the database. A locked database\'s properties and views cannot change; rows can.',
    guidance: 'Unlocking a locked database asks the person first, and the batch waits for their answer. If they say no, or nothing can ask them, it fails with APPROVAL_REQUIRED and nothing in the batch is applied.',
    target: 'block',
    args: closed({ locked: { type: 'boolean' } }, ['locked']),
    mirrors: [],
  },
  {
    name: 'addProperty',
    summary: 'Add a property (a column). It goes last unless before or after names a property.',
    guidance: 'Only select and multiSelect take options. A status starts with Not started, In progress and Done. A relation starts as a relation to this database.',
    target: 'block',
    args: {
      ...closed({
        name: { type: 'string', minLength: 1 },
        type: { enum: PROPERTY_TYPES.filter(type => type !== 'title') },
        options: { type: 'array', items: NEW_OPTION },
        before: PROPERTY_ID,
        after: PROPERTY_ID,
      }, ['name', 'type']),
    },
    result: closed({ propertyId: { type: 'string' } }, ['propertyId']),
    mirrors: [],
  },
  {
    name: 'addOption',
    summary: 'Add an option to a select, multi-select or status property, last.',
    target: 'block',
    args: closed({ propertyId: PROPERTY_ID, label: { type: 'string', minLength: 1 }, color: COLOR }, ['propertyId', 'label']),
    result: closed({ optionId: { type: 'string' } }, ['optionId']),
    mirrors: [],
  },
  {
    name: 'renameOption',
    summary: 'Rename an option.',
    target: 'block',
    args: closed({ propertyId: PROPERTY_ID, optionId: OPTION_ID, label: { type: 'string', minLength: 1 } }, ['propertyId', 'optionId', 'label']),
    mirrors: [],
  },
  {
    name: 'moveOption',
    summary: 'Move an option before or after another option.',
    target: 'block',
    args: {
      ...closed({ propertyId: PROPERTY_ID, optionId: OPTION_ID, before: OPTION_ID, after: OPTION_ID }, ['propertyId', 'optionId']),
      oneOf: [{ required: ['before'] }, { required: ['after'] }],
    },
    mirrors: [],
  },
  {
    name: 'deleteOption',
    summary: 'Delete an option. rows: keep empties the value on rows that had it (what the editor does); delete removes those rows.',
    target: 'block',
    preconditions: ['The property keeps at least one option.'],
    args: closed({ propertyId: PROPERTY_ID, optionId: OPTION_ID, rows: { enum: ['keep', 'delete'] } }, ['propertyId', 'optionId', 'rows']),
    mirrors: [],
  },
  {
    name: 'addRow',
    summary: 'Add a row (a database-row child block), as the New button does. It goes last in every view, unless before or after names a row: then it goes there in the open view\'s order.',
    guidance: 'The row starts from the default template: its values, icon, cover, reminders and page body. template names another template; null starts an empty page. values maps property ids to values and wins over the template, except an empty title. A status with a default option and a person property that defaults to Created by fill in when values leave them out. Values the open view\'s filters ask for fill in too (an equals filter, a person contains, a date the filter accepts), so the row shows there; values win over them, and they win over the template. group puts the row in a column of the open board view: an option id of the property it groups by.',
    target: 'block',
    args: closed({ values: ROW_VALUES, group: OPTION_ID, before: ROW_ID, after: ROW_ID, template: { anyOf: [{ type: 'string', minLength: 1 }, { type: 'null' }] } }),
    result: closed({ rowId: { type: 'string' } }, ['rowId']),
    mirrors: ['menu:database/template-empty', 'menu:database/template-empty-use'],
  },
  {
    name: 'moveRow',
    summary: 'Move a row before or after another row in the open view, as a drag does, and optionally into another board column. In a view with its own manual order, only that order changes; otherwise the row moves for every view on the shared order, and the other views keep it where they show it.',
    target: 'block',
    args: {
      ...closed({ rowId: ROW_ID, group: OPTION_ID, before: ROW_ID, after: ROW_ID }, ['rowId']),
      oneOf: [{ required: ['before'] }, { required: ['after'] }],
    },
    mirrors: [],
  },
  {
    name: 'setRowValues',
    summary: 'Set property values on a row. Values not named stay. The row title mirrors the title property.',
    guidance: 'Each value must fit its property as a cell editor writes it: option ids that exist, a date string, { id } lists for person and relation, and so on. Formula, rollup, button, created, edited and ID properties are computed and refused. null clears a value (a person, files or relation list becomes []); clearing a date drops its reminder. A two-way relation updates the rows it names too, and a one-page limit keeps the last id. A template may hold @today, @now and { "id": "@me" }.',
    target: 'block',
    args: closed({ rowId: ROW_ID, values: ROW_VALUES }, ['rowId', 'values']),
    mirrors: ['menu:database/database-row-edit-property-*', 'menu:database/database-bulk-edit-*'],
  },
  {
    name: 'applyTemplate',
    summary: 'Apply a template to a row whose page is empty, as picking one on the row page does: it fills the row\'s empty values, a missing icon, cover and width, and copies the template\'s page body.',
    target: 'block',
    preconditions: ['The row\'s page has no content yet.'],
    args: closed({ rowId: ROW_ID, templateId: { type: 'string', minLength: 1 } }, ['rowId', 'templateId']),
    mirrors: [],
  },
  {
    name: 'duplicateRow',
    summary: 'Copy a row right after itself with its page body, as the row menu\'s Duplicate does; in an open view with its own manual order the copy goes right after it there too. A parent\'s sub-items are copied under the copy. A template copy stays a template. block.duplicate on a row does the same.',
    target: 'block',
    args: closed({ rowId: ROW_ID }, ['rowId']),
    result: closed({ rowId: { type: 'string' } }, ['rowId']),
    mirrors: [],
  },
  {
    name: 'moveRowTo',
    summary: 'Move a row, its sub-items and their pages to the end of another database in this document, as the row menu\'s Move to does.',
    guidance: 'Values go to the target property with the same name and type (options by label); the title goes to the title. Values with no match stay behind. A linked view is not a target: name its source database.',
    target: 'block',
    args: closed({ rowId: ROW_ID, databaseId: { type: 'string', minLength: 1 } }, ['rowId', 'databaseId']),
    mirrors: [],
  },
  {
    name: 'deleteRow',
    summary: 'Delete a row or a template with its page, as the row menu does: its sub-items go too, and relations pointing at it let go of it. block.delete on a row does the same.',
    target: 'block',
    args: closed({ rowId: ROW_ID }, ['rowId']),
    result: closed({ removedIds: { type: 'array', items: { type: 'string' } } }, ['removedIds']),
    mirrors: [],
  },
  {
    name: 'updateProperty',
    summary: 'Rename a property or change its settings (description, icon, page visibility, number, date, status, ID, formula, relation, rollup, button, dependency, autofill), or the row page layout on the title property.',
    guidance: 'settings keys follow schema; null removes one. The type cannot change here. relation with twoWay true and no syncedPropertyId does what the Two-way toggle does: it adds the other side on the target database, links the pair and fills it from this side; twoWay false leaves that side as a one-way relation. The pageLayout* keys go on the title property only; pageLayoutTabsId names a tabs child block of this database that you make with block.insert.',
    target: 'block',
    preconditions: ['The new name is not the name of another property (exact match, case-sensitive).'],
    args: closed({
      propertyId: PROPERTY_ID,
      name: { type: 'string', minLength: 1 },
      settings: {
        type: 'object',
        additionalProperties: false,
        properties: Object.fromEntries(Object.entries({ ...PROPERTY_SETTINGS, ...PAGE_LAYOUT_SETTINGS }).map(([key, setting]) => [key, { anyOf: [setting, { type: 'null' }] }])),
      },
    }, ['propertyId']),
    mirrors: [],
  },
  {
    name: 'duplicateProperty',
    summary: 'Copy a property right after itself, named "<name> (copy)", with every row\'s value.',
    target: 'block',
    preconditions: ['The title and ID properties cannot be duplicated.'],
    args: closed({ propertyId: PROPERTY_ID }, ['propertyId']),
    result: closed({ propertyId: { type: 'string' } }, ['propertyId']),
    mirrors: [],
  },
  {
    name: 'deleteProperty',
    summary: 'Remove a property from the schema. Row values stay in the rows.',
    target: 'block',
    preconditions: ['The title property cannot be deleted.'],
    args: closed({ propertyId: PROPERTY_ID }, ['propertyId']),
    mirrors: [],
  },
  {
    name: 'recolorOption',
    summary: 'Set the color of a select, multi-select or status option.',
    target: 'block',
    args: closed({ propertyId: PROPERTY_ID, optionId: OPTION_ID, color: COLOR }, ['propertyId', 'optionId', 'color']),
    mirrors: ['menu:database/color-*'],
  },
  {
    name: 'addTemplate',
    summary: 'Add an empty page template (a database-row child with template true), after the last template.',
    guidance: 'Fill it with database.setRowValues and ordinary child blocks. Templates are not rows: views skip them.',
    target: 'block',
    args: closed({}),
    result: closed({ templateId: { type: 'string' } }, ['templateId']),
    mirrors: ['menu:database/template-add'],
  },
  {
    name: 'setDefaultTemplate',
    summary: 'Set the template new rows start from, or null for none.',
    target: 'block',
    args: closed({ templateId: { anyOf: [{ type: 'string', minLength: 1 }, { type: 'null' }] } }, ['templateId']),
    mirrors: ['menu:database/template-empty-default'],
  },
  {
    name: 'setTemplateRepeat',
    summary: 'Set or clear (null) a template\'s repeating schedule. Blok stores it; the host makes the rows.',
    target: 'block',
    args: closed({
      templateId: { type: 'string', minLength: 1 },
      repeat: { anyOf: [DATABASE_ROW_DATA.properties.repeat, { type: 'null' }] },
    }, ['templateId', 'repeat']),
    mirrors: [],
  },
  {
    name: 'changePropertyType',
    summary: 'Change a property\'s type and convert every row\'s value, as the property menu does.',
    guidance: 'A value the new type cannot hold is kept on the row in convertedValues; changing back restores it. Text becomes options for select types.',
    target: 'block',
    preconditions: [
      'Not the title, and not the type it already has.',
      'Not from createdTime, lastEditedTime, createdBy, lastEditedBy or uniqueId: their values exist only in the editor.',
      'Not a rich text property that still holds HTML from an older document.',
    ],
    args: closed({ propertyId: PROPERTY_ID, type: { enum: [...CONVERTIBLE_TYPES] } }, ['propertyId', 'type']),
    mirrors: ['menu:database/type-*'],
  },
];

export const describeDatabase = (_config: Record<string, unknown> = {}): BlockToolDescription => ({
  summary: 'A database: a schema of properties and saved views. Rows are child database-row blocks.',
  guidance: 'Add rows with database.addRow and change their values with database.setRowValues. Delete, copy or move a row with database.deleteRow, database.duplicateRow and database.moveRowTo; block.delete and block.duplicate on a row do the same as the first two. While the database is locked, automations, source, hideDataSourceTitles and starter cannot change either. Change a view\'s settings (filters, sorts, grouping, columns, layout options) with database.updateView and its layout type with database.setLayout; add, rename, move, duplicate and delete views with the other database.* view actions. Change properties and options with the database.* property actions, and lock or unlock with database.setLock. Comment on rows with database.addComment, replyToComment, editComment, resolveComment and deleteComment. schema and views cannot be written directly. A full read of a row adds computed: the read-only values its cells show, by property id (formula, rollup, relation with back-links, unique ID, created and edited time and person). Raw values, no number format: times as ISO instants, people as [{ "id" }], a unique ID as shown ("T-1"). { "unavailable": reason } marks one it cannot work out.',
  data: DATABASE_DATA,
  inputFields: ['title'],
  summaryFields: ['title', 'activeViewId'],
  guardedFields: {
    schema: 'database.*Property',
    views: 'database.*View',
  },
  actions: [...DATABASE_ACTIONS, ...DATABASE_COMMENT_ACTIONS],
});
