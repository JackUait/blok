import type { BlockToolDescription } from '../../../types/tools/tool-description';

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
            enum: ['title', 'text', 'number', 'select', 'multiSelect', 'date', 'checkbox', 'url', 'richText'],
          },
          position: { type: 'string', description: 'Fractional-index sort key.' },
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
                  },
                },
              },
            },
          },
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
          type: { type: 'string', enum: ['board', 'table', 'gallery', 'list'] },
          position: { type: 'string' },
          groupBy: { type: 'string', description: 'Property id. Required for a board view.' },
          sorts: {
            type: 'array',
            items: {
              type: 'object',
              required: ['propertyId', 'direction'],
              additionalProperties: false,
              properties: {
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
                propertyId: { type: 'string' },
                operator: { type: 'string' },
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
          openPagesIn: { type: 'string', enum: ['side', 'center', 'full'], description: 'Where a row page opens. Default side; center for gallery.' },
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
