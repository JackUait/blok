import type { BlockToolDescription, ToolActionDeclaration } from '../../../types/tools/tool-description';

export const COLUMN_LIST_ACTIONS: ToolActionDeclaration[] = [
  {
    name: 'create',
    target: 'create',
    summary: 'Create a row of columns, or wrap existing blocks in columns.',
    guidance: 'Pass count for paragraph-seeded columns, or from for one column per selected root. Selected descendants stay with their ancestor. The row replaces the first selected root.',
    args: {
      type: 'object',
      additionalProperties: false,
      properties: {
        count: { type: 'integer', minimum: 2, maximum: 5 },
        from: { type: 'array', minItems: 2, items: { type: 'string' } },
        widths: { type: 'array', items: { type: 'number', exclusiveMinimum: 0 } },
      },
      oneOf: [{ required: ['count'] }, { required: ['from'] }],
    },
    result: {
      type: 'object',
      required: ['id', 'childIds'],
      properties: {
        id: { type: 'string' },
        childIds: { type: 'array', items: { type: 'string' } },
      },
    },
    preconditions: [
      'Every from id must exist and appear only once.',
      'From must contain at least two selected roots with the same parent.',
      'Pass one width per resulting column.',
    ],
  },
  {
    name: 'addColumn',
    target: 'block',
    summary: 'Add a column at a zero-based index and reset all columns to even widths.',
    guidance: 'Indices past the last column append. Omit from to seed one empty paragraph, or pass existing blocks to move in caller order. Use setWidths afterward for uneven widths.',
    args: {
      type: 'object',
      required: ['at'],
      additionalProperties: false,
      properties: {
        at: { type: 'integer', minimum: 0 },
        from: { type: 'array', items: { type: 'string' } },
      },
    },
    result: {
      type: 'object',
      required: ['id'],
      properties: { id: { type: 'string' } },
    },
    preconditions: ['Every from id must exist and appear only once.'],
  },
  {
    name: 'removeColumn',
    target: 'block',
    summary: 'Delete a column and its children.',
    args: {
      type: 'object',
      required: ['index'],
      additionalProperties: false,
      properties: { index: { type: 'integer', minimum: 0 } },
    },
    preconditions: [
      'Index must name an existing column.',
      'Removing down to one column unwraps the list into its enclosing parent.',
    ],
  },
  {
    name: 'setWidths',
    target: 'block',
    summary: 'Set relative widths for every column.',
    guidance: 'A ratio of 1 removes widthRatio from the column data. All ratios must be positive.',
    args: {
      type: 'object',
      required: ['ratios'],
      additionalProperties: false,
      properties: {
        ratios: { type: 'array', items: { type: 'number', exclusiveMinimum: 0 } },
      },
    },
    preconditions: ['Pass one ratio per column.'],
  },
];

export const COLUMN_LIST_DATA = {
  type: 'object',
  description: 'A row of columns. Carries no data — the columns are its `content` children.',
  additionalProperties: false,
};

export const describeColumnList = (_config: Record<string, unknown> = {}): BlockToolDescription => ({
  summary: 'A row of columns. The columns are its children.',
  guidance: 'Create one with column_list.create, which makes the columns too. Move an existing block into a column with block.move. The toolbox columnCount value is not saved data; never write it.',
  data: COLUMN_LIST_DATA,
  inputFields: [],
  defaultData: {},
  actions: COLUMN_LIST_ACTIONS,
});
